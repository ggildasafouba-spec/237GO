import { Router, Response, Request } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { UPLOAD_DIR, PRIVATE_DIR } from '../lib/uploadPaths';
import { privateRef, signedDocUrl, resolveSignedFile } from '../lib/privateDocs';

const router = Router();

// Document d'identité (CNI, permis, carte grise…) → dossier PRIVÉ. Sinon photo publique.
const isPrivateUpload = (req: Request) =>
  req.query.private === '1' || req.query.private === 'true' || req.query.kind === 'document';

// Stockage disque. Le nom contient l'id de l'utilisateur qui téléverse : on peut ainsi
// vérifier, plus tard, qu'un document rattaché à un profil appartient bien à ce profil.
const storage = multer.diskStorage({
  destination: (req, _file, cb) => cb(null, isPrivateUpload(req) ? PRIVATE_DIR : UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${(req as AuthRequest).user!.id}--${uuidv4()}${ext}`);
  },
});

// Filtre : images uniquement
const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Format non supporté. Utilisez JPG, PNG ou WEBP.'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 Mo max
});

/**
 * Upload d'une image.
 * POST /api/upload              → photo publique : renvoie son URL.
 * POST /api/upload?private=1    → document d'identité : renvoie une référence privée (url)
 *                                 et un lien temporaire pour l'aperçu (previewUrl).
 */
router.post('/', authenticate, (req: AuthRequest, res: Response) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Aucun fichier reçu' });
    }

    if (isPrivateUpload(req)) {
      const url = privateRef(req.file.filename);
      return res.status(201).json({
        success: true,
        message: 'Document téléversé',
        data: { url, previewUrl: signedDocUrl(url, req.user!.id), filename: req.file.filename, private: true },
      });
    }

    const baseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3002}`;
    const url = `${baseUrl}/uploads/${req.file.filename}`;

    res.status(201).json({
      success: true,
      message: 'Fichier téléversé',
      data: { url, filename: req.file.filename },
    });
  });
});

export { router as uploadRouter };
export { UPLOAD_DIR };

/**
 * Lecture d'un document privé : UNIQUEMENT avec un lien signé et non expiré
 * (délivré par l'API au propriétaire du document ou à l'admin).
 * GET /api/files/private/:name?exp=...&sig=...
 */
export const filesRouter = Router();
filesRouter.get('/private/:name', (req: Request, res: Response) => {
  const file = resolveSignedFile(req.params.name, req.query.exp, req.query.sig);
  if (!file) {
    return res.status(404).json({ success: false, message: 'Lien expiré ou invalide' });
  }
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  // Affichable dans l'admin et l'app web (autres sous-domaines 237GO) ; l'accès reste
  // protégé par la signature du lien.
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.sendFile(file);
});
