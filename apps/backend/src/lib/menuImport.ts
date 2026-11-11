import ExcelJS from 'exceljs';
import { prisma } from './prisma';
import { AppError } from '../middleware/error.middleware';

/**
 * IMPORT DU MENU D'UN RESTAURANT / D'UNE BOUTIQUE PAR FICHIER EXCEL OU CSV
 *
 * Flux en 2 temps (rien n'est enregistré sans validation humaine) :
 *  1) parseMenuFile()  : lit le fichier, normalise et vérifie chaque ligne → aperçu
 *  2) importMenu()     : enregistre les lignes validées (création OU mise à jour par nom)
 *
 * Les lignes sont REVÉRIFIÉES à l'étape 2 : on ne fait jamais confiance à ce que
 * renvoie le client entre les deux étapes.
 */

export const MENU_MAX_ROWS = 500;
export const MENU_MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 Mo
const MAX_PRICE = 10_000_000;

export interface MenuItemInput {
  name: string;
  price: number;
  category: string;
  description?: string;
}

export interface ParsedMenuRow {
  line: number;                     // numéro de ligne dans le fichier (1 = en-tête)
  name: string;
  price: number | null;
  category: string;
  description: string;
  errors: string[];                 // bloquant : la ligne ne sera pas importée
  warnings: string[];               // informatif : corrigé automatiquement
  action?: 'create' | 'update';     // selon qu'un produit du même nom existe déjà
}

type Field = 'name' | 'price' | 'category' | 'description';

// En-têtes reconnus (comparés sans accents, sans casse, sans ponctuation)
const HEADER_ALIASES: Record<Field, string[]> = {
  name: ['nom', 'nomduplat', 'plat', 'produit', 'nomduproduit', 'article', 'name', 'designation', 'libelle'],
  price: ['prix', 'prixxaf', 'prixfcfa', 'prixf', 'tarif', 'price', 'montant'],
  category: ['categorie', 'category', 'rubrique', 'section', 'type'],
  description: ['description', 'details', 'detail', 'composition', 'accompagnement'],
};

const normalizeHeader = (h: string) =>
  h.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Valeur d'une cellule Excel → texte (gère nombres, formules, texte enrichi, liens). */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  const v = value as any;
  if (Array.isArray(v.richText)) return v.richText.map((r: any) => r.text).join('');
  if (v.result !== undefined) return cellText(v.result);
  if (v.text !== undefined) return cellText(v.text);
  return '';
}

/**
 * Prix saisi par un humain → entier XAF.
 * Accepte « 3500 », « 3 500 », « 3.500 », « 3,500 », « 3500 F », « 3 500 FCFA », « 3500,00 ».
 */
export function parsePrice(raw: string): { value: number | null; changed: boolean } {
  const original = raw.trim();
  if (!original) return { value: null, changed: false };
  let s = original
    .replace(/\u00a0|\u202f/g, ' ')
    .replace(/\s*(f\s*cfa|fcfa|xaf|cfa|frs?|f)\.?\s*$/i, '')
    .replace(/\s/g, '');
  // Séparateur de milliers : « 3.500 » / « 3,500 » / « 1.250.000 »
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, '');
  // Décimales (« 3500,00 » / « 3500.5 ») : on arrondit, le franc CFA n'a pas de centimes
  s = s.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return { value: null, changed: false };
  const value = Math.round(parseFloat(s));
  return { value, changed: String(value) !== original };
}

/** Lit un CSV (séparateur « ; » ou « , », guillemets gérés). */
function parseCsv(text: string): string[][] {
  const content = text.replace(/^\uFEFF/, '');
  const firstLine = content.split(/\r?\n/, 1)[0] || '';
  // Excel français exporte avec « ; » : on prend le séparateur le plus présent dans l'en-tête
  const sep = (firstLine.match(/;/g)?.length || 0) >= (firstLine.match(/,/g)?.length || 0) ? ';' : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (inQuotes) {
      if (c === '"') {
        if (content[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && content[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function readRows(buffer: Buffer, filename: string): Promise<string[][]> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    return parseCsv(buffer.toString('utf8'));
  }
  if (!lower.endsWith('.xlsx')) {
    throw new AppError('Format non supporté. Envoyez un fichier Excel (.xlsx) ou CSV.', 400);
  }
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as any);
  } catch {
    throw new AppError('Fichier Excel illisible. Enregistrez-le au format .xlsx puis réessayez.', 400);
  }
  // Première feuille contenant des données (la feuille « Mode d'emploi » du modèle est ignorée)
  const sheet = wb.worksheets.find((ws) => !/mode d.emploi/i.test(ws.name) && ws.actualRowCount > 0);
  if (!sheet) return [];
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (r) => {
    const values = r.values as ExcelJS.CellValue[]; // index 0 inutilisé par exceljs
    rows.push(values.slice(1).map(cellText));
  });
  return rows;
}

/** Valide et normalise une ligne (utilisé à l'aperçu ET à l'enregistrement). */
export function validateItem(raw: { name?: unknown; price?: unknown; category?: unknown; description?: unknown }) {
  const errors: string[] = [];
  const warnings: string[] = [];

  const name = clean(String(raw.name ?? ''));
  if (!name) errors.push('Nom du plat manquant');
  else if (name.length > 120) errors.push('Nom trop long (120 caractères max)');

  let price: number | null = null;
  const rawPrice = String(raw.price ?? '').trim();
  if (!rawPrice) errors.push('Prix manquant');
  else {
    const p = parsePrice(rawPrice);
    if (p.value === null) errors.push(`Prix illisible : « ${rawPrice} »`);
    else if (p.value <= 0) errors.push('Le prix doit être supérieur à 0');
    else if (p.value > MAX_PRICE) errors.push('Prix trop élevé');
    else {
      price = p.value;
      if (p.changed) warnings.push(`Prix « ${rawPrice} » lu comme ${p.value} XAF`);
    }
  }

  let category = clean(String(raw.category ?? ''));
  if (!category) {
    category = 'Autres';
    warnings.push('Catégorie vide : classé dans « Autres »');
  } else if (category.length > 60) {
    errors.push('Catégorie trop longue (60 caractères max)');
  }

  const description = clean(String(raw.description ?? ''));
  if (description.length > 500) errors.push('Description trop longue (500 caractères max)');

  return { name, price, category, description, errors, warnings };
}

const nameKey = (name: string) => clean(name).toLowerCase();

/** Lit le fichier et renvoie l'aperçu ligne par ligne (aucune écriture en base). */
export async function parseMenuFile(buffer: Buffer, filename: string, merchantId?: string) {
  // On garde le numéro de ligne RÉEL du fichier (les lignes vides sont ignorées mais comptées),
  // sinon le marchand chercherait l'erreur sur la mauvaise ligne.
  const numbered = (await readRows(buffer, filename))
    .map((cells, i) => ({ cells, fileLine: i + 1 }))
    .filter((r) => r.cells.some((c) => clean(c) !== ''));
  const rows = numbered.map((r) => r.cells);
  if (rows.length === 0) throw new AppError('Le fichier est vide', 400);

  // Repérage des colonnes par l'en-tête ; à défaut : Nom, Prix, Catégorie, Description
  const header = rows[0].map((h) => normalizeHeader(h));
  const col: Record<Field, number> = { name: -1, price: -1, category: -1, description: -1 };
  (Object.keys(HEADER_ALIASES) as Field[]).forEach((f) => {
    col[f] = header.findIndex((h) => HEADER_ALIASES[f].includes(h));
  });
  const hasHeader = col.name >= 0 && col.price >= 0;
  if (!hasHeader) {
    // Pas d'en-tête reconnu : si la 1re ligne ressemble à des données (2e colonne = prix), on la garde
    Object.assign(col, { name: 0, price: 1, category: 2, description: 3 });
  }
  const skip = hasHeader || parsePrice(rows[0][1] || '').value === null ? 1 : 0;
  const dataRows = rows.slice(skip);
  const lineOf = (i: number) => numbered[i + skip].fileLine;

  if (dataRows.length === 0) throw new AppError('Aucun plat trouvé sous la ligne d\'en-tête', 400);
  if (dataRows.length > MENU_MAX_ROWS) {
    throw new AppError(`Trop de lignes (${dataRows.length}). Maximum ${MENU_MAX_ROWS} plats par import.`, 400);
  }

  const existing = merchantId
    ? new Set(
        (await prisma.product.findMany({ where: { merchantId }, select: { name: true } })).map((p) => nameKey(p.name))
      )
    : new Set<string>();

  const seen = new Map<string, number>();
  const parsed: ParsedMenuRow[] = dataRows.map((r, i) => {
    const line = lineOf(i);
    const get = (f: Field) => (col[f] >= 0 ? r[col[f]] ?? '' : '');
    const v = validateItem({ name: get('name'), price: get('price'), category: get('category'), description: get('description') });
    if (v.name) {
      const key = nameKey(v.name);
      if (seen.has(key)) v.errors.push(`Doublon : même nom qu'à la ligne ${seen.get(key)}`);
      else seen.set(key, line);
    }
    return {
      line,
      ...v,
      action: v.errors.length === 0 ? (existing.has(nameKey(v.name)) ? 'update' : 'create') : undefined,
    };
  });

  return {
    rows: parsed,
    validCount: parsed.filter((r) => r.errors.length === 0).length,
    errorCount: parsed.filter((r) => r.errors.length > 0).length,
    createCount: parsed.filter((r) => r.action === 'create').length,
    updateCount: parsed.filter((r) => r.action === 'update').length,
  };
}

/**
 * Enregistre le menu validé : un plat portant le même nom (sans tenir compte des
 * majuscules) est MIS À JOUR (prix, catégorie, description), sinon il est CRÉÉ.
 * La disponibilité des plats existants n'est pas modifiée. Tout passe ou rien.
 */
export async function importMenu(merchantId: string, items: unknown) {
  if (!Array.isArray(items) || items.length === 0) throw new AppError('Aucun plat à importer', 400);
  if (items.length > MENU_MAX_ROWS) throw new AppError(`Maximum ${MENU_MAX_ROWS} plats par import`, 400);

  const valid: MenuItemInput[] = [];
  const keys = new Set<string>();
  items.forEach((raw, i) => {
    const v = validateItem((raw || {}) as any);
    if (v.errors.length || v.price === null) {
      throw new AppError(`Plat n°${i + 1} (${v.name || 'sans nom'}) : ${v.errors.join(', ')}`, 400);
    }
    const key = nameKey(v.name);
    if (keys.has(key)) throw new AppError(`Plat en double : « ${v.name} »`, 400);
    keys.add(key);
    valid.push({ name: v.name, price: v.price, category: v.category, description: v.description || undefined });
  });

  return prisma.$transaction(async (tx) => {
    const existing = await tx.product.findMany({ where: { merchantId }, select: { id: true, name: true } });
    const byName = new Map(existing.map((p) => [nameKey(p.name), p.id]));
    let created = 0;
    let updated = 0;
    for (const item of valid) {
      const id = byName.get(nameKey(item.name));
      if (id) {
        await tx.product.update({
          where: { id },
          data: { price: item.price, category: item.category, ...(item.description ? { description: item.description } : {}) },
        });
        updated++;
      } else {
        await tx.product.create({ data: { merchantId, ...item } });
        created++;
      }
    }
    return { created, updated };
  }, { timeout: 30_000 });
}

/** Modèle Excel prêt à remplir (feuille Menu + feuille Mode d'emploi). */
export async function buildMenuTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = '237GO';

  const ws = wb.addWorksheet('Menu');
  ws.columns = [
    { header: 'Nom du plat', key: 'name', width: 34 },
    { header: 'Prix (XAF)', key: 'price', width: 14 },
    { header: 'Catégorie', key: 'category', width: 20 },
    { header: 'Description', key: 'description', width: 50 },
  ];
  ws.addRows([
    { name: 'Ndolé crevettes', price: 3500, category: 'Plats', description: 'Avec plantain ou bâton de manioc' },
    { name: 'Poulet DG', price: 4000, category: 'Plats', description: '' },
    { name: 'Jus de foléré', price: 500, category: 'Boissons', description: '' },
  ]);
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1DB954' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.getColumn('price').numFmt = '#,##0';

  const help = wb.addWorksheet("Mode d'emploi");
  help.getColumn(1).width = 100;
  [
    'COMMENT REMPLIR VOTRE MENU 237GO',
    '',
    '1. Dans la feuille « Menu », une ligne = un plat. Remplacez les 3 exemples par vos plats.',
    '2. Nom du plat et Prix sont obligatoires. Le prix est en francs CFA, sans centimes (ex : 3500).',
    '3. Catégorie : regroupe vos plats dans l\'app (ex : Plats, Boissons, Desserts, Petit-déjeuner).',
    '4. Description (facultatif) : accompagnement, taille, ingrédients...',
    '5. Ne modifiez pas la première ligne (les titres des colonnes).',
    '6. Enregistrez, puis dans l\'app : Ma boutique → « Importer mon menu ».',
    '',
    'Mise à jour : réimportez le fichier modifié. Un plat portant le même nom est mis à jour (pas de doublon).',
    'Les photos des plats s\'ajoutent ensuite dans l\'app, plat par plat.',
  ].forEach((t, i) => {
    const row = help.getRow(i + 1);
    row.getCell(1).value = t;
    if (i === 0) row.font = { bold: true, size: 14 };
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
