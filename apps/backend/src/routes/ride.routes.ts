import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { body, validationResult } from 'express-validator';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';
import { holdFunds, refundFunds, confirmSide, openDispute, getEscrowForService } from '../services/escrow.service';
import { sendPushNotification } from '../services/notification.service';
import { aiChat, isAiConfigured, parseAiJson } from '../services/ai.service';
import { submitRating, RatingError } from '../services/rating.service';
import { dispatchToNearbyDrivers } from '../services/matching.service';
import { SERVICE_PAYMENT_METHODS, SERVICE_PAYMENT_ERROR } from '../lib/paymentMethods';
import { PUBLIC_USER_SELECT, PUBLIC_DRIVER_PROFILE_SELECT } from '../lib/publicSelects';
import { getPricingSettings, getCommissionRate, computeRidePrice, estimateDurationMin } from '../lib/pricingSettings';

const router = Router();

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
      const duration = estimateDurationMin(distance); // estimation grossière: 3 min/km

      // Tarification par type de véhicule (en XAF) : réglages de l'admin, voir lib/pricingSettings.ts
      const { tariffs } = await getPricingSettings();
      const tariff = tariffs[vehicleType as keyof typeof tariffs];
      const estimatedPrice = computeRidePrice(tariff, distance, duration);

      res.json({
        success: true,
        data: {
          distance: Math.round(distance * 10) / 10,
          duration,
          estimatedPrice,
          minFare: tariff.minFare,
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
    body('paymentMethod').isIn([...SERVICE_PAYMENT_METHODS]).withMessage(SERVICE_PAYMENT_ERROR),
    body('proposedPrice').optional().isFloat({ min: 0 }),
    body('passengerCount').optional().isInt({ min: 1, max: 4 }),
    body('luggageSize').optional().isIn(['NONE', 'SMALL', 'LARGE']),
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
        passengerCount, luggageSize,
      } = req.body;

      // Calcul du prix estimé (même calcul que /estimate : un seul endroit, lib/pricingSettings.ts)
      const distance = calculateDistance(pickupLat, pickupLng, dropoffLat, dropoffLng);
      const duration = estimateDurationMin(distance);
      const { tariffs } = await getPricingSettings();
      const estimatedPrice = computeRidePrice(tariffs[vehicleType as keyof typeof tariffs], distance, duration);

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
          passengerCount: passengerCount || 1,
          luggageSize: luggageSize || 'NONE',
        },
      });

      // Notifier uniquement les chauffeurs à proximité (du plus proche au plus loin),
      // avec élargissement automatique du rayon si personne n'accepte.
      const io = req.app.get('io');
      await dispatchToNearbyDrivers({
        io,
        event: 'new_ride_request',
        vehicleType,
        pickupLat,
        pickupLng,
        serviceType: 'ride',
        serviceId: ride.id,
        payload: {
          rideId: ride.id,
          pickup: { lat: pickupLat, lng: pickupLng, address: pickupAddress },
          dropoff: { lat: dropoffLat, lng: dropoffLng, address: dropoffAddress },
          estimatedPrice,
          proposedPrice: proposedPrice || null,
          vehicleType,
          distance,
          duration,
          passengerCount: passengerCount || 1,
          luggageSize: luggageSize || 'NONE',
        },
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

// ========== PRISE EN CHARGE D'UNE COURSE ==========
// Deux façons d'obtenir une course :
//  1. le chauffeur accepte le prix demandé (PATCH /:id/accept) ;
//  2. le chauffeur propose un AUTRE prix (POST /:id/offers) et le passager choisit son offre
//     (POST /:id/offers/:offerId/accept). C'est la négociation, comme sur inDrive.
// Les deux passent par assignDriverToRide : même protection contre les doubles prises en charge,
// même blocage du paiement en séquestre.

/** Une offre n'est valable que 3 minutes : au-delà, le chauffeur est sûrement parti ailleurs. */
const OFFER_TTL_MS = 3 * 60 * 1000;

/** Courses en cours pour un chauffeur (il ne peut pas en prendre une autre). */
const ACTIVE_RIDE_STATUSES = ['ACCEPTED', 'DRIVER_ARRIVING', 'IN_PROGRESS'] as const;

/**
 * COURSE EN ESPÈCES : le chauffeur encaisse le cash en main propre, il doit donc avoir de
 * quoi couvrir la commission 237GO sur son portefeuille pour pouvoir la prendre.
 */
async function assertCashCommissionCovered(driverId: string, paymentMethod: string, price: number) {
  if (paymentMethod !== 'CASH') return;
  const commission = Math.round(price * (await getCommissionRate()));
  const wallet = await prisma.wallet.findUnique({ where: { userId: driverId } });
  if (!wallet || wallet.balance < commission) {
    throw new AppError(
      `Solde insuffisant pour accepter une course en espèces. ` +
      `Commission requise : ${commission} XAF. Rechargez votre portefeuille.`,
      402 // Payment Required
    );
  }
}

/**
 * Ferme les offres encore en attente d'une course (course prise, annulée...) et prévient les
 * chauffeurs concernés pour que leur écran n'attende plus pour rien.
 */
async function closePendingOffers(io: any, rideId: string, exceptDriverId?: string) {
  const pending = await prisma.rideOffer.findMany({
    where: { rideId, status: 'PENDING', ...(exceptDriverId ? { driverId: { not: exceptDriverId } } : {}) },
    select: { id: true, driverId: true },
  });
  if (pending.length === 0) return;
  await prisma.rideOffer.updateMany({ where: { id: { in: pending.map((o) => o.id) } }, data: { status: 'EXPIRED' } });
  for (const o of pending) io.to(`user:${o.driverId}`).emit('ride_offer_closed', { rideId });
}

/**
 * Attribue la course à un chauffeur et bloque le paiement du passager.
 * agreedPrice : prix convenu quand le passager a choisi une offre (il remplace alors le prix
 * proposé au départ). Sans lui : prix proposé par le passager, sinon prix estimé.
 */
async function assignDriverToRide(params: { io: any; rideId: string; driverId: string; agreedPrice?: number }) {
  const { io, rideId, driverId, agreedPrice } = params;

  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!ride || ride.status !== 'PENDING') {
    throw new AppError('Course non disponible', 400);
  }

  const ridePrice = agreedPrice ?? (ride.proposedPrice || ride.estimatedPrice);
  await assertCashCommissionCovered(driverId, ride.paymentMethod, ridePrice);

  // PRISE EN CHARGE ATOMIQUE : si deux chauffeurs appuient sur "Accepter" en même temps,
  // un seul obtient count = 1. L'autre reçoit "déjà prise" au lieu d'écraser le premier.
  const claimed = await prisma.ride.updateMany({
    where: { id: rideId, status: 'PENDING', driverId: null },
    data: { driverId, status: 'ACCEPTED', ...(agreedPrice !== undefined ? { proposedPrice: agreedPrice } : {}) },
  });
  if (claimed.count !== 1) {
    throw new AppError('Course déjà prise par un autre chauffeur', 409);
  }

  // ESCROW : bloquer le prix de la course (prix convenu, négocié ou estimé)
  let escrow;
  try {
    escrow = await holdFunds({
      amount: ridePrice,
      payerId: ride.passengerId,
      payeeId: driverId,
      paymentMethod: ride.paymentMethod,
      serviceType: 'RIDE',
      serviceId: rideId,
    });
  } catch (holdError) {
    // Blocage impossible (ex. solde du passager insuffisant) : on remet la course
    // en attente au lieu de la laisser "acceptée" sans paiement (et on rend son prix d'origine).
    await prisma.ride.updateMany({
      where: { id: rideId, driverId, status: 'ACCEPTED' },
      data: { driverId: null, status: 'PENDING', ...(agreedPrice !== undefined ? { proposedPrice: ride.proposedPrice } : {}) },
    });
    throw holdError;
  }

  // Le passager a pu annuler pendant l'opération : dans ce cas on rend l'argent.
  const stillAccepted = await prisma.ride.findFirst({
    where: { id: rideId, driverId, status: 'ACCEPTED' },
    select: { id: true },
  });
  if (!stillAccepted) {
    await refundFunds(escrow.id, 'auto').catch(() => {});
    throw new AppError('Cette course vient d\'être annulée par le passager', 409);
  }

  const updatedRide = await prisma.ride.findUniqueOrThrow({
    where: { id: rideId },
    // Ces données partent au PASSAGER (réponse + temps réel) : uniquement le public.
    // Avant : utilisateur complet (mot de passe chiffré, code de réinitialisation) et
    // profil chauffeur complet (CNI, permis, photos des documents).
    include: {
      driver: {
        select: { ...PUBLIC_USER_SELECT, driverProfile: { select: PUBLIC_DRIVER_PROFILE_SELECT } },
      },
      passenger: {
        select: { firstName: true, lastName: true, phone: true },
      },
    },
  });

  // L'offre de ce chauffeur (s'il en avait une) est retenue ; les autres sont fermées.
  await prisma.rideOffer.updateMany({ where: { rideId, driverId, status: 'PENDING' }, data: { status: 'ACCEPTED' } }).catch(() => {});
  await closePendingOffers(io, rideId, driverId).catch((e) => console.error('Fermeture des offres échouée:', (e as Error).message));

  // Notifier le passager (temps réel + push)
  io.to(`user:${ride.passengerId}`).emit('ride_accepted', {
    rideId,
    driver: updatedRide.driver,
    price: ridePrice,
  });
  if (agreedPrice === undefined) {
    const driverName = updatedRide.driver ? `${updatedRide.driver.firstName} ${updatedRide.driver.lastName}` : 'Votre chauffeur';
    await sendPushNotification({
      userId: ride.passengerId,
      title: '🚗 Chauffeur trouvé !',
      body: `${driverName} arrive pour votre course.`,
      type: 'ride',
      data: { rideId },
    });
  }

  return { ride: updatedRide, price: ridePrice };
}

// Accepter une course au prix demandé (chauffeur)
router.patch(
  '/:id/accept',
  authenticate,
  authorize('DRIVER'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;

      // Vérifier que le chauffeur est bien vérifié
      const driverProfile = await prisma.driverProfile.findUnique({
        where: { userId: req.user!.id },
      });
      if (!driverProfile || driverProfile.verificationStatus !== 'VERIFIED') {
        throw new AppError('Votre compte chauffeur n\'est pas encore vérifié', 403);
      }

      const { ride } = await assignDriverToRide({ io: req.app.get('io'), rideId: id, driverId: req.user!.id });

      res.json({
        success: true,
        message: 'Course acceptée',
        data: ride,
      });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erreur' });
    }
  }
);

// ========== NÉGOCIATION : OFFRES DES CHAUFFEURS ==========

/** Ce que le passager voit d'un chauffeur qui lui fait une offre (jamais son téléphone avant le choix). */
const OFFER_DRIVER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  avatar: true,
  driverProfile: {
    select: {
      vehicleType: true,
      vehiclePlate: true,
      vehicleBrand: true,
      vehicleModel: true,
      hasAirConditioning: true,
      vehiclePhoto: true,
      averageRating: true,
      totalTrips: true,
      currentLat: true,
      currentLng: true,
    },
  },
} as const;

function toOfferDto(
  offer: { id: string; price: number; updatedAt: Date; driver: any },
  pickupLat: number,
  pickupLng: number
) {
  const p = offer.driver?.driverProfile;
  const dist = p?.currentLat != null && p?.currentLng != null
    ? calculateDistance(pickupLat, pickupLng, p.currentLat, p.currentLng)
    : null;
  return {
    id: offer.id,
    price: offer.price,
    sentAt: offer.updatedAt,
    distanceToPickup: dist != null ? Math.round(dist * 10) / 10 : null,
    etaMin: dist != null ? Math.max(1, Math.ceil(dist * 3)) : null,
    driver: {
      id: offer.driver.id,
      firstName: offer.driver.firstName,
      lastName: offer.driver.lastName,
      avatar: offer.driver.avatar,
      vehicleType: p?.vehicleType ?? null,
      vehicleBrand: p?.vehicleBrand ?? null,
      vehicleModel: p?.vehicleModel ?? null,
      vehiclePlate: p?.vehiclePlate ?? null,
      hasAirConditioning: p?.hasAirConditioning ?? null,
      vehiclePhoto: p?.vehiclePhoto ?? null,
      averageRating: p?.averageRating ?? null,
      totalTrips: p?.totalTrips ?? null,
    },
  };
}

/** Offres valables d'une course en attente, de la moins chère à la plus chère. */
async function listPendingOffers(ride: { id: string; pickupLat: number; pickupLng: number }) {
  const offers = await prisma.rideOffer.findMany({
    where: { rideId: ride.id, status: 'PENDING', updatedAt: { gte: new Date(Date.now() - OFFER_TTL_MS) } },
    orderBy: { price: 'asc' },
    include: { driver: { select: OFFER_DRIVER_SELECT } },
  });
  return offers.map((o) => toOfferDto(o, ride.pickupLat, ride.pickupLng));
}

// Le chauffeur propose un autre prix pour une course en attente
router.post(
  '/:id/offers',
  authenticate,
  authorize('DRIVER'),
  [body('price').isFloat({ min: 1 }).withMessage('Prix invalide')],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Prix invalide', errors: errors.array() });
      }
      const { id } = req.params;
      const driverId = req.user!.id;
      const price = Math.round(Number(req.body.price));

      const driverProfile = await prisma.driverProfile.findUnique({ where: { userId: driverId } });
      if (!driverProfile || driverProfile.verificationStatus !== 'VERIFIED') {
        throw new AppError('Votre compte chauffeur n\'est pas encore vérifié', 403);
      }

      const ride = await prisma.ride.findUnique({ where: { id } });
      if (!ride || ride.status !== 'PENDING' || ride.driverId) {
        throw new AppError('Course non disponible', 400);
      }
      if (ride.passengerId === driverId) {
        throw new AppError('Vous ne pouvez pas proposer un prix pour votre propre course', 403);
      }
      if (driverProfile.vehicleType !== ride.vehicleType) {
        throw new AppError('Cette course est réservée à un autre type de véhicule', 403);
      }

      // Garde-fous : ni en dessous du prix minimum du tarif, ni une faute de frappe manifeste.
      const { tariffs } = await getPricingSettings();
      const minFare = tariffs[ride.vehicleType as keyof typeof tariffs].minFare;
      const maxPrice = Math.round(ride.estimatedPrice * 3);
      if (price < minFare) {
        throw new AppError(`Le prix minimum pour ce type de course est de ${minFare} F`, 400);
      }
      if (price > maxPrice) {
        throw new AppError(`Prix trop élevé : le maximum est de ${maxPrice} F`, 400);
      }

      await assertCashCommissionCovered(driverId, ride.paymentMethod, price);

      const existing = await prisma.rideOffer.findUnique({ where: { rideId_driverId: { rideId: id, driverId } } });
      if (existing?.status === 'DECLINED') {
        throw new AppError('Le passager a refusé votre offre pour cette course', 409);
      }

      const offer = await prisma.rideOffer.upsert({
        where: { rideId_driverId: { rideId: id, driverId } },
        create: { rideId: id, driverId, price },
        update: { price, status: 'PENDING' },
        include: { driver: { select: OFFER_DRIVER_SELECT } },
      });
      const dto = toOfferDto(offer, ride.pickupLat, ride.pickupLng);

      const io = req.app.get('io');
      io.to(`user:${ride.passengerId}`).emit('ride_offer', { rideId: id, offer: dto });
      await sendPushNotification({
        userId: ride.passengerId,
        title: '💬 Un chauffeur vous fait une offre',
        body: `${offer.driver.firstName} propose ${price.toLocaleString('fr-FR')} F pour votre course.`,
        type: 'ride',
        data: { rideId: id },
      });

      res.status(201).json({ success: true, message: 'Offre envoyée', data: dto });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erreur lors de l\'envoi de l\'offre' });
    }
  }
);

// Le passager choisit une offre : le chauffeur est attribué au prix de l'offre
router.post(
  '/:id/offers/:offerId/accept',
  authenticate,
  authorize('PASSENGER'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id, offerId } = req.params;
      const io = req.app.get('io');

      const ride = await prisma.ride.findUnique({ where: { id } });
      if (!ride || ride.passengerId !== req.user!.id) {
        throw new AppError('Course introuvable', 404);
      }
      if (ride.status !== 'PENDING') {
        throw new AppError('Cette course a déjà un chauffeur ou n\'est plus en attente', 409);
      }

      const offer = await prisma.rideOffer.findFirst({
        where: { id: offerId, rideId: id },
        include: { driver: { select: { driverProfile: { select: { isOnline: true } } } } },
      });
      if (!offer || offer.status !== 'PENDING') {
        throw new AppError('Cette offre n\'est plus disponible', 409);
      }
      const expire = () => prisma.rideOffer.update({ where: { id: offer.id }, data: { status: 'EXPIRED' } }).catch(() => {});
      if (Date.now() - offer.updatedAt.getTime() > OFFER_TTL_MS) {
        await expire();
        throw new AppError('Cette offre a expiré. Attendez une nouvelle proposition.', 410);
      }

      // Le chauffeur doit toujours être en ligne et libre
      const busy = await prisma.ride.count({
        where: { driverId: offer.driverId, status: { in: [...ACTIVE_RIDE_STATUSES] } },
      });
      if (!offer.driver.driverProfile?.isOnline || busy > 0) {
        await expire();
        throw new AppError('Ce chauffeur n\'est plus disponible. Choisissez une autre offre.', 409);
      }

      let assigned;
      try {
        assigned = await assignDriverToRide({ io, rideId: id, driverId: offer.driverId, agreedPrice: offer.price });
      } catch (e) {
        if (e instanceof AppError && e.statusCode === 402) {
          // Course en espèces : le chauffeur n'a plus de quoi couvrir la commission
          await expire();
          throw new AppError('Ce chauffeur ne peut plus prendre cette course. Choisissez une autre offre.', 409);
        }
        throw e;
      }

      // Prévenir le chauffeur choisi : il peut démarrer la course
      io.to(`user:${offer.driverId}`).emit('ride_offer_accepted', {
        rideId: id,
        price: assigned.price,
        pickup: { lat: ride.pickupLat, lng: ride.pickupLng, address: ride.pickupAddress },
        dropoff: { lat: ride.dropoffLat, lng: ride.dropoffLng, address: ride.dropoffAddress },
        passengerPhone: assigned.ride.passenger?.phone ?? null,
      });
      await sendPushNotification({
        userId: offer.driverId,
        title: '✅ Offre acceptée !',
        body: `Le passager a accepté votre prix de ${assigned.price.toLocaleString('fr-FR')} F.`,
        type: 'ride',
        data: { rideId: id },
      });

      res.json({ success: true, message: 'Chauffeur choisi', data: assigned.ride });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erreur' });
    }
  }
);

// Le passager refuse une offre
router.post(
  '/:id/offers/:offerId/decline',
  authenticate,
  authorize('PASSENGER'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id, offerId } = req.params;
      const ride = await prisma.ride.findUnique({ where: { id }, select: { passengerId: true } });
      if (!ride || ride.passengerId !== req.user!.id) {
        throw new AppError('Course introuvable', 404);
      }
      const declined = await prisma.rideOffer.updateMany({
        where: { id: offerId, rideId: id, status: 'PENDING' },
        data: { status: 'DECLINED' },
      });
      if (declined.count === 1) {
        const offer = await prisma.rideOffer.findUnique({ where: { id: offerId }, select: { driverId: true } });
        if (offer) req.app.get('io').to(`user:${offer.driverId}`).emit('ride_offer_declined', { rideId: id });
      }
      res.json({ success: true, message: 'Offre refusée' });
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

      // Récupérer la course existante
      const existingRide = await prisma.ride.findUnique({ where: { id } });
      if (!existingRide) {
        throw new AppError('Course non trouvée', 404);
      }

      // Vérifier que c'est bien le chauffeur assigné
      if (existingRide.driverId !== req.user!.id) {
        throw new AppError('Vous n\'êtes pas le chauffeur de cette course', 403);
      }

      // Une course terminée ou annulée ne change plus d'état (avant : on pouvait « terminer »
      // une course annulée ou annuler une course terminée).
      if (existingRide.status === 'COMPLETED' || existingRide.status === 'CANCELLED') {
        throw new AppError(`Course déjà ${existingRide.status === 'COMPLETED' ? 'terminée' : 'annulée'}`, 409);
      }

      const updateData: Record<string, unknown> = { status };

      if (status === 'IN_PROGRESS') {
        updateData.startedAt = new Date();
      } else if (status === 'COMPLETED') {
        updateData.completedAt = new Date();
        // Le prix final = prix négocié s'il existe, sinon prix estimé
        updateData.finalPrice = existingRide.proposedPrice || existingRide.estimatedPrice;
      } else if (status === 'CANCELLED') {
        updateData.cancelledAt = new Date();
        updateData.cancelReason = cancelReason || '';
      }

      // Transition atomique depuis l'état lu (évite deux mises à jour concurrentes contradictoires)
      const moved = await prisma.ride.updateMany({
        where: { id, status: existingRide.status },
        data: updateData,
      });
      if (moved.count !== 1) {
        throw new AppError('La course vient de changer d\'état, rafraîchissez', 409);
      }
      const ride = await prisma.ride.findUniqueOrThrow({ where: { id } });

      // Annulation par le CHAUFFEUR : le passager doit être remboursé.
      // (Avant : aucun remboursement, l'argent du passager restait bloqué en séquestre.)
      if (status === 'CANCELLED') {
        try {
          const escrow = await getEscrowForService('RIDE', id);
          if (escrow && (escrow.status === 'HELD' || escrow.status === 'DISPUTED')) {
            await refundFunds(escrow.id, 'auto');
          }
        } catch (refundError) {
          console.error(`Remboursement course ${id} (annulée par le chauffeur) échoué:`, (refundError as Error).message);
        }
      }

      // Notifier le passager du changement de statut
      const io = req.app.get('io');
      io.to(`user:${ride.passengerId}`).emit('ride_status_update', {
        rideId: id,
        status,
        finalPrice: ride.finalPrice,
      });

      // Si complétée : le chauffeur confirme sa fin de course (côté prestataire).
      // L'argent reste en séquestre jusqu'à ce que le passager valide aussi.
      if (status === 'COMPLETED') {
        const finalPrice = ride.finalPrice || 0;

        // Confirmation côté chauffeur dans l'escrow
        await confirmSide('RIDE', id, 'provider', req.user!.id).catch(() => {});

        // Incrémenter le nombre de courses du chauffeur
        if (ride.driverId) {
          await prisma.driverProfile.update({
            where: { userId: ride.driverId },
            data: { totalTrips: { increment: 1 } },
          }).catch(() => {});
        }

        // Demander au passager de valider la fin de course
        io.to(`user:${ride.passengerId}`).emit('ride_completed', {
          rideId: id,
          finalPrice,
          action: 'confirm_arrival', // le passager doit confirmer pour libérer le paiement
        });
      }

      res.json({ success: true, data: ride });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erreur de mise à jour' });
    }
  }
);

// Annuler une course (passager uniquement, tant que la course est PENDING ou ACCEPTED)
router.patch(
  '/:id/cancel',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const ride = await prisma.ride.findUnique({ where: { id } });
      if (!ride) throw new AppError('Course non trouvée', 404);

      // Seul le passager peut annuler via cette route
      if (ride.passengerId !== req.user!.id) {
        throw new AppError('Vous n\'êtes pas le passager de cette course', 403);
      }

      // On ne peut annuler qu'une course encore en attente ou acceptée
      if (!['PENDING', 'ACCEPTED'].includes(ride.status)) {
        throw new AppError(`Impossible d'annuler une course en statut ${ride.status}`, 400);
      }

      // Annulation ATOMIQUE : ne passe que si la course est encore PENDING/ACCEPTED
      // (évite d'annuler une course qu'un chauffeur vient de démarrer).
      const cancelled = await prisma.ride.updateMany({
        where: { id, status: { in: ['PENDING', 'ACCEPTED'] } },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelReason: reason || 'Annulé par le passager',
        },
      });
      if (cancelled.count !== 1) {
        throw new AppError('Cette course ne peut plus être annulée', 409);
      }
      const updated = await prisma.ride.findUniqueOrThrow({ where: { id } });

      // Rembourser l'escrow s'il existe. (Avant : refundFunds('RIDE', id) recevait un type de
      // service à la place d'un identifiant d'escrow, donc le remboursement n'avait jamais lieu.)
      const io = req.app.get('io');
      try {
        const escrow = await getEscrowForService('RIDE', id);
        if (escrow && (escrow.status === 'HELD' || escrow.status === 'DISPUTED')) {
          await refundFunds(escrow.id, 'auto');
        }
      } catch (refundError) {
        console.error(`Remboursement escrow course ${id} échoué:`, (refundError as Error).message);
      }

      // Les chauffeurs qui avaient fait une offre n'ont plus à attendre
      await closePendingOffers(io, id).catch((e) => console.error('Fermeture des offres échouée:', (e as Error).message));

      // Notifier le chauffeur si assigné
      if (ride.driverId) {
        io.to(`user:${ride.driverId}`).emit('ride_status_update', {
          rideId: id,
          status: 'CANCELLED',
        });
      }
      // Notifier le passager (confirmation)
      io.to(`user:${ride.passengerId}`).emit('ride_status_update', {
        rideId: id,
        status: 'CANCELLED',
      });

      res.json({ success: true, message: 'Course annulée', data: updated });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erreur lors de l\'annulation' });
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

// État d'une course (passager ou chauffeur assigné uniquement).
// Sert de filet de sécurité côté app : si un événement temps réel est manqué
// (socket déconnecté, onglet en veille), l'app relit l'état ici.
router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const ride = await prisma.ride.findUnique({
      where: { id: req.params.id },
      include: {
        driver: {
          select: { ...PUBLIC_USER_SELECT, driverProfile: { select: PUBLIC_DRIVER_PROFILE_SELECT } },
        },
      },
    });
    if (!ride || (ride.passengerId !== req.user!.id && ride.driverId !== req.user!.id)) {
      return res.status(404).json({ success: false, message: 'Course introuvable' });
    }
    // Le passager qui attend un chauffeur voit aussi les offres reçues (filet de sécurité si
    // l'événement temps réel « ride_offer » est manqué).
    const offers = ride.passengerId === req.user!.id && ride.status === 'PENDING'
      ? await listPendingOffers(ride)
      : undefined;
    res.json({ success: true, data: offers ? { ...ride, offers } : ride });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Le passager confirme son arrivée (libère l'escrow si le chauffeur a aussi confirmé)
router.post('/:id/confirm-arrival', authenticate, authorize('PASSENGER'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const result = await confirmSide('RIDE', id, 'client', req.user!.id);

    const io = req.app.get('io');
    if (result.status === 'RELEASED') {
      io.to(`user:${result.payeeId}`).emit('ride_payment_released', { rideId: id });
    }

    res.json({
      success: true,
      message: result.status === 'RELEASED'
        ? 'Course validée ! Le chauffeur a été payé.'
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

// Ouvrir un litige sur une course
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
      const { id } = req.params;
      const result = await openDispute('RIDE', id, req.user!.id, req.body.reason);

      const io = req.app.get('io');
      io.to('admins').emit('escrow_dispute', { serviceType: 'RIDE', serviceId: id, escrowId: result.id });

      res.json({ success: true, message: 'Litige ouvert. Un administrateur va examiner votre dossier.', data: result });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erreur' });
    }
  }
);

// Consulter l'escrow d'une course
router.get('/:id/escrow', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const escrow = await getEscrowForService('RIDE', req.params.id);
    res.json({ success: true, data: escrow });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// ========== IA : NÉGOCIATION INTELLIGENTE ==========
// Conseille le chauffeur sur un prix proposé par le passager
router.post(
  '/negotiation-advice',
  authenticate,
  authorize('DRIVER'),
  [
    body('estimatedPrice').isFloat({ min: 0 }),
    body('proposedPrice').isFloat({ min: 0 }),
    body('distance').optional().isFloat({ min: 0 }),
    body('vehicleType').optional().trim(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { estimatedPrice, proposedPrice, distance, vehicleType } = req.body;

      // Calcul de secours si l'IA n'est pas configurée
      const ratio = proposedPrice / estimatedPrice;
      const hour = new Date().getHours();
      const isPeak = (hour >= 6 && hour <= 9) || (hour >= 16 && hour <= 20);

      if (!isAiConfigured()) {
        // Logique simple de repli
        let decision = 'ACCEPT';
        let counterOffer = null;
        if (ratio < 0.8) {
          decision = 'COUNTER';
          counterOffer = Math.ceil((estimatedPrice * 0.9) / 50) * 50;
        }
        return res.json({
          success: true,
          data: {
            decision,
            counterOffer,
            reasoning: ratio < 0.8 ? 'Le prix proposé est bas, proposez un contre-prix.' : 'Prix correct, vous pouvez accepter.',
            source: 'rule-based',
          },
        });
      }

      const system =
        'Tu es un assistant pour chauffeurs VTC au Cameroun. Un passager propose un prix pour sa course. ' +
        'Tu conseilles le chauffeur : accepter, refuser, ou proposer un contre-prix raisonnable (arrondi aux 50 XAF). ' +
        'Tiens compte : prix estimé officiel, prix proposé, distance, heure de pointe, rentabilité. ' +
        'Sois pragmatique : un chauffeur préfère une course à un prix légèrement bas que pas de course. ' +
        'Réponds UNIQUEMENT en JSON: {"decision":"ACCEPT|REFUSE|COUNTER","counterOffer":number|null,"reasoning":"conseil court en français"}';

      const context =
        `Prix estimé officiel: ${estimatedPrice} XAF\n` +
        `Prix proposé par le passager: ${proposedPrice} XAF (soit ${Math.round(ratio * 100)}% du tarif)\n` +
        `Distance: ${distance || 'inconnue'} km\n` +
        `Type de véhicule: ${vehicleType || 'inconnu'}\n` +
        `Heure de pointe: ${isPeak ? 'oui' : 'non'}`;

      const raw = await aiChat({ system, messages: [{ role: 'user', content: context }], maxTokens: 300 });
      const parsed = parseAiJson(raw);

      res.json({
        success: true,
        data: parsed || { decision: 'ACCEPT', counterOffer: null, reasoning: raw, source: 'ai' },
      });
    } catch (error: any) {
      console.error('Negotiation advice error:', error.message);
      res.status(500).json({ success: false, message: 'Erreur lors du conseil' });
    }
  }
);

// Noter une course — bidirectionnel : le passager note le chauffeur, OU le chauffeur note le passager
router.post(
  '/:id/rate',
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

      const ride = await prisma.ride.findUnique({ where: { id } });
      if (!ride) {
        throw new AppError('Course non trouvée', 404);
      }
      if (ride.status !== 'COMPLETED') {
        throw new AppError('Vous ne pouvez noter qu\'une course terminée', 400);
      }

      // Déterminer qui note qui selon le rôle de l'utilisateur dans la course
      let ratedId: string | null = null;
      if (userId === ride.passengerId) {
        ratedId = ride.driverId; // le passager note le chauffeur
      } else if (ride.driverId && userId === ride.driverId) {
        ratedId = ride.passengerId; // le chauffeur note le passager
      } else {
        throw new AppError('Vous n\'avez pas participé à cette course', 403);
      }

      if (!ratedId) {
        throw new AppError('Aucun utilisateur à évaluer', 400);
      }

      const result = await submitRating({
        serviceType: 'RIDE',
        serviceId: id,
        rideId: id,
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
