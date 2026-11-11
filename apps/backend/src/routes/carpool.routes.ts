import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { body, validationResult } from 'express-validator';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';
import { holdFunds, confirmSide, openDispute, getEscrowForService, isServiceCompleted, cancelWithRefund } from '../services/escrow.service';
import { submitRating, RatingError } from '../services/rating.service';
import { SERVICE_PAYMENT_METHODS, SERVICE_PAYMENT_ERROR } from '../lib/paymentMethods';
import { sendPushNotification } from '../services/notification.service';

const router = Router();

// Règle d'annulation du covoiturage :
// - le CHAUFFEUR annule le trajet → tous les passagers remboursés à 100 % ;
// - un PASSAGER annule plus de 12 h avant le départ → 100 %, sinon 50 % ; après le départ → impossible.
const CARPOOL_FREE_CANCEL_HOURS = 12;
const CARPOOL_LATE_REFUND_RATIO = 0.5;

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
          select: { id: true, firstName: true, lastName: true, driverProfile: { select: { averageRating: true, totalTrips: true } } },
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
  [
    body('seats').optional().isInt({ min: 1 }),
    body('paymentMethod').optional().isIn([...SERVICE_PAYMENT_METHODS]).withMessage(SERVICE_PAYMENT_ERROR),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { id } = req.params;
      const seats = req.body.seats || 1;
      const paymentMethod = req.body.paymentMethod || 'CASH';

      const carpool = await prisma.carpool.findUnique({ where: { id } });
      if (!carpool || carpool.status !== 'ACTIVE') {
        throw new AppError('Trajet non disponible', 400);
      }

      if (carpool.driverId === req.user!.id) {
        throw new AppError('Vous ne pouvez pas réserver votre propre trajet', 400);
      }

      const totalPrice = seats * carpool.pricePerSeat;

      // 1) RÉSERVATION ATOMIQUE DES PLACES : on décrémente seulement s'il reste assez de
      //    places AU MOMENT de l'écriture. Deux passagers ne peuvent plus obtenir la
      //    même dernière place.
      const reserved = await prisma.carpool.updateMany({
        where: { id, status: 'ACTIVE', availableSeats: { gte: seats } },
        data: { availableSeats: { decrement: seats } },
      });
      if (reserved.count !== 1) {
        const fresh = await prisma.carpool.findUnique({ where: { id }, select: { availableSeats: true } });
        throw new AppError(`Seulement ${fresh?.availableSeats ?? 0} place(s) disponible(s)`, 409);
      }

      // Rendre les places si une étape suivante échoue
      const releaseSeats = () =>
        prisma.carpool.update({
          where: { id },
          data: { availableSeats: { increment: seats }, status: 'ACTIVE' },
        }).catch(() => {});

      let booking;
      try {
        // 2) La réservation est créée d'abord : l'escrow est rattaché à ELLE (et non au
        //    trajet), car un même trajet a plusieurs passagers, chacun avec son paiement.
        booking = await prisma.carpoolBooking.create({
          data: {
            carpoolId: id,
            passengerId: req.user!.id,
            seats,
            status: 'CONFIRMED',
          },
        });

        // 3) ESCROW : bloquer l'argent du passager (versé au chauffeur après validation)
        try {
          await holdFunds({
            amount: totalPrice,
            payerId: req.user!.id,
            payeeId: carpool.driverId,
            paymentMethod,
            serviceType: 'CARPOOL',
            serviceId: booking.id,
          });
        } catch (holdError) {
          await prisma.carpoolBooking.delete({ where: { id: booking.id } }).catch(() => {});
          throw holdError;
        }
      } catch (error) {
        await releaseSeats();
        throw error;
      }

      // 4) Marquer le trajet complet s'il ne reste plus de place
      await prisma.carpool.updateMany({
        where: { id, availableSeats: 0, status: 'ACTIVE' },
        data: { status: 'FULL' },
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
        message: `${seats} place(s) réservée(s) ! Total: ${totalPrice} XAF`,
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

/**
 * L'escrow d'un covoiturage est rattaché à la RÉSERVATION (un paiement par passager).
 * Pour rester compatible avec les anciennes versions de l'app qui envoient l'id du TRAJET,
 * on retrouve la réservation du passager connecté sur ce trajet.
 */
async function resolvePassengerBookingId(idParam: string, passengerId: string): Promise<string> {
  const direct = await prisma.carpoolBooking.findFirst({
    where: { id: idParam, passengerId },
    select: { id: true },
  });
  if (direct) return direct.id;

  const byTrip = await prisma.carpoolBooking.findFirst({
    where: { carpoolId: idParam, passengerId, status: { in: ['CONFIRMED', 'COMPLETED'] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (byTrip) return byTrip.id;

  throw new AppError('Réservation non trouvée', 404);
}

// Le CHAUFFEUR annule son trajet (avant le départ) : chaque passager est remboursé à 100 %.
router.patch('/:id/cancel', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const carpool = await prisma.carpool.findUnique({ where: { id }, select: { driverId: true, status: true, departureCity: true, arrivalCity: true } });
    if (!carpool || carpool.driverId !== req.user!.id) throw new AppError('Trajet non trouvé', 404);
    if (carpool.status === 'CANCELLED') return res.json({ success: true, message: 'Trajet déjà annulé', data: { refunded: 0 } });

    // Bascule atomique : impossible d'annuler un trajet parti ou terminé
    const claimed = await prisma.carpool.updateMany({
      where: { id, status: { in: ['ACTIVE', 'FULL'] } },
      data: { status: 'CANCELLED' },
    });
    if (claimed.count !== 1) throw new AppError('Le trajet est déjà parti ou terminé : annulation impossible', 409);

    const bookings = await prisma.carpoolBooking.findMany({
      where: { carpoolId: id, status: { in: ['PENDING', 'CONFIRMED'] } },
      select: { id: true, passengerId: true },
    });
    let refunded = 0;
    for (const b of bookings) {
      await prisma.carpoolBooking.update({ where: { id: b.id }, data: { status: 'CANCELLED' } });
      const escrow = await getEscrowForService('CARPOOL', b.id);
      if (escrow?.status === 'HELD') {
        try {
          await cancelWithRefund(escrow.id, 1, req.user!.id);
          refunded++;
        } catch (e) {
          console.error(`Remboursement covoiturage ${b.id} échoué:`, (e as Error).message);
        }
      }
      req.app.get('io')?.to(`user:${b.passengerId}`).emit('carpool_cancelled', { carpoolId: id, bookingId: b.id, by: 'driver' });
      sendPushNotification({
        userId: b.passengerId,
        title: 'Trajet annulé',
        body: `Le chauffeur a annulé le trajet ${carpool.departureCity} → ${carpool.arrivalCity}. Vous êtes remboursé intégralement.`,
        type: 'carpool',
        data: { carpoolId: id },
      }).catch(() => {});
    }

    res.json({
      success: true,
      message: `Trajet annulé. ${bookings.length} passager(s) prévenu(s) et remboursé(s) intégralement.`,
      data: { passengers: bookings.length, refunded },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Erreur d\'annulation' });
  }
});

// Un PASSAGER annule sa réservation (avant le départ) : 100 % à plus de 12 h, sinon 50 %.
router.patch('/bookings/:bookingId/cancel', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { bookingId } = req.params;
    const booking = await prisma.carpoolBooking.findUnique({
      where: { id: bookingId },
      include: { carpool: { select: { id: true, driverId: true, departureTime: true, status: true, departureCity: true, arrivalCity: true } } },
    });
    if (!booking || booking.passengerId !== req.user!.id) throw new AppError('Réservation non trouvée', 404);
    if (booking.status === 'CANCELLED') return res.json({ success: true, message: 'Réservation déjà annulée', data: { refund: 0 } });
    if (
      booking.status === 'COMPLETED' ||
      ['DEPARTED', 'COMPLETED'].includes(booking.carpool.status) ||
      booking.carpool.departureTime.getTime() <= Date.now()
    ) {
      throw new AppError('Le trajet est déjà parti : annulation impossible. Signalez un problème si nécessaire.', 409);
    }

    const escrow = await getEscrowForService('CARPOOL', bookingId);
    if (escrow?.status === 'DISPUTED') throw new AppError('Un litige est en cours : un administrateur va trancher', 409);

    const hoursBefore = (booking.carpool.departureTime.getTime() - Date.now()) / 3_600_000;
    const ratio = hoursBefore >= CARPOOL_FREE_CANCEL_HOURS ? 1 : CARPOOL_LATE_REFUND_RATIO;

    const claimed = await prisma.carpoolBooking.updateMany({
      where: { id: bookingId, status: { in: ['PENDING', 'CONFIRMED'] } },
      data: { status: 'CANCELLED' },
    });
    if (claimed.count !== 1) throw new AppError('Cette réservation vient d\'être modifiée, rafraîchissez', 409);

    // Les places redeviennent disponibles (et le trajet n'est plus « complet »)
    await prisma.carpool.updateMany({
      where: { id: booking.carpool.id, status: { in: ['ACTIVE', 'FULL'] } },
      data: { availableSeats: { increment: booking.seats }, status: 'ACTIVE' },
    });

    let refund = 0;
    if (escrow?.status === 'HELD') refund = (await cancelWithRefund(escrow.id, ratio, req.user!.id)).refund;

    req.app.get('io')?.to(`user:${booking.carpool.driverId}`).emit('carpool_booking_cancelled', { carpoolId: booking.carpool.id, bookingId, seats: booking.seats });
    sendPushNotification({
      userId: booking.carpool.driverId,
      title: 'Réservation annulée',
      body: `Un passager a annulé ${booking.seats} place(s) sur ${booking.carpool.departureCity} → ${booking.carpool.arrivalCity}.`,
      type: 'carpool',
      data: { carpoolId: booking.carpool.id },
    }).catch(() => {});

    const methodNote = escrow?.paymentMethod === 'CASH' ? ' (paiement en espèces : aucun montant n\'avait été débité)' : '';
    res.json({
      success: true,
      message: ratio === 1
        ? `Réservation annulée. Remboursement intégral${refund ? ` : ${refund.toLocaleString('fr-FR')} XAF sur votre portefeuille` : ''}${methodNote}.`
        : `Annulation moins de ${CARPOOL_FREE_CANCEL_HOURS} h avant le départ : remboursement de 50 %${refund ? ` (${refund.toLocaleString('fr-FR')} XAF)` : ''}${methodNote}.`,
      data: { refund, refundRatio: ratio },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Erreur d\'annulation' });
  }
});

// Le passager confirme son arrivée (libère l'escrow si le chauffeur a aussi confirmé)
router.post('/:id/confirm-arrival', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const bookingId = await resolvePassengerBookingId(req.params.id, req.user!.id);
    const id = bookingId;
    const result = await confirmSide('CARPOOL', bookingId, 'client', req.user!.id);

    const io = req.app.get('io');
    io.to(`user:${req.user!.id}`).emit('carpool_confirmed', { carpoolId: id, status: result.status });

    res.json({
      success: true,
      message: result.status === 'RELEASED'
        ? 'Trajet validé ! Le chauffeur a été payé.'
        : 'Arrivée confirmée. En attente de la confirmation du chauffeur.',
      data: result,
    });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Le chauffeur confirme la fin du trajet : cela vaut pour TOUS ses passagers du trajet
// (chaque réservation a son propre paiement en séquestre).
router.post('/:id/confirm-completion', authenticate, authorize('DRIVER'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const carpool = await prisma.carpool.findUnique({ where: { id }, select: { driverId: true } });
    if (!carpool) {
      throw new AppError('Trajet non trouvé', 404);
    }
    if (carpool.driverId !== req.user!.id) {
      throw new AppError('Vous n\'êtes pas le chauffeur de ce trajet', 403);
    }

    const bookings = await prisma.carpoolBooking.findMany({
      where: { carpoolId: id, status: 'CONFIRMED' },
      select: { id: true },
    });

    let released = 0;
    let waiting = 0;
    for (const b of bookings) {
      try {
        const result = await confirmSide('CARPOOL', b.id, 'provider', req.user!.id);
        if (result.status === 'RELEASED') released++;
        else waiting++;
      } catch {
        // Réservation sans séquestre actif (déjà payée, remboursée ou en litige) : on passe.
      }
    }

    await prisma.carpool.updateMany({
      where: { id, status: { in: ['ACTIVE', 'FULL', 'DEPARTED'] } },
      data: { status: 'COMPLETED' },
    });

    res.json({
      success: true,
      message: waiting === 0
        ? `Trajet terminé ! ${released} paiement(s) reçu(s).`
        : `Fin de trajet confirmée. ${released} paiement(s) reçu(s), ${waiting} en attente de la validation des passagers.`,
      data: { released, waiting },
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
  '/:id/dispute',
  authenticate,
  [body('reason').trim().notEmpty().withMessage('Motif du litige requis')],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }
      const id = await resolvePassengerBookingId(req.params.id, req.user!.id);
      const result = await openDispute('CARPOOL', id, req.user!.id, req.body.reason);

      // Notifier les admins
      const io = req.app.get('io');
      io.to('admins').emit('escrow_dispute', { serviceType: 'CARPOOL', serviceId: id, escrowId: result.id });

      res.json({ success: true, message: 'Litige ouvert. Un administrateur va examiner votre dossier.', data: result });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erreur' });
    }
  }
);

// Consulter le statut de l'escrow d'un trajet
router.get('/:id/escrow', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const bookingId = await resolvePassengerBookingId(req.params.id, req.user!.id).catch(() => req.params.id);
    const escrow = await getEscrowForService('CARPOOL', bookingId);
    res.json({ success: true, data: escrow });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Noter un covoiturage — bidirectionnel : passager <-> chauffeur.
// Clé = id de la réservation (un trajet a plusieurs passagers).
router.post(
  '/bookings/:bookingId/rate',
  authenticate,
  [
    body('score').isInt({ min: 1, max: 5 }).withMessage('Note entre 1 et 5'),
    body('comment').optional().trim(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { bookingId } = req.params;
      const { score, comment } = req.body;
      const userId = req.user!.id;

      const booking = await prisma.carpoolBooking.findUnique({
        where: { id: bookingId },
        include: { carpool: { select: { id: true, driverId: true } } },
      });
      if (!booking) {
        throw new AppError('Réservation non trouvée', 404);
      }

      // Garde "terminé" : l'escrow de CETTE réservation doit être libéré.
      // (On accepte aussi l'ancien schéma où l'escrow était rattaché au trajet.)
      const completed =
        (await isServiceCompleted('CARPOOL', bookingId)) ||
        (await isServiceCompleted('CARPOOL', booking.carpool.id));
      if (!completed) {
        throw new AppError('Vous ne pouvez noter qu\'un trajet terminé', 400);
      }

      const driverId = booking.carpool.driverId;
      let ratedId: string | null = null;
      if (userId === booking.passengerId) {
        ratedId = driverId; // le passager note le chauffeur
      } else if (userId === driverId) {
        ratedId = booking.passengerId; // le chauffeur note le passager
      } else {
        throw new AppError('Vous n\'avez pas participé à ce trajet', 403);
      }

      const result = await submitRating({
        serviceType: 'CARPOOL',
        serviceId: bookingId,
        raterId: userId,
        ratedId,
        score,
        comment,
      });

      res.status(201).json({
        success: true,
        message: 'Merci pour votre évaluation !',
        data: { rating: result.rating, average: result.average, totalRatings: result.totalRatings },
      });
    } catch (error) {
      if (error instanceof RatingError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erreur lors de la notation' });
    }
  }
);

export { router as carpoolRouter };
