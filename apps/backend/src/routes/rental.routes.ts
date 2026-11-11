import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { body, validationResult } from 'express-validator';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';
import { holdFunds, confirmSide, openDispute, getEscrowForService, isServiceCompleted, cancelWithRefund } from '../services/escrow.service';
import { submitRating, RatingError } from '../services/rating.service';
import { SERVICE_PAYMENT_METHODS, SERVICE_PAYMENT_ERROR } from '../lib/paymentMethods';
import { PUBLIC_VEHICLE_SELECT } from '../lib/publicSelects';
import { sendPushNotification } from '../services/notification.service';

// Règle d'annulation d'une location (par le locataire) :
// plus de 24 h avant le début → 100 % remboursé ; moins de 24 h → 50 % ; commencée → impossible.
// Le propriétaire qui annule rembourse toujours 100 %.
const RENTAL_FREE_CANCEL_HOURS = 24;
const RENTAL_LATE_REFUND_RATIO = 0.5;

const router = Router();

// Tarif du chauffeur ajouté par jour quand le véhicule est loué avec chauffeur
const DRIVER_FEE_PER_DAY = 10000;

/**
 * Calcul UNIQUE du prix d'une location. Utilisé par le devis ET par la réservation :
 * le montant payé (et affiché) est exactement celui qui sera bloqué en séquestre.
 * (Avant, l'app affichait "jours × prix/jour, chauffeur inclus" alors que le serveur
 * ajoutait 10 000 XAF/jour pour le chauffeur : le client payait plus que le prix affiché.)
 */
function computeRentalPrice(
  vehicle: { pricePerDay: number; withDriver: boolean },
  startDate: string,
  endDate: string,
  withDriver?: boolean
) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  if (!isFinite(days) || days < 1) throw new AppError('Durée minimum: 1 jour', 400);

  const driverIncluded = Boolean(withDriver && vehicle.withDriver);
  const vehicleTotal = days * vehicle.pricePerDay;
  const driverTotal = driverIncluded ? days * DRIVER_FEE_PER_DAY : 0;

  return { start, end, days, vehicleTotal, driverTotal, driverIncluded, totalPrice: vehicleTotal + driverTotal };
}

// Devis exact d'une location (avant paiement)
router.post(
  '/vehicles/:id/quote',
  authenticate,
  [
    body('startDate').isISO8601(),
    body('endDate').isISO8601(),
    body('withDriver').optional().isBoolean(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }
      const vehicle = await prisma.vehicle.findUnique({ where: { id: req.params.id } });
      if (!vehicle) throw new AppError('Véhicule non trouvé', 404);

      const q = computeRentalPrice(vehicle, req.body.startDate, req.body.endDate, req.body.withDriver);
      res.json({
        success: true,
        data: {
          days: q.days,
          vehicleTotal: q.vehicleTotal,
          driverTotal: q.driverTotal,
          driverIncluded: q.driverIncluded,
          totalPrice: q.totalPrice,
          currency: 'XAF',
        },
      });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erreur de calcul' });
    }
  }
);

// Rechercher des véhicules à louer
router.get('/vehicles', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { type, minPrice, maxPrice, withDriver, lat, lng, radius = '10' } = req.query;

    const where: Record<string, unknown> = { isAvailable: true, verificationStatus: 'VERIFIED' };
    if (type) where.type = type;
    if (withDriver) where.withDriver = withDriver === 'true';
    if (minPrice || maxPrice) {
      where.pricePerDay = {};
      if (minPrice) (where.pricePerDay as Record<string, number>).gte = parseFloat(minPrice as string);
      if (maxPrice) (where.pricePerDay as Record<string, number>).lte = parseFloat(maxPrice as string);
    }

    // Champs publics uniquement (avant : CNI du propriétaire, carte grise, assurance et
    // téléphone du mandataire envoyés à tous les utilisateurs).
    let vehicles = await prisma.vehicle.findMany({
      where,
      select: {
        ...PUBLIC_VEHICLE_SELECT,
        owner: { select: { firstName: true, lastName: true } },
      },
      orderBy: { pricePerDay: 'asc' },
      take: 200,
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
      select: {
        ...PUBLIC_VEHICLE_SELECT,
        owner: { select: { id: true, firstName: true, lastName: true, phone: true } },
        bookings: { where: { status: { in: ['CONFIRMED', 'ACTIVE'] } }, select: { startDate: true, endDate: true } },
      },
    });

    if (!vehicle) throw new AppError('Véhicule non trouvé', 404);
    if (vehicle.verificationStatus !== 'VERIFIED') {
      throw new AppError('Ce véhicule n’est pas encore vérifié', 403);
    }

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
    body('vehiclePhoto').optional().isURL(),
    body('registrationPhoto').optional().isURL(),
    body('insurancePhoto').optional().isURL(),
    body('ownerIdPhoto').optional().isURL(),
    body('localContactName').trim().notEmpty().withMessage('Nom du contact local requis'),
    body('localContactPhone').matches(/^6[0-9]{8}$/).withMessage('Numéro camerounais du contact local requis (6XXXXXXXX)'),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const requiredDocs = ['vehiclePhoto', 'registrationPhoto', 'insurancePhoto', 'ownerIdPhoto'];
      const missingDocs = requiredDocs.filter((field) => !req.body[field]);
      if (missingDocs.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Tous les documents requis doivent être téléversés : photo du véhicule, carte grise, assurance et pièce d’identité.',
          missing: missingDocs,
        });
      }

      const vehicle = await prisma.vehicle.create({
        data: {
          ownerId: req.user!.id,
          verificationStatus: 'PENDING',
          ...req.body,
          withDriver: true, // 237GO : location avec chauffeur uniquement (sécurité)
        },
      });

      res.status(201).json({
        success: true,
        message: 'Véhicule soumis à vérification. Il apparaîtra après validation de l’équipe.',
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
    body('paymentMethod').isIn([...SERVICE_PAYMENT_METHODS]).withMessage(SERVICE_PAYMENT_ERROR),
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
      if (vehicle.verificationStatus !== 'VERIFIED') {
        throw new AppError('Ce véhicule n’est pas encore vérifié', 403);
      }

      if (vehicle.ownerId === req.user!.id) {
        throw new AppError('Vous ne pouvez pas louer votre propre véhicule', 400);
      }

      // Calculer le prix total (même calcul que le devis)
      const { start, end, totalPrice, days } = computeRentalPrice(vehicle, startDate, endDate, withDriver);

      // VÉRIFICATION + CRÉATION ATOMIQUES : on verrouille la ligne du véhicule
      // (SELECT ... FOR UPDATE) pendant la transaction. Deux réservations simultanées
      // sur le même véhicule passent donc l'une APRÈS l'autre : la seconde voit la
      // première et est refusée. Avant, les deux pouvaient réserver les mêmes dates.
      const booking = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "vehicles" WHERE id = ${id} FOR UPDATE`;

        const conflicting = await tx.rentalBooking.findFirst({
          where: {
            vehicleId: id,
            status: { in: ['PENDING', 'CONFIRMED', 'ACTIVE'] },
            startDate: { lte: end },
            endDate: { gte: start },
          },
        });
        if (conflicting) {
          throw new AppError('Véhicule déjà réservé sur cette période', 409);
        }

        return tx.rentalBooking.create({
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
      });

      // ESCROW : bloquer l'argent du locataire (versé au propriétaire après validation).
      // Si le blocage échoue (solde insuffisant), on annule la réservation pour libérer les dates.
      try {
        await holdFunds({
          amount: totalPrice,
          payerId: req.user!.id,
          payeeId: vehicle.ownerId,
          paymentMethod,
          serviceType: 'RENTAL',
          serviceId: booking.id,
        });
      } catch (holdError) {
        await prisma.rentalBooking.update({
          where: { id: booking.id },
          data: { status: 'CANCELLED' },
        }).catch(() => {});
        throw holdError;
      }

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
        bookings: {
          orderBy: { startDate: 'desc' },
          take: 5,
          include: { renter: { select: { id: true, firstName: true, lastName: true } } },
        },
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

// Paiement libéré au propriétaire : la réservation est terminée.
// (Avant : elle restait « CONFIRMED » pour toujours, faussant l'historique et
// bloquant les dates du véhicule dans la détection de chevauchement.)
async function markRentalCompleted(bookingId: string) {
  await prisma.rentalBooking.updateMany({
    where: { id: bookingId, status: { in: ['PENDING', 'CONFIRMED', 'ACTIVE'] } },
    data: { status: 'COMPLETED', isPaid: true },
  });
}

// Annuler une réservation (locataire ou propriétaire), avant le début de la location.
// Le serveur applique la règle et renvoie le montant exact remboursé.
router.patch('/bookings/:id/cancel', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const booking = await prisma.rentalBooking.findUnique({
      where: { id },
      include: { vehicle: { select: { ownerId: true, brand: true, model: true } } },
    });
    if (!booking) throw new AppError('Réservation non trouvée', 404);

    const isRenter = booking.renterId === req.user!.id;
    const isOwner = booking.vehicle.ownerId === req.user!.id;
    if (!isRenter && !isOwner) throw new AppError('Réservation non trouvée', 404);

    if (booking.status === 'CANCELLED') {
      return res.json({ success: true, message: 'Réservation déjà annulée', data: { refund: 0 } });
    }
    if (booking.status === 'ACTIVE' || booking.status === 'COMPLETED' || booking.startDate.getTime() <= Date.now()) {
      throw new AppError('La location a commencé : annulation impossible. Signalez un problème si nécessaire.', 409);
    }

    const escrow = await getEscrowForService('RENTAL', id);
    if (escrow?.status === 'DISPUTED') {
      throw new AppError('Un litige est en cours sur cette réservation : un administrateur va trancher', 409);
    }

    const hoursBefore = (booking.startDate.getTime() - Date.now()) / 3_600_000;
    const ratio = isOwner || hoursBefore >= RENTAL_FREE_CANCEL_HOURS ? 1 : RENTAL_LATE_REFUND_RATIO;

    // Bascule atomique : une seule annulation passe, même si les deux parties annulent en même temps
    const claimed = await prisma.rentalBooking.updateMany({
      where: { id, status: { in: ['PENDING', 'CONFIRMED'] } },
      data: { status: 'CANCELLED' },
    });
    if (claimed.count !== 1) throw new AppError('Cette réservation vient d\'être modifiée, rafraîchissez', 409);

    let refund = 0;
    if (escrow?.status === 'HELD') {
      refund = (await cancelWithRefund(escrow.id, ratio, req.user!.id)).refund;
    }

    const otherId = isRenter ? booking.vehicle.ownerId : booking.renterId;
    const vehicleName = `${booking.vehicle.brand} ${booking.vehicle.model}`;
    req.app.get('io')?.to(`user:${otherId}`).emit('rental_cancelled', { bookingId: id, by: isRenter ? 'renter' : 'owner' });
    sendPushNotification({
      userId: otherId,
      title: 'Location annulée',
      body: isRenter
        ? `Le locataire a annulé la réservation de votre ${vehicleName}.`
        : `Le propriétaire a annulé votre location (${vehicleName}). Vous êtes remboursé intégralement.`,
      type: 'rental',
      data: { bookingId: id },
    }).catch(() => {});

    const methodNote = escrow?.paymentMethod === 'CASH' ? ' (paiement en espèces : aucun montant n\'avait été débité)' : '';
    res.json({
      success: true,
      message: ratio === 1
        ? `Réservation annulée. Remboursement intégral${refund ? ` : ${refund.toLocaleString('fr-FR')} XAF sur votre portefeuille` : ''}${methodNote}.`
        : `Réservation annulée moins de ${RENTAL_FREE_CANCEL_HOURS} h avant le début : remboursement de 50 %${refund ? ` (${refund.toLocaleString('fr-FR')} XAF)` : ''}${methodNote}.`,
      data: { refund, refundRatio: ratio },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Erreur d\'annulation' });
  }
});

// Le locataire confirme la fin de location (libère l'escrow si le propriétaire a aussi confirmé)
router.post('/bookings/:id/confirm-return', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const result = await confirmSide('RENTAL', id, 'client', req.user!.id);
    if (result.status === 'RELEASED') await markRentalCompleted(id);

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
    if (result.status === 'RELEASED') await markRentalCompleted(id);

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

// Noter une location — bidirectionnel : locataire <-> propriétaire (réservation terminée)
router.post(
  '/bookings/:id/rate',
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

      const { id } = req.params;
      const { score, comment } = req.body;
      const userId = req.user!.id;

      const booking = await prisma.rentalBooking.findUnique({
        where: { id },
        include: { vehicle: { select: { ownerId: true } } },
      });
      if (!booking) {
        throw new AppError('Réservation non trouvée', 404);
      }
      // Garde "terminé" : la location doit être finalisée (paiement libéré) pour être notée
      const completed = booking.status === 'COMPLETED' || (await isServiceCompleted('RENTAL', id));
      if (!completed) {
        throw new AppError('Vous ne pouvez noter qu\'une location terminée', 400);
      }

      const ownerId = booking.vehicle.ownerId;
      let ratedId: string | null = null;
      if (userId === booking.renterId) {
        ratedId = ownerId; // le locataire note le propriétaire
      } else if (userId === ownerId) {
        ratedId = booking.renterId; // le propriétaire note le locataire
      } else {
        throw new AppError('Vous n\'avez pas participé à cette location', 403);
      }

      const result = await submitRating({
        serviceType: 'RENTAL',
        serviceId: id,
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

export { router as rentalRouter };
