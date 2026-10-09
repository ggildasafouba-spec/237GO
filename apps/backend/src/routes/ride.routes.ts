import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { body, validationResult } from 'express-validator';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';
import { holdFunds, confirmSide, openDispute, getEscrowForService } from '../services/escrow.service';
import { sendPushNotification } from '../services/notification.service';
import { aiChat, isAiConfigured, parseAiJson } from '../services/ai.service';

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

      // Vérifier que le chauffeur est bien vérifié
      const driverProfile = await prisma.driverProfile.findUnique({
        where: { userId: req.user!.id },
      });
      if (!driverProfile || driverProfile.verificationStatus !== 'VERIFIED') {
        throw new AppError('Votre compte chauffeur n\'est pas encore vérifié', 403);
      }

      const ride = await prisma.ride.findUnique({ where: { id } });
      if (!ride || ride.status !== 'PENDING') {
        throw new AppError('Course non disponible', 400);
      }

      const ridePrice = ride.proposedPrice || ride.estimatedPrice;

      // COURSE EN ESPÈCES : le chauffeur encaisse le cash en main propre, il doit donc
      // avoir de quoi couvrir la commission 237GO sur son wallet pour pouvoir accepter.
      if (ride.paymentMethod === 'CASH') {
        const commission = Math.round(ridePrice * 0.15);
        const wallet = await prisma.wallet.findUnique({ where: { userId: req.user!.id } });
        if (!wallet || wallet.balance < commission) {
          throw new AppError(
            `Solde insuffisant pour accepter une course en espèces. ` +
            `Commission requise : ${commission} XAF. Rechargez votre portefeuille.`,
            402 // Payment Required
          );
        }
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

      // ESCROW : bloquer le prix de la course (prix négocié ou estimé)
      await holdFunds({
        amount: ridePrice,
        payerId: ride.passengerId,
        payeeId: req.user!.id,
        paymentMethod: ride.paymentMethod,
        serviceType: 'RIDE',
        serviceId: id,
      });

      // Notifier le passager (temps réel + push)
      const io = req.app.get('io');
      io.to(`user:${ride.passengerId}`).emit('ride_accepted', {
        rideId: id,
        driver: updatedRide.driver,
      });
      const driverName = updatedRide.driver ? `${updatedRide.driver.firstName} ${updatedRide.driver.lastName}` : 'Votre chauffeur';
      await sendPushNotification({
        userId: ride.passengerId,
        title: '🚗 Chauffeur trouvé !',
        body: `${driverName} arrive pour votre course.`,
        type: 'ride',
        data: { rideId: id },
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

      // Récupérer la course existante
      const existingRide = await prisma.ride.findUnique({ where: { id } });
      if (!existingRide) {
        throw new AppError('Course non trouvée', 404);
      }

      // Vérifier que c'est bien le chauffeur assigné
      if (existingRide.driverId !== req.user!.id) {
        throw new AppError('Vous n\'êtes pas le chauffeur de cette course', 403);
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

      const ride = await prisma.ride.update({
        where: { id },
        data: updateData,
      });

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

// Noter une course (le passager évalue le chauffeur)
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

      const ride = await prisma.ride.findUnique({ where: { id } });
      if (!ride) {
        throw new AppError('Course non trouvée', 404);
      }
      // Seul le passager de la course peut la noter
      if (ride.passengerId !== req.user!.id) {
        throw new AppError('Vous ne pouvez noter que vos propres courses', 403);
      }
      if (ride.status !== 'COMPLETED') {
        throw new AppError('Vous ne pouvez noter qu\'une course terminée', 400);
      }
      if (!ride.driverId) {
        throw new AppError('Aucun chauffeur à évaluer', 400);
      }

      // Empêcher les doublons (rideId est unique sur Rating)
      const existing = await prisma.rating.findUnique({ where: { rideId: id } });
      if (existing) {
        throw new AppError('Vous avez déjà noté cette course', 409);
      }

      // Créer la note
      const rating = await prisma.rating.create({
        data: {
          rideId: id,
          raterId: req.user!.id,
          ratedId: ride.driverId,
          score,
          comment: comment || null,
        },
      });

      // Recalculer la moyenne du chauffeur à partir de toutes ses notes reçues
      const agg = await prisma.rating.aggregate({
        where: { ratedId: ride.driverId },
        _avg: { score: true },
        _count: true,
      });
      const newAverage = agg._avg.score || score;

      await prisma.driverProfile.update({
        where: { userId: ride.driverId },
        data: { averageRating: Math.round(newAverage * 10) / 10 },
      }).catch(() => {});

      res.status(201).json({
        success: true,
        message: 'Merci pour votre évaluation !',
        data: { rating, driverAverage: Math.round(newAverage * 10) / 10, totalRatings: agg._count },
      });
    } catch (error) {
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
