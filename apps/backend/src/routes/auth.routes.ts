import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';
import { body, validationResult } from 'express-validator';
import { AppError } from '../middleware/error.middleware';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import jwt from 'jsonwebtoken';
import { sendSMS, isSmsConfigured } from '../services/sms.service';
import {
  sendPasswordResetEmail,
  sendAdminLoginCodeEmail,
  sendPasswordChangedEmail,
} from '../services/mail.service';
import { SELF_USER_SELECT } from '../lib/publicSelects';
import { signUserToken, revokeAllSessions } from '../lib/session';
import {
  ADMIN_2FA_KEY,
  OTP_MAX_ATTEMPTS,
  SUPPORT_WHATSAPP,
  generateOtp,
  hashOtp,
  maskEmail,
  otpMatches,
  passwordProblem,
} from '../lib/security';
import { withSignedDocs, DRIVER_DOC_FIELDS, MERCHANT_DOC_FIELDS } from '../lib/privateDocs';

const OTP_TTL_MS = 10 * 60 * 1000;

// Double vérification admin : désactivable en urgence sur Railway (ADMIN_2FA=off),
// par exemple si l'envoi d'emails tombe en panne et bloque l'accès à l'administration.
const admin2faEnabled = () => (process.env.ADMIN_2FA || '').toLowerCase() !== 'off';

const publicUser = (user: { id: string; phone: string; email: string | null; firstName: string; lastName: string; role: string; language: string }) => ({
  id: user.id,
  phone: user.phone,
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  role: user.role,
  language: user.language,
});

const router = Router();

// Enregistrement par numéro de téléphone
router.post(
  '/register',
  [
    // Accepte un numéro camerounais (6XXXXXXXX) OU un numéro international (+indicatif...)
    body('phone').matches(/^(6[0-9]{8}|\+[1-9][0-9]{6,14})$/).withMessage('Numéro invalide. Format camerounais 6XXXXXXXX ou international +...'),
    body('firstName').trim().notEmpty().withMessage('Prénom requis'),
    body('lastName').trim().notEmpty().withMessage('Nom requis'),
    body('password').isString().withMessage('Mot de passe requis'),
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

      const weak = passwordProblem(password, phone);
      if (weak) throw new AppError(weak, 400);

      // L'email est obligatoire pour les comptes internationaux (diaspora),
      // car le SMS international est coûteux/peu fiable : l'email sert de secours.
      const isInternational = phone.startsWith('+') && !phone.startsWith('+237');
      if (isInternational && !email) {
        throw new AppError('Un email est requis pour les inscriptions avec un numéro international', 400);
      }
      // … et pour les chauffeurs / marchands : ils ont de l'argent sur leur portefeuille,
      // ils doivent pouvoir récupérer leur compte de façon sûre (code par email).
      if ((role === 'DRIVER' || role === 'MERCHANT') && !email) {
        throw new AppError('Un email est obligatoire pour les comptes chauffeur et marchand', 400);
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

      const token = signUserToken({ id: user.id, tokenVersion: 0 });

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

      // ADMINISTRATEUR : mot de passe correct, mais il faut AUSSI le code reçu par email.
      // Un mot de passe admin volé ne suffit plus pour entrer.
      if (user.role === 'ADMIN' && admin2faEnabled()) {
        if (!user.email) {
          // Sans email, impossible d'envoyer le code : on laisse entrer (comme avant) mais on
          // le signale, pour que l'email soit ajouté au plus vite.
          console.warn(`⚠️ Connexion admin SANS double vérification (aucun email) : ${user.id}`);
        } else {
          const code = generateOtp();
          await prisma.user.update({
            where: { id: user.id },
            data: { twoFaCode: hashOtp(user.id, 'admin-2fa', code), twoFaExpiry: new Date(Date.now() + OTP_TTL_MS), twoFaAttempts: 0 },
          });
          const sent = await sendAdminLoginCodeEmail(user.email, code);
          if (!sent) {
            throw new AppError('Envoi du code de connexion impossible. Réessayez dans quelques minutes.', 503);
          }
          const challengeToken = jwt.sign(
            { userId: user.id, tv: user.tokenVersion, purpose: 'admin-2fa' },
            ADMIN_2FA_KEY,
            { algorithm: 'HS256', expiresIn: '10m' }
          );
          return res.json({
            success: true,
            message: `Code de connexion envoyé à ${maskEmail(user.email)}`,
            data: { twoFactorRequired: true, challengeToken, maskedEmail: maskEmail(user.email) },
          });
        }
      }

      const token = signUserToken(user);

      res.json({
        success: true,
        message: 'Connexion réussie',
        data: {
          user: publicUser(user),
          token,
          ...(user.role === 'ADMIN' && !user.email
            ? { securityWarning: 'Ajoutez un email à ce compte administrateur pour activer la double vérification.' }
            : {}),
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

// Connexion ADMIN, étape 2 : code reçu par email
router.post(
  '/login/verify',
  [body('challengeToken').isString(), body('code').isString()],
  async (req: Request, res: Response) => {
    try {
      let payload: { userId: string; tv?: number; purpose?: string };
      try {
        payload = jwt.verify(String(req.body.challengeToken), ADMIN_2FA_KEY, { algorithms: ['HS256'] }) as any;
      } catch {
        throw new AppError('Demande expirée : reconnectez-vous', 401);
      }
      if (payload.purpose !== 'admin-2fa') throw new AppError('Demande invalide', 401);

      const user = await prisma.user.findUnique({ where: { id: payload.userId } });
      if (!user || !user.isActive || user.role !== 'ADMIN' || user.tokenVersion !== (payload.tv ?? 0)) {
        throw new AppError('Demande invalide : reconnectez-vous', 401);
      }
      if (!user.twoFaCode || !user.twoFaExpiry || user.twoFaExpiry < new Date()) {
        throw new AppError('Code expiré : reconnectez-vous pour en recevoir un nouveau', 401);
      }
      if (user.twoFaAttempts >= OTP_MAX_ATTEMPTS) {
        await prisma.user.update({ where: { id: user.id }, data: { twoFaCode: null, twoFaExpiry: null } });
        throw new AppError('Trop d\'essais : reconnectez-vous pour recevoir un nouveau code', 429);
      }
      if (!otpMatches(user.twoFaCode, user.id, 'admin-2fa', String(req.body.code).trim())) {
        const attempts = user.twoFaAttempts + 1;
        await prisma.user.update({
          where: { id: user.id },
          data: attempts >= OTP_MAX_ATTEMPTS ? { twoFaAttempts: attempts, twoFaCode: null, twoFaExpiry: null } : { twoFaAttempts: attempts },
        });
        throw new AppError(
          attempts >= OTP_MAX_ATTEMPTS
            ? 'Trop d\'essais : reconnectez-vous pour recevoir un nouveau code'
            : `Code incorrect (${OTP_MAX_ATTEMPTS - attempts} essai(s) restant(s))`,
          400
        );
      }

      await prisma.user.update({ where: { id: user.id }, data: { twoFaCode: null, twoFaExpiry: null, twoFaAttempts: 0 } });
      res.json({ success: true, message: 'Connexion réussie', data: { user: publicUser(user), token: signUserToken(user) } });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erreur de connexion' });
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

// Mot de passe oublié — le code part par email (ou SMS), sinon le support WhatsApp prend le relais.
// Il n'est JAMAIS renvoyé dans la réponse.
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

      // LE CODE N'EST PLUS JAMAIS RENVOYÉ À L'APP. Avant, il s'affichait à l'écran : n'importe
      // qui tapant le numéro d'un autre pouvait prendre son compte (et son portefeuille).
      // Il part uniquement vers un canal que SEUL le titulaire contrôle : son email, un SMS sur
      // son numéro, ou le support WhatsApp (qui vérifie que la demande vient du bon numéro).
      const supportReply = {
        success: true,
        message: 'Contactez le support 237GO sur WhatsApp depuis le numéro de votre compte : nous vous enverrons un code.',
        data: { channel: 'support', supportWhatsapp: SUPPORT_WHATSAPP },
      };

      // Compte inconnu : même réponse qu'un compte sans email (on ne révèle pas s'il existe).
      if (!user || !user.isActive) return res.json(supportReply);

      const code = generateOtp();
      const saveCode = () =>
        prisma.user.update({
          where: { id: user.id },
          data: { resetOtp: hashOtp(user.id, 'reset', code), resetOtpExpiry: new Date(Date.now() + OTP_TTL_MS), resetOtpAttempts: 0 },
        });

      if (user.email) {
        await saveCode();
        if (await sendPasswordResetEmail(user.email, code)) {
          return res.json({
            success: true,
            message: `Code envoyé par email à ${maskEmail(user.email)}`,
            data: { channel: 'email', maskedEmail: maskEmail(user.email) },
          });
        }
        console.error(`Email de réinitialisation non envoyé pour ${user.id} : bascule vers le support`);
      }

      // SMS (dès qu'Africa's Talking sera configuré)
      if (isSmsConfigured()) {
        await saveCode();
        const sms = await sendSMS({
          to: user.phone,
          message: `237GO : votre code de réinitialisation est ${code}. Valable 10 minutes. Ne le communiquez à personne.`,
        }).catch(() => null);
        if (sms?.success) {
          return res.json({
            success: true,
            message: 'Code envoyé par SMS',
            data: { channel: 'sms', maskedPhone: `${user.phone.slice(0, 3)}****${user.phone.slice(-2)}` },
          });
        }
      }

      return res.json(supportReply);
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
    body('otp').matches(/^\d{6}$/).withMessage('Code à 6 chiffres requis'),
    body('newPassword').isString().withMessage('Nouveau mot de passe requis'),
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
        throw new AppError('Code invalide ou expiré. Refaites une demande.', 400);
      }

      if (user.resetOtpExpiry < new Date()) {
        await prisma.user.update({ where: { id: user.id }, data: { resetOtp: null, resetOtpExpiry: null } });
        throw new AppError('Le code a expiré. Veuillez refaire une demande.', 400);
      }

      // 5 essais faux maximum : ensuite le code est détruit (impossible de le deviner par essais)
      if (!otpMatches(user.resetOtp, user.id, 'reset', String(otp))) {
        const attempts = user.resetOtpAttempts + 1;
        const burnt = attempts >= OTP_MAX_ATTEMPTS;
        await prisma.user.update({
          where: { id: user.id },
          data: burnt ? { resetOtpAttempts: attempts, resetOtp: null, resetOtpExpiry: null } : { resetOtpAttempts: attempts },
        });
        throw new AppError(
          burnt ? 'Trop d\'essais : ce code est annulé. Refaites une demande.' : `Code incorrect (${OTP_MAX_ATTEMPTS - attempts} essai(s) restant(s))`,
          400
        );
      }

      const weak = passwordProblem(newPassword, user.phone);
      if (weak) throw new AppError(weak, 400);

      // Mettre à jour le mot de passe et effacer le code
      const hashedPassword = await bcrypt.hash(newPassword, 12);
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: hashedPassword, resetOtp: null, resetOtpExpiry: null, resetOtpAttempts: 0, passwordChangedAt: new Date() },
      });
      // Nouveau mot de passe : TOUS les appareils encore connectés sont déconnectés
      // (si quelqu'un avait volé l'ancien mot de passe, il perd l'accès immédiatement).
      await revokeAllSessions(user.id, req.app.get('io'));
      // Alerte au titulaire (si quelqu'un d'autre a fait la demande, il le saura tout de suite)
      if (user.email) sendPasswordChangedEmail(user.email, user.firstName).catch(() => {});

      res.json({ success: true, message: 'Mot de passe réinitialisé. Vous pouvez vous connecter.' });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erreur de réinitialisation' });
    }
  }
);

// Changer son mot de passe (connecté) : tous les AUTRES appareils sont déconnectés,
// l'appareil courant reçoit un nouveau jeton et reste connecté.
router.post(
  '/change-password',
  authenticate,
  [
    body('currentPassword').notEmpty().withMessage('Mot de passe actuel requis'),
    body('newPassword').isString().withMessage('Nouveau mot de passe requis'),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: errors.array()[0].msg, errors: errors.array() });
      }
      const { currentPassword, newPassword } = req.body;
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { id: true, passwordHash: true, phone: true, email: true, firstName: true },
      });
      if (!user?.passwordHash || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
        throw new AppError('Mot de passe actuel incorrect', 400);
      }
      if (currentPassword === newPassword) {
        throw new AppError('Le nouveau mot de passe doit être différent de l\'ancien', 400);
      }
      const weak = passwordProblem(newPassword, user.phone);
      if (weak) throw new AppError(weak, 400);
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await bcrypt.hash(newPassword, 12), passwordChangedAt: new Date() },
      });
      const tokenVersion = await revokeAllSessions(user.id, req.app.get('io'));
      if (user.email) sendPasswordChangedEmail(user.email, user.firstName).catch(() => {});
      res.json({
        success: true,
        message: 'Mot de passe modifié. Vos autres appareils ont été déconnectés.',
        data: { token: signUserToken({ id: user.id, tokenVersion }) },
      });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erreur lors du changement de mot de passe' });
    }
  }
);

// Déconnecter TOUS mes appareils (téléphone perdu, compte partagé, doute…).
// L'appareil courant reçoit un nouveau jeton et reste connecté.
router.post('/logout-all', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const tokenVersion = await revokeAllSessions(req.user!.id, req.app.get('io'));
    res.json({
      success: true,
      message: 'Tous vos autres appareils ont été déconnectés.',
      data: { token: signUserToken({ id: req.user!.id, tokenVersion }) },
    });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Profil utilisateur
router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const [user, cancelCount] = await Promise.all([
      prisma.user.findUnique({
        where: { id: req.user!.id },
        // select explicite : JAMAIS le mot de passe chiffré ni le code de réinitialisation
        select: {
          ...SELF_USER_SELECT,
          wallet: true,
          loyaltyPoints: true,
          driverProfile: true, // ses propres documents : il en est le propriétaire
          merchantProfile: true,
          emergencyContacts: true,
        },
      }),
      // Compteur d'annulations tardives (course acceptée ou chauffeur en route)
      // = courses annulées où le chauffeur avait déjà accepté (driverId non null).
      prisma.ride.count({
        where: {
          passengerId: req.user!.id,
          status: 'CANCELLED',
          driverId: { not: null }, // chauffeur avait accepté = annulation tardive
        },
      }),
    ]);

    if (!user) {
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    }

    // Avertissement si seuil dépassé (3 annulations tardives)
    const cancelWarning = cancelCount >= 3
      ? `Attention : vous avez ${cancelCount} annulation(s) tardive(s). Votre compte pourrait être suspendu.`
      : null;

    // Documents d'identité : liens temporaires (jamais l'adresse permanente du fichier)
    res.json({
      success: true,
      data: {
        ...user,
        driverProfile: withSignedDocs(user.driverProfile, user.id, DRIVER_DOC_FIELDS),
        merchantProfile: withSignedDocs(user.merchantProfile, user.id, MERCHANT_DOC_FIELDS),
        cancelCount,
        cancelWarning,
      },
    });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur lors de la récupération du profil' });
  }
});

export { router as authRouter };
