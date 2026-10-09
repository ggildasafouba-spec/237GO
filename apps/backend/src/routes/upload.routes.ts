import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';

const router = Router();

// Dossier de stockage des uploads.
// En production (Railway), monter un volume persistant et définir UPLOAD_PATH
// (ex: /data/uploads) pour que les fichiers survivent aux redéploiements.
const UPLOAD_DIR = process.env.UPLOAD_PATH || path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Configuration du stockage disque
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
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
 * Upload d'une image. Retourne l'URL publique du fichier.
 * POST /api/upload  (multipart/form-data, champ "file")
 */
router.post('/', authenticate, (req: AuthRequest, res: Response) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Aucun fichier reçu' });
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
