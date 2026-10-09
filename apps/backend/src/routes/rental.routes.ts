import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { body, validationResult } from 'express-validator';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';
import { holdFunds, confirmSide, openDispute, getEscrowForService } from '../services/escrow.service';

const router = Router();
const prisma = new PrismaClient();

// Rechercher des véhicules à louer
router.get('/vehicles', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { type, minPrice, maxPrice, withDriver, lat, lng, radius = '10' } = req.query;

    const where: Record<string, unknown> = { isAvailable: true };
    if (type) where.type = type;
    if (withDriver) where.withDriver = withDriver === 'true';
    if (minPrice || maxPrice) {
      where.pricePerDay = {};
      if (minPrice) (where.pricePerDay as Record<string, number>).gte = parseFloat(minPrice as string);
      if (maxPrice) (where.pricePerDay as Record<string, number>).lte = parseFloat(maxPrice as string);
    }

    let vehicles = await prisma.vehicle.findMany({
      where,
      include: {
        owner: { select: { firstName: true, lastName: true } },
      },
      orderBy: { pricePerDay: 'asc' },
    });

    // Filtrer par proximité
    if (lat && lng) {
      const userLat = parseFloat(lat as string);
      const userLng = parseFloat(lng as string);
      const maxRadius = parseFloat(radius as string);

      vehicles = vehicles.filter((v) => {
        const dist = calculateDistance(userLat, userLng, v.locationLat, v.locationLng);
        return dist <= maxRadius;
      });
    }

    res.json({ success: true, data: vehicles });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur de recherche' });
  }
});

// Détails d'un véhicule
router.get('/vehicles/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: req.params.id },
      include: {
        owner: { select: { firstName: true, lastName: true, phone: true } },
        bookings: { where: { status: { in: ['CONFIRMED', 'ACTIVE'] } }, select: { startDate: true, endDate: true } },
      },
    });

    if (!vehicle) throw new AppError('Véhicule non trouvé', 404);

    res.json({ success: true, data: vehicle });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Publier un véhicule à louer
router.post(
  '/vehicles',
  authenticate,
  [
    body('type').isIn(['MOTO', 'CAR_ECONOMY', 'CAR_COMFORT', 'CAR_VIP', 'TRUCK']),
    body('brand').trim().notEmpty(),
    body('model').trim().notEmpty(),
    body('year').isInt({ min: 2000 }),
    body('plate').trim().notEmpty(),
    body('pricePerDay').isFloat({ min: 1000 }),
    body('locationLat').isFloat(),
    body('locationLng').isFloat(),
    body('locationAddress').trim().notEmpty(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const vehicle = await prisma.vehicle.create({
        data: {
          ownerId: req.user!.id,
          ...req.body,
        },
      });

      res.status(201).json({
        success: true,
        message: 'Véhicule publié sur GO Fleet !',
        data: vehicle,
      });
    } catch {
      res.status(500).json({ success: false, message: 'Erreur de publication' });
    }
  }
);

// Réserver un véhicule
router.post(
  '/vehicles/:id/book',
  authenticate,
  [
    body('startDate').isISO8601(),
    body('endDate').isISO8601(),
    body('withDriver').optional().isBoolean(),
    body('paymentMethod').isIn(['ORANGE_MONEY', 'MTN_MOMO', 'EXPRESS_UNION', 'CASH', 'WALLET']),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { id } = req.params;
      const { startDate, endDate, withDriver, paymentMethod } = req.body;

      const vehicle = await prisma.vehicle.findUnique({ where: { id } });
      if (!vehicle || !vehicle.isAvailable) {
        throw new AppError('Véhicule non disponible', 400);
      }

      if (vehicle.ownerId === req.user!.id) {
        throw new AppError('Vous ne pouvez pas louer votre propre véhicule', 400);
      }

      // Calculer le prix total
      const start = new Date(startDate);
      const end = new Date(endDate);
      const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

      if (days < 1) throw new AppError('Durée minimum: 1 jour', 400);

      let totalPrice = days * vehicle.pricePerDay;
      if (withDriver && vehicle.withDriver) {
        totalPrice += days * 10000; // 10,000 XAF/jour pour le chauffeur
      }

      // Vérifier disponibilité sur la période
      const conflicting = await prisma.rentalBooking.findFirst({
        where: {
          vehicleId: id,
          status: { in: ['CONFIRMED', 'ACTIVE'] },
          OR: [
            { startDate: { lte: end }, endDate: { gte: start } },
          ],
        },
      });

      if (conflicting) {
        throw new AppError('Véhicule déjà réservé sur cette période', 409);
      }

      const booking = await prisma.rentalBooking.create({
        data: {
          vehicleId: id,
          renterId: req.user!.id,
          startDate: start,
          endDate: end,
          totalPrice,
          withDriver: withDriver || false,
          paymentMethod,
          status: 'CONFIRMED',
        },
      });

      // ESCROW : bloquer l'argent du locataire (versé au propriétaire après validation)
      await holdFunds({
        amount: totalPrice,
        payerId: req.user!.id,
        payeeId: vehicle.ownerId,
        paymentMethod,
        serviceType: 'RENTAL',
        serviceId: booking.id,
      });

      // Notifier le propriétaire
      const io = req.app.get('io');
      io.to(`user:${vehicle.ownerId}`).emit('rental_booking', {
        bookingId: booking.id,
        vehicleId: id,
        days,
        totalPrice,
      });

      res.status(201).json({
        success: true,
        message: `Réservation confirmée ! ${days} jour(s) pour ${totalPrice} XAF`,
        data: booking,
      });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erreur de réservation' });
    }
  }
);

// Mes véhicules (propriétaire)
router.get('/my-vehicles', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const vehicles = await prisma.vehicle.findMany({
      where: { ownerId: req.user!.id },
      include: {
        bookings: { orderBy: { startDate: 'desc' }, take: 5 },
      },
    });

    res.json({ success: true, data: vehicles });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Mes réservations (locataire)
router.get('/my-bookings', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const bookings = await prisma.rentalBooking.findMany({
      where: { renterId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      include: {
        vehicle: {
          include: { owner: { select: { firstName: true, lastName: true } } },
        },
      },
    });

    res.json({ success: true, data: bookings });
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

// Le locataire confirme la fin de location (libère l'escrow si le propriétaire a aussi confirmé)
router.post('/bookings/:id/confirm-return', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const result = await confirmSide('RENTAL', id, 'client', req.user!.id);

    res.json({
      success: true,
      message: result.status === 'RELEASED'
        ? 'Location validée ! Le propriétaire a été payé.'
        : 'Retour confirmé. En attente de la confirmation du propriétaire.',
      data: result,
    });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Le propriétaire confirme la fin de location
router.post('/bookings/:id/confirm-completion', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const result = await confirmSide('RENTAL', id, 'provider', req.user!.id);

    res.json({
      success: true,
      message: result.status === 'RELEASED'
        ? 'Location terminée ! Paiement reçu.'
        : 'Fin de location confirmée. En attente de la validation du locataire.',
      data: result,
    });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Ouvrir un litige
router.post(
  '/bookings/:id/dispute',
  authenticate,
  [body('reason').trim().notEmpty().withMessage('Motif du litige requis')],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }
      const { id } = req.params;
      const result = await openDispute('RENTAL', id, req.user!.id, req.body.reason);

      const io = req.app.get('io');
      io.to('admins').emit('escrow_dispute', { serviceType: 'RENTAL', serviceId: id, escrowId: result.id });

      res.json({ success: true, message: 'Litige ouvert. Un administrateur va examiner votre dossier.', data: result });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erreur' });
    }
  }
);

// Consulter l'escrow d'une réservation
router.get('/bookings/:id/escrow', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const escrow = await getEscrowForService('RENTAL', req.params.id);
    res.json({ success: true, data: escrow });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

export { router as rentalRouter };
