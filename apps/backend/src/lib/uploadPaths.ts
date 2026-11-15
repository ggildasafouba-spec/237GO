/**
 * Dossiers de stockage des fichiers téléversés.
 *
 * - UPLOAD_DIR  : photos PUBLIQUES (produits, boutique, véhicule, chat…), servies sur /uploads.
 * - PRIVATE_DIR : documents d'identité (CNI, permis, carte grise, assurance…), JAMAIS servis
 *                 directement : uniquement via un lien signé et temporaire (/api/files/private).
 *
 * En production (Railway), UPLOAD_PATH=/data/uploads : PRIVATE_DIR = /data/private-docs, sur le
 * même volume permanent (donc sauvegardé), mais HORS du dossier public.
 */
import path from 'path';
import fs from 'fs';

export const UPLOAD_DIR = process.env.UPLOAD_PATH || path.join(process.cwd(), 'uploads');
export const PRIVATE_DIR = process.env.PRIVATE_UPLOAD_PATH || path.join(path.dirname(UPLOAD_DIR), 'private-docs');

for (const dir of [UPLOAD_DIR, PRIVATE_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

if (path.resolve(PRIVATE_DIR).startsWith(path.resolve(UPLOAD_DIR) + path.sep)) {
  // Sécurité : le dossier privé ne doit jamais être à l'intérieur du dossier public
  throw new Error('PRIVATE_UPLOAD_PATH ne doit pas être à l\'intérieur de UPLOAD_PATH');
}
