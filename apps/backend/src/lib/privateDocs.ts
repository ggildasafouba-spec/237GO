/**
 * DOCUMENTS D'IDENTITÉ PRIVÉS
 *
 * Avant : CNI, permis, cartes grises… étaient servis publiquement sur /uploads : n'importe qui
 * ayant le lien pouvait les voir, sans connexion.
 *
 * Maintenant :
 *  - les fichiers sont dans un dossier privé, nommés « <id du propriétaire>--<id aléatoire>.<ext> » ;
 *  - la base garde une RÉFÉRENCE (…/api/files/private/<fichier>), inutilisable seule ;
 *  - l'API ne renvoie qu'un lien SIGNÉ valable 15 minutes, et seulement au propriétaire du
 *    document ou à l'admin. Un lien copié ou partagé cesse de fonctionner.
 *  - Le préfixe « propriétaire » du nom empêche de rattacher à son profil le document d'un autre.
 */
import path from 'path';
import fs from 'fs';
import { createHmac, timingSafeEqual } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import { UPLOAD_DIR, PRIVATE_DIR } from './uploadPaths';
import { DOC_LINK_KEY } from './security';
import { AppError } from '../middleware/error.middleware';

export const PRIVATE_ROUTE = '/api/files/private/';
const LINK_TTL_SECONDS = 15 * 60;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PRIVATE_NAME = new RegExp(`^(${UUID})--(${UUID})\\.(jpg|jpeg|png|webp)$`, 'i');
const PUBLIC_NAME = new RegExp(`^(?:(${UUID})--)?(${UUID})\\.(jpg|jpeg|png|webp)$`, 'i');

// Champs sensibles par type de profil
export const DRIVER_DOC_FIELDS = ['licensePhoto', 'cniPhoto', 'registrationPhoto', 'insurancePhoto', 'inspectionPhoto'] as const;
export const MERCHANT_DOC_FIELDS = ['ownerIdPhoto', 'businessRegPhoto'] as const;
export const VEHICLE_DOC_FIELDS = ['registrationPhoto', 'insurancePhoto', 'ownerIdPhoto'] as const;

const apiBase = () => (process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3002}`).replace(/\/+$/, '');

export function privateRef(filename: string): string {
  return `${apiBase()}${PRIVATE_ROUTE}${filename}`;
}

function pathnameOf(value: string): string | null {
  try {
    return new URL(value).pathname;
  } catch {
    return value.startsWith('/') ? value.split('?')[0] : null;
  }
}

/** Nom du fichier privé désigné par une référence (signée ou non), ou null. */
function privateNameOf(value: string): string | null {
  const p = pathnameOf(value);
  if (!p || !p.startsWith(PRIVATE_ROUTE)) return null;
  const name = decodeURIComponent(p.slice(PRIVATE_ROUTE.length));
  return PRIVATE_NAME.test(name) ? name : null;
}

const ownerOf = (name: string) => PRIVATE_NAME.exec(name)?.[1]?.toLowerCase() || null;

function signature(name: string, exp: number): string {
  return createHmac('sha256', DOC_LINK_KEY).update(`${name}:${exp}`).digest('hex').slice(0, 40);
}

/** Lien temporaire vers un document, uniquement s'il appartient bien à ownerId. */
export function signedDocUrl(value: string | null | undefined, ownerId: string): string | null {
  if (!value) return null;
  const name = privateNameOf(value);
  if (!name) {
    // Ancien lien public pas encore migré : il est déjà public, le renvoyer ne change rien.
    return pathnameOf(value)?.startsWith('/uploads/') ? value : null;
  }
  if (ownerOf(name) !== ownerId.toLowerCase()) return null;
  const exp = Math.floor(Date.now() / 1000) + LINK_TTL_SECONDS;
  return `${privateRef(name)}?exp=${exp}&sig=${signature(name, exp)}`;
}

/** Copie de l'objet où les champs sensibles sont remplacés par des liens temporaires. */
export function withSignedDocs<T extends Record<string, any> | null | undefined>(
  obj: T,
  ownerId: string | null | undefined,
  fields: readonly string[]
): T {
  if (!obj || !ownerId) return obj;
  const copy: Record<string, any> = { ...obj };
  for (const f of fields) if (f in copy) copy[f] = signedDocUrl(copy[f], ownerId);
  return copy as T;
}

/** Vérifie un lien signé ; renvoie le chemin du fichier si tout est valide. */
export function resolveSignedFile(name: string, exp: unknown, sig: unknown): string | null {
  if (!PRIVATE_NAME.test(name)) return null;
  const e = Number(exp);
  if (!Number.isFinite(e) || e < Math.floor(Date.now() / 1000)) return null;
  const expected = Buffer.from(signature(name, e));
  const given = Buffer.from(String(sig || ''));
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const file = path.join(PRIVATE_DIR, name);
  return fs.existsSync(file) ? file : null;
}

function moveFile(src: string, dst: string) {
  try {
    fs.renameSync(src, dst);
  } catch {
    fs.copyFileSync(src, dst);
    fs.unlinkSync(src);
  }
}

/**
 * Valeur envoyée par l'app pour un champ sensible → référence privée à enregistrer.
 *  - document privé (signé ou non) appartenant à l'utilisateur : accepté ;
 *  - photo téléversée en public par une ANCIENNE version de l'app : déplacée dans le dossier
 *    privé (uniquement si c'est l'utilisateur qui l'a téléversée) ;
 *  - autre chose (lien externe, document d'un autre) : refusé.
 */
export function normalizeDocInput(value: unknown, ownerId: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const v = String(value);

  const name = privateNameOf(v);
  if (name) {
    if (ownerOf(name) !== ownerId.toLowerCase()) throw new AppError('Document invalide : renvoyez la photo', 400);
    if (!fs.existsSync(path.join(PRIVATE_DIR, name))) throw new AppError('Document introuvable : renvoyez la photo', 400);
    return privateRef(name);
  }

  const p = pathnameOf(v);
  if (p?.startsWith('/uploads/')) {
    const pub = decodeURIComponent(p.slice('/uploads/'.length));
    const m = PUBLIC_NAME.exec(pub);
    if (!m || (m[1] || '').toLowerCase() !== ownerId.toLowerCase()) {
      throw new AppError('Document invalide : renvoyez la photo depuis l\'application', 400);
    }
    const src = path.join(UPLOAD_DIR, pub);
    const dstName = `${ownerId}--${m[2]}.${m[3].toLowerCase()}`;
    const dst = path.join(PRIVATE_DIR, dstName);
    if (fs.existsSync(src) && !fs.existsSync(dst)) moveFile(src, dst);
    if (!fs.existsSync(dst)) throw new AppError('Document introuvable : renvoyez la photo', 400);
    return privateRef(dstName);
  }

  throw new AppError('Document invalide : téléversez la photo depuis l\'application', 400);
}

/**
 * Migration unique (au démarrage, sans effet si déjà faite) : déplace dans le dossier privé
 * tous les documents encore enregistrés avec un lien public.
 */
export async function migrateSensitiveDocuments(prisma: PrismaClient): Promise<{ moved: number; updated: number }> {
  let moved = 0;
  let updated = 0;

  const relocate = (value: string | null, ownerId: string): string | null => {
    if (!value) return null;
    const p = pathnameOf(value);
    if (!p?.startsWith('/uploads/')) return null;
    const pub = decodeURIComponent(p.slice('/uploads/'.length));
    const m = PUBLIC_NAME.exec(pub);
    if (!m) return null;
    const dstName = `${ownerId}--${m[2]}.${m[3].toLowerCase()}`;
    const src = path.join(UPLOAD_DIR, pub);
    const dst = path.join(PRIVATE_DIR, dstName);
    if (fs.existsSync(src) && !fs.existsSync(dst)) {
      moveFile(src, dst);
      moved++;
    }
    return privateRef(dstName);
  };

  const jobs: { rows: () => Promise<any[]>; owner: (r: any) => string; fields: readonly string[]; save: (id: string, data: any) => Promise<unknown> }[] = [
    {
      rows: () => prisma.driverProfile.findMany({ select: { id: true, userId: true, ...Object.fromEntries(DRIVER_DOC_FIELDS.map((f) => [f, true])) } as any }),
      owner: (r) => r.userId,
      fields: DRIVER_DOC_FIELDS,
      save: (id, data) => prisma.driverProfile.update({ where: { id }, data }),
    },
    {
      rows: () => prisma.merchantProfile.findMany({ select: { id: true, userId: true, ...Object.fromEntries(MERCHANT_DOC_FIELDS.map((f) => [f, true])) } as any }),
      owner: (r) => r.userId,
      fields: MERCHANT_DOC_FIELDS,
      save: (id, data) => prisma.merchantProfile.update({ where: { id }, data }),
    },
    {
      rows: () => prisma.vehicle.findMany({ select: { id: true, ownerId: true, ...Object.fromEntries(VEHICLE_DOC_FIELDS.map((f) => [f, true])) } as any }),
      owner: (r) => r.ownerId,
      fields: VEHICLE_DOC_FIELDS,
      save: (id, data) => prisma.vehicle.update({ where: { id }, data }),
    },
  ];

  for (const job of jobs) {
    for (const row of await job.rows()) {
      const data: Record<string, string> = {};
      for (const f of job.fields) {
        const ref = relocate(row[f], job.owner(row));
        if (ref) data[f] = ref;
      }
      if (Object.keys(data).length) {
        await job.save(row.id, data);
        updated++;
      }
    }
  }
  return { moved, updated };
}
