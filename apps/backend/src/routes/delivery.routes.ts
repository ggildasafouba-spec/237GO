import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { body, validationResult } from 'express-validator';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';
import { holdFunds, confirmSide, openDispute, getEscrowForService } from '../services/escrow.service';
import { sendPushNotification } from '../services/notification.service';

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

      // Vérifier que le livreur est bien vérifié
      const driverProfile = await prisma.driverProfile.findUnique({
        where: { userId: req.user!.id },
      });
      if (!driverProfile || driverProfile.verificationStatus !== 'VERIFIED') {
        throw new AppError('Votre compte chauffeur n\'est pas encore vérifié', 403);
      }

      const delivery = await prisma.delivery.findUnique({ where: { id } });
      if (!delivery || delivery.status !== 'PENDING') {
        throw new AppError('Livraison non disponible', 400);
      }

      // LIVRAISON EN ESPÈCES : le livreur doit pouvoir couvrir la commission sur son wallet
      if (delivery.paymentMethod === 'CASH') {
        const commission = Math.round(delivery.estimatedPrice * 0.15);
        const wallet = await prisma.wallet.findUnique({ where: { userId: req.user!.id } });
        if (!wallet || wallet.balance < commission) {
          throw new AppError(
            `Solde insuffisant pour accepter une livraison en espèces. ` +
            `Commission requise : ${commission} XAF. Rechargez votre portefeuille.`,
            402
          );
        }
      }

      const updated = await prisma.delivery.update({
        where: { id },
        data: { driverId: req.user!.id, status: 'ACCEPTED' },
      });

      // ESCROW : bloquer le prix de la livraison (versé au livreur après validation)
      await holdFunds({
        amount: delivery.estimatedPrice,
        payerId: delivery.senderId,
        payeeId: req.user!.id,
        paymentMethod: delivery.paymentMethod,
        serviceType: 'DELIVERY',
        serviceId: id,
      });

      const io = req.app.get('io');
      io.to(`user:${delivery.senderId}`).emit('delivery_accepted', {
        deliveryId: id,
        driverId: req.user!.id,
      });
      await sendPushNotification({
        userId: delivery.senderId,
        title: '📦 Livreur en route',
        body: 'Un livreur a accepté votre colis et vient le récupérer.',
        type: 'delivery',
        data: { deliveryId: id },
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

      // Récupérer la livraison existante
      const existingDelivery = await prisma.delivery.findUnique({ where: { id } });
      if (!existingDelivery) {
        throw new AppError('Livraison non trouvée', 404);
      }

      // Vérifier que c'est bien le livreur assigné
      if (existingDelivery.driverId !== req.user!.id) {
        throw new AppError('Vous n\'êtes pas le livreur de cette livraison', 403);
      }

      const updateData: Record<string, unknown> = { status };
      if (status === 'IN_TRANSIT') updateData.pickedUpAt = new Date();
      if (status === 'DELIVERED') {
        updateData.deliveredAt = new Date();
        // Le prix final = prix estimé (pas de négociation sur les livraisons)
        updateData.finalPrice = existingDelivery.estimatedPrice;
      }
      if (status === 'CANCELLED') updateData.cancelledAt = new Date();

      const delivery = await prisma.delivery.update({
        where: { id },
        data: updateData,
      });

      const io = req.app.get('io');
      io.to(`user:${delivery.senderId}`).emit('delivery_status_update', {
        deliveryId: id,
        status,
        finalPrice: delivery.finalPrice,
      });

      // Si livrée : le livreur confirme sa fin (côté prestataire).
      // L'argent reste en séquestre jusqu'à ce que l'expéditeur valide la réception.
      if (status === 'DELIVERED') {
        const finalPrice = delivery.finalPrice || 0;

        await confirmSide('DELIVERY', id, 'provider', req.user!.id).catch(() => {});

        if (delivery.driverId) {
          await prisma.driverProfile.update({
            where: { userId: delivery.driverId },
            data: { totalTrips: { increment: 1 } },
          }).catch(() => {});
        }

        io.to(`user:${delivery.senderId}`).emit('delivery_completed', {
          deliveryId: id,
          finalPrice,
          action: 'confirm_reception', // l'expéditeur doit confirmer pour libérer le paiement
        });
      }

      res.json({ success: true, data: delivery });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
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

// L'expéditeur confirme la réception (libère l'escrow si le livreur a aussi confirmé)
router.post('/:id/confirm-reception', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const result = await confirmSide('DELIVERY', id, 'client', req.user!.id);

    res.json({
      success: true,
      message: result.status === 'RELEASED'
        ? 'Livraison validée ! Le livreur a été payé.'
        : 'Réception confirmée. En attente de la confirmation du livreur.',
      data: result,
    });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Ouvrir un litige sur une livraison
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
      const result = await openDispute('DELIVERY', id, req.user!.id, req.body.reason);

      const io = req.app.get('io');
      io.to('admins').emit('escrow_dispute', { serviceType: 'DELIVERY', serviceId: id, escrowId: result.id });

      res.json({ success: true, message: 'Litige ouvert. Un administrateur va examiner votre dossier.', data: result });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erreur' });
    }
  }
);

// Consulter l'escrow d'une livraison
router.get('/:id/escrow', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const escrow = await getEscrowForService('DELIVERY', req.params.id);
    res.json({ success: true, data: escrow });
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
