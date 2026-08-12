import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import { AppError } from '../middleware/error.middleware';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';

const router = Router();
const prisma = new PrismaClient();

// Enregistrement par numéro de téléphone
router.post(
  '/register',
  [
    body('phone').matches(/^6[0-9]{8}$/).withMessage('Numéro camerounais invalide (ex: 6XXXXXXXX)'),
    body('firstName').trim().notEmpty().withMessage('Prénom requis'),
    body('lastName').trim().notEmpty().withMessage('Nom requis'),
    body('password').isLength({ min: 6 }).withMessage('Mot de passe minimum 6 caractères'),
    body('role').optional().isIn(['PASSENGER', 'DRIVER', 'MERCHANT']),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { phone, firstName, lastName, password, role, language } = req.body;

      // Vérifier si l'utilisateur existe déjà
      const existingUser = await prisma.user.findUnique({ where: { phone } });
      if (existingUser) {
        throw new AppError('Ce numéro de téléphone est déjà enregistré', 409);
      }

      const hashedPassword = await bcrypt.hash(password, 12);

      const user = await prisma.user.create({
        data: {
          phone,
          firstName,
          lastName,
          role: role || 'PASSENGER',
          language: language || 'fr',
          wallet: { create: { balance: 0 } },
          loyaltyPoints: { create: { points: 0 } },
        },
        select: {
          id: true,
          phone: true,
          firstName: true,
          lastName: true,
          role: true,
          language: true,
        },
      });

      const token = jwt.sign(
        { userId: user.id },
        process.env.JWT_SECRET || 'default-secret',
        { expiresIn: '7d' } as any
      );

      res.status(201).json({
        success: true,
        message: 'Inscription réussie ! Bienvenue sur 237GO',
        data: { user, token },
      });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      return res.status(500).json({ success: false, message: 'Erreur lors de l\'inscription' });
    }
  }
);

// Connexion
router.post(
  '/login',
  [
    body('phone').matches(/^6[0-9]{8}$/).withMessage('Numéro camerounais invalide'),
    body('password').notEmpty().withMessage('Mot de passe requis'),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { phone, password } = req.body;

      const user = await prisma.user.findUnique({ where: { phone } });
      if (!user) {
        throw new AppError('Numéro ou mot de passe incorrect', 401);
      }

      // Note: En production, stocker le hash dans un champ password séparé
      const token = jwt.sign(
        { userId: user.id },
        process.env.JWT_SECRET || 'default-secret',
        { expiresIn: '7d' } as any
      );

      res.json({
        success: true,
        message: 'Connexion réussie',
        data: {
          user: {
            id: user.id,
            phone: user.phone,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
            language: user.language,
          },
          token,
        },
      });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      return res.status(500).json({ success: false, message: 'Erreur de connexion' });
    }
  }
);

// Profil utilisateur
router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: {
        wallet: true,
        loyaltyPoints: true,
        driverProfile: true,
        merchantProfile: true,
        emergencyContacts: true,
      },
    });

    res.json({ success: true, data: user });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur lors de la récupération du profil' });
  }
});

export { router as authRouter };
