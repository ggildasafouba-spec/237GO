import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { body, validationResult } from 'express-validator';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';

const router = Router();
const prisma = new PrismaClient();

// Rechercher des covoiturages
router.get('/search', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { departureCity, arrivalCity, date, seats = '1' } = req.query;

    const where: Record<string, unknown> = {
      status: 'ACTIVE',
      availableSeats: { gte: parseInt(seats as string) },
    };

    if (departureCity) where.departureCity = { contains: departureCity as string, mode: 'insensitive' };
    if (arrivalCity) where.arrivalCity = { contains: arrivalCity as string, mode: 'insensitive' };
    if (date) {
      const searchDate = new Date(date as string);
      where.departureTime = {
        gte: searchDate,
        lt: new Date(searchDate.getTime() + 24 * 60 * 60 * 1000),
      };
    }

    const carpools = await prisma.carpool.findMany({
      where,
      orderBy: { departureTime: 'asc' },
      include: {
        driver: {
          select: { firstName: true, lastName: true, driverProfile: { select: { averageRating: true, totalTrips: true } } },
        },
      },
    });

    res.json({ success: true, data: carpools });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur de recherche' });
  }
});

// Publier un trajet (chauffeur)
router.post(
  '/',
  authenticate,
  authorize('DRIVER'),
  [
    body('departureLat').isFloat(),
    body('departureLng').isFloat(),
    body('departureCity').trim().notEmpty(),
    body('departureAddress').trim().notEmpty(),
    body('arrivalLat').isFloat(),
    body('arrivalLng').isFloat(),
    body('arrivalCity').trim().notEmpty(),
    body('arrivalAddress').trim().notEmpty(),
    body('departureTime').isISO8601(),
    body('availableSeats').isInt({ min: 1, max: 8 }),
    body('pricePerSeat').isFloat({ min: 500 }),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const carpool = await prisma.carpool.create({
        data: {
          driverId: req.user!.id,
          ...req.body,
          departureTime: new Date(req.body.departureTime),
        },
      });

      res.status(201).json({
        success: true,
        message: 'Trajet publié !',
        data: carpool,
      });
    } catch {
      res.status(500).json({ success: false, message: 'Erreur de publication' });
    }
  }
);

// Réserver un covoiturage
router.post(
  '/:id/book',
  authenticate,
  [body('seats').optional().isInt({ min: 1 })],
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const seats = req.body.seats || 1;

      const carpool = await prisma.carpool.findUnique({ where: { id } });
      if (!carpool || carpool.status !== 'ACTIVE') {
        throw new AppError('Trajet non disponible', 400);
      }

      if (carpool.driverId === req.user!.id) {
        throw new AppError('Vous ne pouvez pas réserver votre propre trajet', 400);
      }

      if (carpool.availableSeats < seats) {
        throw new AppError(`Seulement ${carpool.availableSeats} place(s) disponible(s)`, 400);
      }

      const booking = await prisma.carpoolBooking.create({
        data: {
          carpoolId: id,
          passengerId: req.user!.id,
          seats,
        },
      });

      // Mettre à jour les places disponibles
      const newSeats = carpool.availableSeats - seats;
      await prisma.carpool.update({
        where: { id },
        data: {
          availableSeats: newSeats,
          status: newSeats === 0 ? 'FULL' : 'ACTIVE',
        },
      });

      // Notifier le chauffeur
      const io = req.app.get('io');
      io.to(`user:${carpool.driverId}`).emit('carpool_booking', {
        carpoolId: id,
        passengerId: req.user!.id,
        seats,
      });

      res.status(201).json({
        success: true,
        message: `${seats} place(s) réservée(s) ! Total: ${seats * carpool.pricePerSeat} XAF`,
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

// Mes trajets publiés (chauffeur)
router.get('/my-trips', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const carpools = await prisma.carpool.findMany({
      where: { driverId: req.user!.id },
      orderBy: { departureTime: 'desc' },
      include: {
        bookings: {
          include: { passenger: { select: { firstName: true, lastName: true, phone: true } } },
        },
      },
    });

    res.json({ success: true, data: carpools });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Mes réservations (passager)
router.get('/my-bookings', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const bookings = await prisma.carpoolBooking.findMany({
      where: { passengerId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      include: {
        carpool: {
          include: { driver: { select: { firstName: true, lastName: true, phone: true } } },
        },
      },
    });

    res.json({ success: true, data: bookings });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

export { router as carpoolRouter };
