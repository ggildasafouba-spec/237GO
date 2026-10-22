import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { body, validationResult } from 'express-validator';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';
import { VEHICLE_CRITERIA, validateVehicleForCategory } from '../services/vehicleCriteria';

const router = Router();

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

// Enregistrer le token de notification push Expo
router.post(
  '/push-token',
  authenticate,
  [body('pushToken').trim().notEmpty().withMessage('Token requis')],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      await prisma.user.update({
        where: { id: req.user!.id },
        data: { pushToken: req.body.pushToken },
      });

      res.json({ success: true, message: 'Token enregistré' });
    } catch {
      res.status(500).json({ success: false, message: 'Erreur' });
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
// Exposer les critères par catégorie (pour l'app : afficher les exigences)
router.get('/vehicle-criteria', (_req, res: Response) => {
  res.json({ success: true, data: Object.values(VEHICLE_CRITERIA) });
});

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
    body('vehicleYear').optional().isInt({ min: 1980, max: new Date().getFullYear() + 1 }),
    body('hasAirConditioning').optional().isBoolean(),
    body('licensePhoto').optional().isURL(),
    body('cniPhoto').optional().isURL(),
    body('vehiclePhoto').optional().isURL(),
    body('registrationPhoto').optional().isURL(),
    body('insurancePhoto').optional().isURL(),
    body('insuranceExpiry').optional().isISO8601(),
    body('inspectionPhoto').optional().isURL(),
    body('inspectionExpiry').optional().isISO8601(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      // Valider que le véhicule respecte les critères de la catégorie demandée
      const check = validateVehicleForCategory({
        vehicleType: req.body.vehicleType,
        vehicleYear: req.body.vehicleYear ? parseInt(req.body.vehicleYear, 10) : null,
        hasAirConditioning: req.body.hasAirConditioning === true || req.body.hasAirConditioning === 'true',
      });
      if (!check.valid) {
        return res.status(400).json({
          success: false,
          message: check.errors.join(' '),
          errors: check.errors,
        });
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
          vehicleYear: req.body.vehicleYear ? parseInt(req.body.vehicleYear, 10) : null,
          hasAirConditioning: req.body.hasAirConditioning === true || req.body.hasAirConditioning === 'true',
          licensePhoto: req.body.licensePhoto,
          cniPhoto: req.body.cniPhoto,
          vehiclePhoto: req.body.vehiclePhoto,
          registrationPhoto: req.body.registrationPhoto,
          insurancePhoto: req.body.insurancePhoto,
          insuranceExpiry: req.body.insuranceExpiry ? new Date(req.body.insuranceExpiry) : null,
          inspectionPhoto: req.body.inspectionPhoto,
          inspectionExpiry: req.body.inspectionExpiry ? new Date(req.body.inspectionExpiry) : null,
          // verificationStatus reste PENDING par défaut
        },
      });

      // IMPORTANT : le rôle NE passe PAS à DRIVER ici.
      // Il sera attribué par l'admin lors de l'approbation (verificationStatus = VERIFIED).
      // Cela empêche un chauffeur non vérifié d'accepter des courses.

      res.status(201).json({
        success: true,
        message: 'Demande de chauffeur soumise ! En attente de vérification par notre équipe.',
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
    body('ownerIdPhoto').optional().isURL(),
    body('shopPhoto').optional().isURL(),
    body('businessRegPhoto').optional().isURL(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      // Documents obligatoires : pièce d'identité du gérant + photo de la boutique
      const requiredDocs = ['ownerIdPhoto', 'shopPhoto'];
      const missingDocs = requiredDocs.filter((field) => !req.body[field]);
      if (missingDocs.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Documents requis : pièce d\'identité du gérant et photo de la boutique. Le registre de commerce est optionnel.',
          missing: missingDocs,
        });
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
          ownerIdPhoto: req.body.ownerIdPhoto,
          shopPhoto: req.body.shopPhoto,
          businessRegPhoto: req.body.businessRegPhoto,
          isOpen: false, // fermée tant que non vérifiée
          // verificationStatus reste PENDING par défaut
        },
      });

      // IMPORTANT : le rôle NE passe PAS à MERCHANT ici.
      // Il sera attribué par l'admin lors de l'approbation (verificationStatus = VERIFIED).

      res.status(201).json({
        success: true,
        message: 'Demande de marchand soumise ! En attente de vérification par notre équipe.',
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
