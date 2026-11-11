/**
 * Test de l'import du menu (Excel / CSV) sur l'API LOCALE uniquement.
 * Usage : DATABASE_URL=...localhost:55433/go237load JWT_SECRET=... node scripts/menu-import-check.js
 */
const { PrismaClient } = require('@prisma/client');
const ExcelJS = require('exceljs');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');

const API = process.env.API_URL || 'http://localhost:3099';
const url = process.env.DATABASE_URL || '';
if (!/localhost:55433\/go237load/.test(url) || !/localhost/.test(API)) {
  console.error('REFUS: test local uniquement');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });
let fails = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'OK   ' : 'ECHEC'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails++;
};
const phone = () => `6${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const token = (id) => jwt.sign({ userId: id }, process.env.JWT_SECRET, { expiresIn: '1h' });

const parse = async (t, buffer, filename, query = '') => {
  const fd = new FormData();
  fd.append('file', new Blob([buffer]), filename);
  const r = await fetch(`${API}/api/market/menu-import/parse${query}`, { method: 'POST', headers: { Authorization: `Bearer ${t}` }, body: fd });
  return { status: r.status, body: await r.json() };
};
const postJson = async (path, t, body) => {
  const r = await fetch(API + '/api' + path, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
};
const xlsx = async (rows) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Menu');
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
};
const itemsOf = (preview) => preview.rows.filter((r) => r.errors.length === 0)
  .map((r) => ({ name: r.name, price: r.price, category: r.category, description: r.description }));

(async () => {
  const mkUser = (role) => prisma.user.create({
    data: { id: randomUUID(), phone: phone(), firstName: 'T', lastName: role, role, wallet: { create: {} } },
  });
  const merchantUser = await mkUser('MERCHANT');
  const passenger = await mkUser('PASSENGER');
  const admin = await mkUser('ADMIN');
  const merchant = await prisma.merchantProfile.create({
    data: { userId: merchantUser.id, shopName: 'Resto Test', shopAddress: 'Yaoundé', shopLat: 3.85, shopLng: 11.5, category: 'restaurant', verificationStatus: 'VERIFIED' },
  });
  const other = await mkUser('MERCHANT');
  const otherShop = await prisma.merchantProfile.create({
    data: { userId: other.id, shopName: 'Autre', shopAddress: 'Douala', shopLat: 4.05, shopLng: 9.7, category: 'restaurant', verificationStatus: 'VERIFIED' },
  });
  const T = { m: token(merchantUser.id), p: token(passenger.id), a: token(admin.id) };

  // 1) Modèle téléchargeable et relu tel quel
  const tpl = await fetch(`${API}/api/market/menu-template`);
  const tplBuf = Buffer.from(await tpl.arrayBuffer());
  check('modèle Excel téléchargeable', tpl.status === 200 && /spreadsheetml/.test(tpl.headers.get('content-type')));
  const tplParsed = await parse(T.m, tplBuf, 'menu-237go.xlsx');
  check('le modèle rempli d\'exemples se relit (3 plats, feuille « Mode d\'emploi » ignorée)',
    tplParsed.status === 200 && tplParsed.body.data.validCount === 3 && tplParsed.body.data.errorCount === 0,
    JSON.stringify({ v: tplParsed.body.data?.validCount, e: tplParsed.body.data?.errorCount }));

  // 2) Fichier « réel » avec des saisies humaines variées
  const file = await xlsx([
    ['Nom du plat', 'Prix (XAF)', 'Catégorie', 'Description'],
    ['Ndolé crevettes', 3500, 'Plats', 'Avec plantain'],
    ['Poulet DG', '4 000 F', 'Plats', ''],
    ['Jus de foléré', '500 FCFA', 'Boissons', ''],
    ['Beignets haricot', '1.000', '', ''],          // milliers + catégorie vide
    ['', 2000, 'Plats', ''],                          // nom manquant
    ['Eru', 'gratuit', 'Plats', ''],                  // prix illisible
    ['poulet dg', 4500, 'Plats', ''],                 // doublon (casse différente)
    ['Koki', 0, 'Plats', ''],                         // prix nul
    [],                                               // ligne vide ignorée
    ['Mbongo tchobi', 3000.6, 'Plats', 'Poisson'],    // décimales arrondies
  ]);
  const p1 = await parse(T.m, file, 'menu.xlsx');
  const d1 = p1.body.data;
  check('lecture du fichier', p1.status === 200, JSON.stringify(p1.body.message || ''));
  const byName = (n) => d1.rows.find((r) => r.name === n);
  check('« 4 000 F » lu 4000', byName('Poulet DG')?.price === 4000);
  check('« 500 FCFA » lu 500', byName('Jus de foléré')?.price === 500);
  check('« 1.000 » lu 1000 + catégorie vide → « Autres »', byName('Beignets haricot')?.price === 1000 && byName('Beignets haricot')?.category === 'Autres');
  check('3000,6 arrondi à 3001', byName('Mbongo tchobi')?.price === 3001);
  check('nom manquant signalé', d1.rows.some((r) => r.errors.includes('Nom du plat manquant')));
  check('prix illisible signalé', byName('Eru')?.errors.some((e) => /illisible/.test(e)));
  check('doublon signalé (même nom, casse différente)', byName('poulet dg')?.errors.some((e) => /Doublon/.test(e)));
  check('prix nul refusé', byName('Koki')?.errors.length > 0);
  check('ligne vide ignorée, numéros de ligne exacts', byName('Mbongo tchobi')?.line === 11, `ligne ${byName('Mbongo tchobi')?.line}`);
  check('totaux : 5 valides, 4 en erreur, 5 nouveaux', d1.validCount === 5 && d1.errorCount === 4 && d1.createCount === 5,
    JSON.stringify({ v: d1.validCount, e: d1.errorCount, c: d1.createCount }));
  check('l\'aperçu n\'enregistre rien', (await prisma.product.count({ where: { merchantId: merchant.id } })) === 0);

  // 3) Validation → création
  const c1 = await postJson('/market/my-shop/menu-import', T.m, { items: itemsOf(d1) });
  check('import validé : 5 plats créés', c1.status === 200 && c1.body.data.created === 5, c1.body.message);
  const products = await prisma.product.findMany({ where: { merchantId: merchant.id } });
  check('5 plats en base, disponibles', products.length === 5 && products.every((p) => p.isAvailable));

  // 4) Réimport (prix modifié) → mise à jour, sans doublon, disponibilité conservée
  const ndole = products.find((p) => p.name === 'Ndolé crevettes');
  await prisma.product.update({ where: { id: ndole.id }, data: { isAvailable: false } });
  const csv = Buffer.from('\uFEFFNom;Prix;Catégorie;Description\r\n"NDOLÉ CREVETTES";"3 800";Plats;"Avec plantain; ou miondo"\r\nPlantain mûr;700;Accompagnements;\r\n', 'utf8');
  const p2 = await parse(T.m, csv, 'menu.csv');
  check('CSV « ; » d\'Excel français lu (guillemets + « ; » dans le texte)', p2.status === 200 && p2.body.data.validCount === 2,
    JSON.stringify(p2.body.data?.rows?.map((r) => [r.name, r.price, r.description, r.errors])));
  check('aperçu : 1 mise à jour, 1 nouveau', p2.body.data.updateCount === 1 && p2.body.data.createCount === 1);
  const c2 = await postJson('/market/my-shop/menu-import', T.m, { items: itemsOf(p2.body.data) });
  check('réimport : 1 créé, 1 mis à jour', c2.body.data?.created === 1 && c2.body.data?.updated === 1, c2.body.message);
  const ndoleAfter = await prisma.product.findUnique({ where: { id: ndole.id } });
  check('prix mis à jour, plat toujours « indisponible » (choix du marchand conservé)', ndoleAfter.price === 3800 && ndoleAfter.isAvailable === false);
  check('aucun doublon créé', (await prisma.product.count({ where: { merchantId: merchant.id } })) === 6);

  // 5) Sécurité
  const tampered = await postJson('/market/my-shop/menu-import', T.m, { items: [{ name: 'Pirate', price: -5, category: 'X' }] });
  check('données modifiées entre aperçu et validation : refusées', tampered.status === 400, tampered.body.message);
  const pass = await parse(T.p, file, 'menu.xlsx');
  check('un passager ne peut pas importer', pass.status === 403);
  const badType = await parse(T.m, Buffer.from('hello'), 'menu.pdf');
  check('format non supporté refusé', badType.status === 400, badType.body.message);
  const corrupt = await parse(T.m, Buffer.from('pas un excel'), 'menu.xlsx');
  check('fichier Excel corrompu : message clair', corrupt.status === 400, corrupt.body.message);
  const big = Buffer.alloc(2.5 * 1024 * 1024, 65);
  const tooBig = await parse(T.m, big, 'menu.csv');
  check('fichier > 2 Mo refusé', tooBig.status === 400, tooBig.body.message);
  const mAdminRoute = await postJson(`/admin/merchants/${otherShop.id}/menu-import`, T.m, { items: itemsOf(d1) });
  check('un marchand ne peut pas importer chez un autre (route admin)', mAdminRoute.status === 403);

  // 6) Admin : import pour le compte d'un restaurant
  const pa = await parse(T.a, file, 'menu.xlsx', `?merchantId=${otherShop.id}`);
  check('admin : aperçu pour un restaurant', pa.status === 200 && pa.body.data.createCount === 5);
  const ca = await postJson(`/admin/merchants/${otherShop.id}/menu-import`, T.a, { items: itemsOf(pa.body.data) });
  check('admin : menu importé chez le restaurant', ca.status === 200 && (await prisma.product.count({ where: { merchantId: otherShop.id } })) === 5, ca.body.message);
  check('la boutique du 1er marchand n\'est pas touchée', (await prisma.product.count({ where: { merchantId: merchant.id } })) === 6);

  // 7) Le client voit et commande les plats importés
  const client = await prisma.user.create({ data: { id: randomUUID(), phone: phone(), firstName: 'C', lastName: 'C', wallet: { create: { balance: 50000 } } } });
  const shop = await fetch(`${API}/api/market/merchants/${merchant.id}`, { headers: { Authorization: `Bearer ${token(client.id)}` } }).then((r) => r.json());
  const visible = shop.data.products.map((p) => p.name);
  check('le client voit les plats disponibles (pas le plat indisponible)', visible.length === 5 && !visible.includes('Ndolé crevettes'), visible.join(', '));
  const plantain = shop.data.products.find((p) => p.name === 'Plantain mûr');
  const order = await postJson('/market/orders', token(client.id), {
    merchantId: merchant.id, items: [{ productId: plantain.id, quantity: 2 }], deliveryAddress: 'Bastos', deliveryLat: 3.86, deliveryLng: 11.51, paymentMethod: 'WALLET',
  });
  check('commande d\'un plat importé', order.status === 201 && order.body.data.totalAmount === 1400, order.body.message);

  console.log(fails === 0 ? '\nTOUS LES CONTROLES PASSENT' : `\n${fails} controle(s) en echec`);
  await prisma.$disconnect();
  process.exit(fails ? 1 : 0);
})().catch(async (e) => { console.error('Erreur:', e.stack || e.message); await prisma.$disconnect(); process.exit(1); });
