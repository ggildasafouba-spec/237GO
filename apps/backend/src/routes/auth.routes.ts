import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import { AppError } from '../middleware/error.middleware';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { sendSMS } from '../services/sms.service';
import { sendPasswordResetEmail } from '../services/mail.service';

const router = Router();

// Enregistrement par numéro de téléphone
router.post(
  '/register',
  [
    // Accepte un numéro camerounais (6XXXXXXXX) OU un numéro international (+indicatif...)
    body('phone').matches(/^(6[0-9]{8}|\+[1-9][0-9]{6,14})$/).withMessage('Numéro invalide. Format camerounais 6XXXXXXXX ou international +...'),
    body('firstName').trim().notEmpty().withMessage('Prénom requis'),
    body('lastName').trim().notEmpty().withMessage('Nom requis'),
    body('password').isLength({ min: 6 }).withMessage('Mot de passe minimum 6 caractères'),
    body('role').optional().isIn(['PASSENGER', 'DRIVER', 'MERCHANT']),
    // Email : optionnel, mais requis pour les numéros internationaux (diaspora)
    body('email').optional({ values: 'falsy' }).isEmail().withMessage('Email invalide'),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { phone, firstName, lastName, password, role, language, email } = req.body;

      // L'email est obligatoire pour les comptes internationaux (diaspora),
      // car le SMS international est coûteux/peu fiable : l'email sert de secours.
      const isInternational = phone.startsWith('+') && !phone.startsWith('+237');
      if (isInternational && !email) {
        throw new AppError('Un email est requis pour les inscriptions avec un numéro international', 400);
      }

      // Vérifier si le numéro existe déjà
      const existingUser = await prisma.user.findUnique({ where: { phone } });
      if (existingUser) {
        throw new AppError('Ce numéro de téléphone est déjà enregistré', 409);
      }

      // Vérifier l'unicité de l'email s'il est fourni
      const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
      if (normalizedEmail) {
        const emailTaken = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (emailTaken) {
          throw new AppError('Cet email est déjà utilisé', 409);
        }
      }

      const hashedPassword = await bcrypt.hash(password, 12);

      const user = await prisma.user.create({
        data: {
          phone,
          email: normalizedEmail,
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
          email: true,
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

// Connexion — par numéro de téléphone OU par email
router.post(
  '/login',
  [
    // "identifier" = téléphone (6XXXXXXXX / +...) OU email. On garde "phone" en compat.
    body('password').notEmpty().withMessage('Mot de passe requis'),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { phone, identifier, password } = req.body;
      // On accepte "identifier" (nouveau) ou "phone" (ancien) comme identifiant de connexion
      const rawId = String(identifier || phone || '').trim();
      if (!rawId) {
        throw new AppError('Veuillez entrer votre numéro ou votre email', 400);
      }

      // Si l'identifiant ressemble à un email, on cherche par email (insensible à la casse) ;
      // sinon on cherche par numéro de téléphone.
      const isEmail = rawId.includes('@');
      const user = isEmail
        ? await prisma.user.findUnique({ where: { email: rawId.toLowerCase() } })
        : await prisma.user.findUnique({ where: { phone: rawId } });

      if (!user) {
        throw new AppError('Identifiant ou mot de passe incorrect', 401);
      }

      // Vérifier le mot de passe
      if (!user.passwordHash) {
        throw new AppError('Compte non configuré, contactez le support', 401);
      }
      const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
      if (!isPasswordValid) {
        throw new AppError('Identifiant ou mot de passe incorrect', 401);
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
            email: user.email,
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

// Recherche un utilisateur par identifiant (email si "@", sinon téléphone)
async function findUserByIdentifier(rawId: string) {
  const id = rawId.trim();
  if (id.includes('@')) {
    return prisma.user.findUnique({ where: { email: id.toLowerCase() } });
  }
  return prisma.user.findUnique({ where: { phone: id } });
}

// Mot de passe oublié — code OTP envoyé par SMS et/ou email
router.post(
  '/forgot-password',
  [body('identifier').optional(), body('phone').optional()],
  async (req: Request, res: Response) => {
    try {
      const rawId = String(req.body.identifier || req.body.phone || '').trim();
      if (!rawId) {
        return res.status(400).json({ success: false, message: 'Veuillez entrer votre numéro ou votre email' });
      }

      const user = await findUserByIdentifier(rawId);

      // Toujours répondre succès pour ne pas révéler si le compte existe (sécurité)
      if (!user) {
        return res.json({
          success: true,
          message: 'Si ce compte existe, un code de réinitialisation a été envoyé.',
        });
      }

      // Générer un code à 6 chiffres valable 10 minutes
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiry = new Date(Date.now() + 10 * 60 * 1000);

      await prisma.user.update({
        where: { id: user.id },
        data: { resetOtp: otp, resetOtpExpiry: expiry },
      });

      // Envoi par EMAIL si disponible (fiable à l'international) — best-effort
      if (user.email) {
        try {
          await sendPasswordResetEmail(user.email, otp);
        } catch (e) {
          console.error('Échec envoi email reset (non bloquant):', (e as Error).message);
        }
      }

      // Envoi par SMS aussi (best-effort) — utile pour les numéros locaux
      try {
        await sendSMS({
          to: user.phone,
          message: `237GO: Votre code de réinitialisation est ${otp}. Valable 10 minutes. Ne le partagez pas.`,
        });
      } catch (smsError) {
        console.error('Échec envoi SMS reset (non bloquant):', (smsError as Error).message);
      }

      res.json({
        success: true,
        message: 'Si ce compte existe, un code de réinitialisation a été envoyé (SMS et/ou email).',
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
    body('otp').isLength({ min: 6, max: 6 }).withMessage('Code à 6 chiffres requis'),
    body('newPassword').isLength({ min: 6 }).withMessage('Mot de passe minimum 6 caractères'),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { phone, identifier, otp, newPassword } = req.body;
      const rawId = String(identifier || phone || '').trim();
      const user = await findUserByIdentifier(rawId);

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
