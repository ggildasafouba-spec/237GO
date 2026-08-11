import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { body, validationResult } from 'express-validator';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';

const router = Router();
const prisma = new PrismaClient();

// Calculer le prix estimé
router.post(
  '/estimate',
  authenticate,
  [
    body('pickupLat').isFloat(),
    body('pickupLng').isFloat(),
    body('dropoffLat').isFloat(),
    body('dropoffLng').isFloat(),
    body('vehicleType').isIn(['MOTO', 'CAR_ECONOMY', 'CAR_COMFORT', 'CAR_VIP']),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { pickupLat, pickupLng, dropoffLat, dropoffLng, vehicleType } = req.body;

      // Calcul de distance (Haversine)
      const distance = calculateDistance(pickupLat, pickupLng, dropoffLat, dropoffLng);
      const duration = Math.ceil(distance * 3); // estimation grossière: 3 min/km

      // Tarification par type de véhicule (en XAF)
      const pricing: Record<string, { base: number; perKm: number; perMin: number }> = {
        MOTO: { base: 200, perKm: 150, perMin: 15 },
        CAR_ECONOMY: { base: 500, perKm: 300, perMin: 25 },
        CAR_COMFORT: { base: 1000, perKm: 450, perMin: 35 },
        CAR_VIP: { base: 2000, perKm: 700, perMin: 50 },
      };

      const price = pricing[vehicleType];
      const estimatedPrice = Math.ceil(
        (price.base + price.perKm * distance + price.perMin * duration) / 50
      ) * 50; // Arrondir aux 50 XAF

      res.json({
        success: true,
        data: {
          distance: Math.round(distance * 10) / 10,
          duration,
          estimatedPrice,
          currency: 'XAF',
          vehicleType,
        },
      });
    } catch {
      res.status(500).json({ success: false, message: 'Erreur lors de l\'estimation' });
    }
  }
);

// Créer une course
router.post(
  '/',
  authenticate,
  authorize('PASSENGER'),
  [
    body('pickupLat').isFloat(),
    body('pickupLng').isFloat(),
    body('pickupAddress').trim().notEmpty(),
    body('dropoffLat').isFloat(),
    body('dropoffLng').isFloat(),
    body('dropoffAddress').trim().notEmpty(),
    body('vehicleType').isIn(['MOTO', 'CAR_ECONOMY', 'CAR_COMFORT', 'CAR_VIP']),
    body('paymentMethod').isIn(['ORANGE_MONEY', 'MTN_MOMO', 'EXPRESS_UNION', 'CASH', 'WALLET']),
    body('proposedPrice').optional().isFloat({ min: 0 }),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const {
        pickupLat, pickupLng, pickupAddress,
        dropoffLat, dropoffLng, dropoffAddress,
        vehicleType, paymentMethod, proposedPrice,
      } = req.body;

      // Calcul du prix estimé
      const distance = calculateDistance(pickupLat, pickupLng, dropoffLat, dropoffLng);
      const duration = Math.ceil(distance * 3);
      const pricing: Record<string, { base: number; perKm: number; perMin: number }> = {
        MOTO: { base: 200, perKm: 150, perMin: 15 },
        CAR_ECONOMY: { base: 500, perKm: 300, perMin: 25 },
        CAR_COMFORT: { base: 1000, perKm: 450, perMin: 35 },
        CAR_VIP: { base: 2000, perKm: 700, perMin: 50 },
      };
      const price = pricing[vehicleType];
      const estimatedPrice = Math.ceil(
        (price.base + price.perKm * distance + price.perMin * duration) / 50
      ) * 50;

      const ride = await prisma.ride.create({
        data: {
          passengerId: req.user!.id,
          pickupLat,
          pickupLng,
          pickupAddress,
          dropoffLat,
          dropoffLng,
          dropoffAddress,
          vehicleType,
          distance,
          duration,
          estimatedPrice,
          proposedPrice: proposedPrice || null,
          paymentMethod,
        },
      });

      // Notifier les chauffeurs à proximité via Socket.IO
      const io = req.app.get('io');
      io.to(`drivers:${vehicleType}`).emit('new_ride_request', {
        rideId: ride.id,
        pickup: { lat: pickupLat, lng: pickupLng, address: pickupAddress },
        dropoff: { lat: dropoffLat, lng: dropoffLng, address: dropoffAddress },
        estimatedPrice,
        proposedPrice: proposedPrice || null,
        vehicleType,
        distance,
        duration,
      });

      res.status(201).json({
        success: true,
        message: 'Course créée ! Recherche d\'un chauffeur...',
        data: ride,
      });
    } catch {
      res.status(500).json({ success: false, message: 'Erreur lors de la création de la course' });
    }
  }
);

// Accepter une course (chauffeur)
router.patch(
  '/:id/accept',
  authenticate,
  authorize('DRIVER'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;

      const ride = await prisma.ride.findUnique({ where: { id } });
      if (!ride || ride.status !== 'PENDING') {
        throw new AppError('Course non disponible', 400);
      }

      const updatedRide = await prisma.ride.update({
        where: { id },
        data: {
          driverId: req.user!.id,
          status: 'ACCEPTED',
        },
        include: {
          driver: {
            include: { driverProfile: true },
          },
        },
      });

      // Notifier le passager
      const io = req.app.get('io');
      io.to(`user:${ride.passengerId}`).emit('ride_accepted', {
        rideId: id,
        driver: updatedRide.driver,
      });

      res.json({
        success: true,
        message: 'Course acceptée',
        data: updatedRide,
      });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erreur' });
    }
  }
);

// Mettre à jour le statut d'une course
router.patch(
  '/:id/status',
  authenticate,
  authorize('DRIVER'),
  [body('status').isIn(['DRIVER_ARRIVING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])],
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { status, cancelReason } = req.body;

      const updateData: Record<string, unknown> = { status };

      if (status === 'IN_PROGRESS') {
        updateData.startedAt = new Date();
      } else if (status === 'COMPLETED') {
        updateData.completedAt = new Date();
        updateData.finalPrice = undefined; // sera calculé
      } else if (status === 'CANCELLED') {
        updateData.cancelledAt = new Date();
        updateData.cancelReason = cancelReason || '';
      }

      const ride = await prisma.ride.update({
        where: { id },
        data: updateData,
      });

      // Notifier le passager du changement de statut
      const io = req.app.get('io');
      io.to(`user:${ride.passengerId}`).emit('ride_status_update', {
        rideId: id,
        status,
      });

      // Si complétée, ajouter les points de fidélité
      if (status === 'COMPLETED') {
        const points = Math.floor((ride.estimatedPrice || 0) / 100); // 1 point / 100 XAF
        await prisma.loyaltyPoints.update({
          where: { userId: ride.passengerId },
          data: { points: { increment: points } },
        });
      }

      res.json({ success: true, data: ride });
    } catch {
      res.status(500).json({ success: false, message: 'Erreur de mise à jour' });
    }
  }
);

// Historique des courses
router.get('/history', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { page = '1', limit = '20' } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const where = req.user!.role === 'DRIVER'
      ? { driverId: req.user!.id }
      : { passengerId: req.user!.id };

    const [rides, total] = await Promise.all([
      prisma.ride.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit as string),
        include: {
          passenger: { select: { firstName: true, lastName: true, phone: true } },
          driver: { select: { firstName: true, lastName: true, phone: true } },
        },
      }),
      prisma.ride.count({ where }),
    ]);

    res.json({
      success: true,
      data: { rides, total, page: parseInt(page as string), pages: Math.ceil(total / parseInt(limit as string)) },
    });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Formule Haversine pour calculer la distance entre deux points GPS
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Rayon de la Terre en km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

export { router as rideRouter };
