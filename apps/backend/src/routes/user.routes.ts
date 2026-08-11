import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { body, validationResult } from 'express-validator';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';

const router = Router();
const prisma = new PrismaClient();

// Mettre à jour le profil
router.patch(
  '/profile',
  authenticate,
  [
    body('firstName').optional().trim().notEmpty(),
    body('lastName').optional().trim().notEmpty(),
    body('email').optional().isEmail(),
    body('language').optional().isIn(['fr', 'en', 'pidgin']),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { firstName, lastName, email, language } = req.body;
      const updateData: Record<string, string> = {};
      if (firstName) updateData.firstName = firstName;
      if (lastName) updateData.lastName = lastName;
      if (email) updateData.email = email;
      if (language) updateData.language = language;

      const user = await prisma.user.update({
        where: { id: req.user!.id },
        data: updateData,
        select: { id: true, phone: true, firstName: true, lastName: true, email: true, language: true, role: true },
      });

      res.json({ success: true, data: user });
    } catch {
      res.status(500).json({ success: false, message: 'Erreur de mise à jour' });
    }
  }
);

// Ajouter un contact d'urgence
router.post(
  '/emergency-contacts',
  authenticate,
  [
    body('name').trim().notEmpty(),
    body('phone').matches(/^6[0-9]{8}$/),
    body('relation').optional().trim(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const contact = await prisma.emergencyContact.create({
        data: {
          userId: req.user!.id,
          name: req.body.name,
          phone: req.body.phone,
          relation: req.body.relation,
        },
      });

      res.status(201).json({ success: true, data: contact });
    } catch {
      res.status(500).json({ success: false, message: 'Erreur' });
    }
  }
);

// Lister les contacts d'urgence
router.get('/emergency-contacts', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const contacts = await prisma.emergencyContact.findMany({
      where: { userId: req.user!.id },
    });

    res.json({ success: true, data: contacts });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Supprimer un contact d'urgence
router.delete('/emergency-contacts/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const contact = await prisma.emergencyContact.findFirst({
      where: { id, userId: req.user!.id },
    });

    if (!contact) throw new AppError('Contact non trouvé', 404);

    await prisma.emergencyContact.delete({ where: { id } });
    res.json({ success: true, message: 'Contact supprimé' });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Notifications
router.get('/notifications', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { page = '1', limit = '30' } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const notifications = await prisma.notification.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      skip,
      take: parseInt(limit as string),
    });

    res.json({ success: true, data: notifications });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Marquer une notification comme lue
router.patch('/notifications/:id/read', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    await prisma.notification.update({
      where: { id: req.params.id },
      data: { isRead: true },
    });

    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Devenir chauffeur
router.post(
  '/become-driver',
  authenticate,
  [
    body('licenseNumber').trim().notEmpty(),
    body('licenseExpiry').isISO8601(),
    body('cniNumber').trim().notEmpty(),
    body('vehicleType').isIn(['MOTO', 'CAR_ECONOMY', 'CAR_COMFORT', 'CAR_VIP', 'TRUCK']),
    body('vehiclePlate').trim().notEmpty(),
    body('vehicleBrand').optional().trim(),
    body('vehicleModel').optional().trim(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const existing = await prisma.driverProfile.findUnique({
        where: { userId: req.user!.id },
      });

      if (existing) {
        throw new AppError('Vous avez déjà un profil chauffeur', 409);
      }

      const profile = await prisma.driverProfile.create({
        data: {
          userId: req.user!.id,
          licenseNumber: req.body.licenseNumber,
          licenseExpiry: new Date(req.body.licenseExpiry),
          cniNumber: req.body.cniNumber,
          vehicleType: req.body.vehicleType,
          vehiclePlate: req.body.vehiclePlate,
          vehicleBrand: req.body.vehicleBrand,
          vehicleModel: req.body.vehicleModel,
        },
      });

      // Mettre à jour le rôle
      await prisma.user.update({
        where: { id: req.user!.id },
        data: { role: 'DRIVER' },
      });

      res.status(201).json({
        success: true,
        message: 'Demande de chauffeur soumise ! En attente de vérification.',
        data: profile,
      });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erreur' });
    }
  }
);

// Devenir marchand
router.post(
  '/become-merchant',
  authenticate,
  [
    body('shopName').trim().notEmpty(),
    body('shopAddress').trim().notEmpty(),
    body('shopLat').isFloat(),
    body('shopLng').isFloat(),
    body('category').trim().notEmpty(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const existing = await prisma.merchantProfile.findUnique({
        where: { userId: req.user!.id },
      });

      if (existing) {
        throw new AppError('Vous avez déjà un profil marchand', 409);
      }

      const profile = await prisma.merchantProfile.create({
        data: {
          userId: req.user!.id,
          shopName: req.body.shopName,
          shopAddress: req.body.shopAddress,
          shopLat: req.body.shopLat,
          shopLng: req.body.shopLng,
          category: req.body.category,
          description: req.body.description,
        },
      });

      await prisma.user.update({
        where: { id: req.user!.id },
        data: { role: 'MERCHANT' },
      });

      res.status(201).json({
        success: true,
        message: 'Profil marchand créé ! Vous pouvez maintenant ajouter vos produits.',
        data: profile,
      });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erreur' });
    }
  }
);

export { router as userRouter };
