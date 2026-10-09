import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import { AppError } from '../middleware/error.middleware';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { sendSMS } from '../services/sms.service';

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
          passwordHash: hashedPassword,
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

      // Vérifier le mot de passe
      if (!user.passwordHash) {
        throw new AppError('Compte non configuré, contactez le support', 401);
      }
      const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
      if (!isPasswordValid) {
        throw new AppError('Numéro ou mot de passe incorrect', 401);
      }

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

// Mot de passe oublié — demande d'un code OTP par SMS
router.post(
  '/forgot-password',
  [body('phone').matches(/^6[0-9]{8}$/).withMessage('Numéro camerounais invalide')],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { phone } = req.body;
      const user = await prisma.user.findUnique({ where: { phone } });

      // Toujours répondre succès pour ne pas révéler si le numéro existe (sécurité)
      if (!user) {
        return res.json({
          success: true,
          message: 'Si ce numéro est enregistré, un code de réinitialisation a été envoyé.',
        });
      }

      // Générer un code à 6 chiffres valable 10 minutes
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiry = new Date(Date.now() + 10 * 60 * 1000);

      await prisma.user.update({
        where: { id: user.id },
        data: { resetOtp: otp, resetOtpExpiry: expiry },
      });

      // Envoyer le code par SMS (best-effort : ne bloque pas si l'envoi échoue)
      try {
        await sendSMS({
          to: phone,
          message: `237GO: Votre code de réinitialisation est ${otp}. Valable 10 minutes. Ne le partagez pas.`,
        });
      } catch (smsError) {
        console.error('Échec envoi SMS reset (non bloquant):', (smsError as Error).message);
      }

      res.json({
        success: true,
        message: 'Si ce numéro est enregistré, un code de réinitialisation a été envoyé.',
      });
    } catch (error) {
      console.error('forgot-password error:', error);
      res.status(500).json({ success: false, message: 'Erreur lors de la demande' });
    }
  }
);

// Mot de passe oublié — réinitialisation avec le code OTP
router.post(
  '/reset-password',
  [
    body('phone').matches(/^6[0-9]{8}$/).withMessage('Numéro invalide'),
    body('otp').isLength({ min: 6, max: 6 }).withMessage('Code à 6 chiffres requis'),
    body('newPassword').isLength({ min: 6 }).withMessage('Mot de passe minimum 6 caractères'),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { phone, otp, newPassword } = req.body;
      const user = await prisma.user.findUnique({ where: { phone } });

      if (!user || !user.resetOtp || !user.resetOtpExpiry) {
        throw new AppError('Demande de réinitialisation invalide', 400);
      }

      if (user.resetOtpExpiry < new Date()) {
        throw new AppError('Le code a expiré. Veuillez refaire une demande.', 400);
      }

      if (user.resetOtp !== otp) {
        throw new AppError('Code incorrect', 400);
      }

      // Mettre à jour le mot de passe et effacer l'OTP
      const hashedPassword = await bcrypt.hash(newPassword, 12);
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: hashedPassword, resetOtp: null, resetOtpExpiry: null },
      });

      res.json({ success: true, message: 'Mot de passe réinitialisé. Vous pouvez vous connecter.' });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erreur de réinitialisation' });
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
