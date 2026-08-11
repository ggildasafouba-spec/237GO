import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { body, validationResult } from 'express-validator';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';

const router = Router();
const prisma = new PrismaClient();

// Estimer le prix d'une livraison
router.post(
  '/estimate',
  authenticate,
  [
    body('pickupLat').isFloat(),
    body('pickupLng').isFloat(),
    body('dropoffLat').isFloat(),
    body('dropoffLng').isFloat(),
    body('packageType').isIn(['DOCUMENT', 'SMALL_PACKAGE', 'MEDIUM_PACKAGE', 'LARGE_PACKAGE', 'FOOD', 'FRAGILE']),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { pickupLat, pickupLng, dropoffLat, dropoffLng, packageType } = req.body;

      const distance = calculateDistance(pickupLat, pickupLng, dropoffLat, dropoffLng);

      // Tarification livraison (XAF)
      const pricing: Record<string, { base: number; perKm: number }> = {
        DOCUMENT: { base: 500, perKm: 100 },
        SMALL_PACKAGE: { base: 700, perKm: 150 },
        MEDIUM_PACKAGE: { base: 1000, perKm: 200 },
        LARGE_PACKAGE: { base: 1500, perKm: 300 },
        FOOD: { base: 500, perKm: 120 },
        FRAGILE: { base: 1200, perKm: 250 },
      };

      const price = pricing[packageType];
      const estimatedPrice = Math.ceil((price.base + price.perKm * distance) / 50) * 50;

      res.json({
        success: true,
        data: {
          distance: Math.round(distance * 10) / 10,
          estimatedPrice,
          currency: 'XAF',
          packageType,
        },
      });
    } catch {
      res.status(500).json({ success: false, message: 'Erreur d\'estimation' });
    }
  }
);

// Créer une livraison
router.post(
  '/',
  authenticate,
  [
    body('pickupLat').isFloat(),
    body('pickupLng').isFloat(),
    body('pickupAddress').trim().notEmpty(),
    body('pickupContact').matches(/^6[0-9]{8}$/),
    body('dropoffLat').isFloat(),
    body('dropoffLng').isFloat(),
    body('dropoffAddress').trim().notEmpty(),
    body('dropoffContact').matches(/^6[0-9]{8}$/),
    body('packageType').isIn(['DOCUMENT', 'SMALL_PACKAGE', 'MEDIUM_PACKAGE', 'LARGE_PACKAGE', 'FOOD', 'FRAGILE']),
    body('paymentMethod').isIn(['ORANGE_MONEY', 'MTN_MOMO', 'EXPRESS_UNION', 'CASH', 'WALLET']),
    body('packageDesc').optional().trim(),
    body('packageWeight').optional().isFloat({ min: 0 }),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const {
        pickupLat, pickupLng, pickupAddress, pickupContact,
        dropoffLat, dropoffLng, dropoffAddress, dropoffContact,
        packageType, packageDesc, packageWeight, paymentMethod,
      } = req.body;

      const distance = calculateDistance(pickupLat, pickupLng, dropoffLat, dropoffLng);
      const pricing: Record<string, { base: number; perKm: number }> = {
        DOCUMENT: { base: 500, perKm: 100 },
        SMALL_PACKAGE: { base: 700, perKm: 150 },
        MEDIUM_PACKAGE: { base: 1000, perKm: 200 },
        LARGE_PACKAGE: { base: 1500, perKm: 300 },
        FOOD: { base: 500, perKm: 120 },
        FRAGILE: { base: 1200, perKm: 250 },
      };
      const price = pricing[packageType];
      const estimatedPrice = Math.ceil((price.base + price.perKm * distance) / 50) * 50;

      const delivery = await prisma.delivery.create({
        data: {
          senderId: req.user!.id,
          pickupLat,
          pickupLng,
          pickupAddress,
          pickupContact,
          dropoffLat,
          dropoffLng,
          dropoffAddress,
          dropoffContact,
          packageType,
          packageDesc,
          packageWeight,
          distance,
          estimatedPrice,
          paymentMethod,
        },
      });

      // Notifier les livreurs disponibles
      const io = req.app.get('io');
      io.to('drivers:delivery').emit('new_delivery_request', {
        deliveryId: delivery.id,
        pickup: { lat: pickupLat, lng: pickupLng, address: pickupAddress },
        dropoff: { lat: dropoffLat, lng: dropoffLng, address: dropoffAddress },
        packageType,
        estimatedPrice,
        distance,
      });

      res.status(201).json({
        success: true,
        message: 'Livraison créée ! Recherche d\'un livreur...',
        data: delivery,
      });
    } catch {
      res.status(500).json({ success: false, message: 'Erreur de création' });
    }
  }
);

// Accepter une livraison (chauffeur)
router.patch(
  '/:id/accept',
  authenticate,
  authorize('DRIVER'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;

      const delivery = await prisma.delivery.findUnique({ where: { id } });
      if (!delivery || delivery.status !== 'PENDING') {
        throw new AppError('Livraison non disponible', 400);
      }

      const updated = await prisma.delivery.update({
        where: { id },
        data: { driverId: req.user!.id, status: 'ACCEPTED' },
      });

      const io = req.app.get('io');
      io.to(`user:${delivery.senderId}`).emit('delivery_accepted', {
        deliveryId: id,
        driverId: req.user!.id,
      });

      res.json({ success: true, data: updated });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erreur' });
    }
  }
);

// Mettre à jour le statut
router.patch(
  '/:id/status',
  authenticate,
  authorize('DRIVER'),
  [body('status').isIn(['PICKING_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'])],
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      const updateData: Record<string, unknown> = { status };
      if (status === 'IN_TRANSIT') updateData.pickedUpAt = new Date();
      if (status === 'DELIVERED') updateData.deliveredAt = new Date();
      if (status === 'CANCELLED') updateData.cancelledAt = new Date();

      const delivery = await prisma.delivery.update({
        where: { id },
        data: updateData,
      });

      const io = req.app.get('io');
      io.to(`user:${delivery.senderId}`).emit('delivery_status_update', {
        deliveryId: id,
        status,
      });

      res.json({ success: true, data: delivery });
    } catch {
      res.status(500).json({ success: false, message: 'Erreur' });
    }
  }
);

// Historique des livraisons
router.get('/history', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { page = '1', limit = '20' } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const where = req.user!.role === 'DRIVER'
      ? { driverId: req.user!.id }
      : { senderId: req.user!.id };

    const [deliveries, total] = await Promise.all([
      prisma.delivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit as string),
      }),
      prisma.delivery.count({ where }),
    ]);

    res.json({
      success: true,
      data: { deliveries, total, page: parseInt(page as string) },
    });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export { router as deliveryRouter };
