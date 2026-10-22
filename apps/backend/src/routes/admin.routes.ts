import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.middleware';
import { releaseFunds, refundFunds } from '../services/escrow.service';
import { sendPushNotification } from '../services/notification.service';
import { aiVision, aiChat, isAiConfigured, parseAiJson } from '../services/ai.service';

const router = Router();

// Middleware admin
router.use(authenticate);
router.use(authorize('ADMIN'));

// Stats globales
router.get('/stats', async (_req: AuthRequest, res: Response) => {
  try {
    const [
      totalUsers,
      totalDrivers,
      totalRides,
      totalDeliveries,
      activeRides,
      pendingDrivers,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.driverProfile.count({ where: { verificationStatus: 'VERIFIED' } }),
      prisma.ride.count(),
      prisma.delivery.count(),
      prisma.ride.count({ where: { status: { in: ['PENDING', 'ACCEPTED', 'IN_PROGRESS'] } } }),
      prisma.driverProfile.count({ where: { verificationStatus: 'PENDING' } }),
    ]);

    // Courses d'aujourd'hui
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayRides = await prisma.ride.count({
      where: { createdAt: { gte: today } },
    });

    // Revenus totaux
    const completedRides = await prisma.ride.aggregate({
      _sum: { finalPrice: true, estimatedPrice: true },
      where: { status: 'COMPLETED' },
    });
    const totalRevenue = completedRides._sum.finalPrice || completedRides._sum.estimatedPrice || 0;

    res.json({
      success: true,
      data: {
        totalUsers,
        totalDrivers,
        totalRides,
        totalDeliveries,
        activeRides,
        pendingDrivers,
        todayRides,
        totalRevenue,
      },
    });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Liste des utilisateurs
router.get('/users', async (req: AuthRequest, res: Response) => {
  try {
    const { page = '1', limit = '50', role, search } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const where: Record<string, unknown> = {};
    if (role && role !== 'ALL') where.role = role;
    if (search) {
      where.OR = [
        { firstName: { contains: search as string, mode: 'insensitive' } },
        { lastName: { contains: search as string, mode: 'insensitive' } },
        { phone: { contains: search as string } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit as string),
        select: {
          id: true, phone: true, firstName: true, lastName: true,
          role: true, isActive: true, createdAt: true, language: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ success: true, data: { users, total, page: parseInt(page as string) } });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Activer/Désactiver un utilisateur
router.patch('/users/:id/toggle', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });

    await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive: !user.isActive },
    });

    res.json({ success: true, message: `Utilisateur ${user.isActive ? 'désactivé' : 'activé'}` });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Supprimer définitivement un utilisateur (nettoie d'abord ses données liées).
// Protégé : on ne supprime pas un ADMIN, ni soi-même.
router.delete('/users/:id', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.params.id;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });

    if (user.role === 'ADMIN') {
      return res.status(400).json({ success: false, message: 'Impossible de supprimer un administrateur' });
    }
    if (req.user!.id === userId) {
      return res.status(400).json({ success: false, message: 'Vous ne pouvez pas supprimer votre propre compte' });
    }

    // Récupérer le wallet pour effacer ses transactions
    const wallet = await prisma.wallet.findUnique({ where: { userId } });

    // Nettoyer les données liées puis supprimer l'utilisateur, en une transaction.
    await prisma.$transaction(async (tx) => {
      if (wallet) {
        await tx.transaction.deleteMany({ where: { walletId: wallet.id } });
        await tx.wallet.delete({ where: { id: wallet.id } });
      }
      await tx.loyaltyPoints.deleteMany({ where: { userId } });
      await tx.notification.deleteMany({ where: { userId } });
      await tx.emergencyContact.deleteMany({ where: { userId } });
      await tx.message.deleteMany({
        where: { OR: [{ senderId: userId }, { receiverId: userId }] },
      });
      await tx.rating.deleteMany({
        where: { OR: [{ raterId: userId }, { ratedId: userId }] },
      });
      await tx.user.delete({ where: { id: userId } });
    });

    res.json({ success: true, message: `Compte "${user.firstName} ${user.lastName}" supprimé` });
  } catch (error: any) {
    // Souvent une contrainte de clé étrangère (l'utilisateur a des courses, véhicules, etc.)
    console.error('Suppression utilisateur:', error?.message || error);
    res.status(409).json({
      success: false,
      message: "Impossible de supprimer : ce compte a des activités liées (courses, véhicules...). Désactivez-le plutôt.",
    });
  }
});

// Véhicules de location en attente de vérification
// Liste des véhicules de location (filtrable par statut de vérification)
router.get('/vehicles', async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.query;
    const where: Record<string, unknown> = {};
    if (status) where.verificationStatus = status;

    const vehicles = await prisma.vehicle.findMany({
      where,
      include: { owner: { select: { firstName: true, lastName: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: vehicles });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

router.get('/vehicles/pending', async (_req: AuthRequest, res: Response) => {
  try {
    const vehicles = await prisma.vehicle.findMany({
      where: { verificationStatus: 'PENDING' },
      include: { owner: { select: { firstName: true, lastName: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: vehicles });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

router.patch('/vehicles/:id/verify', async (req: AuthRequest, res: Response) => {
  try {
    const { status, reason } = req.body;
    if (!['VERIFIED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Statut invalide' });
    }

    const vehicle = await prisma.vehicle.update({
      where: { id: req.params.id },
      data: {
        verificationStatus: status,
        rejectionReason: reason || null,
        isAvailable: status === 'VERIFIED',
      },
      include: { owner: { select: { firstName: true, lastName: true, phone: true } } },
    });

    res.json({
      success: true,
      message: `Véhicule ${status === 'VERIFIED' ? 'approuvé' : 'rejeté'}`,
      data: vehicle,
    });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Chauffeurs en attente de vérification
router.get('/drivers/pending', async (_req: AuthRequest, res: Response) => {
  try {
    const drivers = await prisma.driverProfile.findMany({
      where: { verificationStatus: 'PENDING' },
      include: { user: { select: { firstName: true, lastName: true, phone: true } } },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ success: true, data: drivers });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Tous les chauffeurs (filtrable par statut de vérification / en ligne)
router.get('/drivers', async (req: AuthRequest, res: Response) => {
  try {
    const { status, online } = req.query;
    const where: Record<string, unknown> = {};
    if (status) where.verificationStatus = status;
    if (online === 'true') where.isOnline = true;

    const drivers = await prisma.driverProfile.findMany({
      where,
      include: { user: { select: { firstName: true, lastName: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: drivers });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Approuver/Rejeter un chauffeur
router.patch('/drivers/:id/verify', async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.body; // 'VERIFIED' ou 'REJECTED'
    if (!['VERIFIED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Statut invalide' });
    }

    const profile = await prisma.driverProfile.update({
      where: { id: req.params.id },
      data: { verificationStatus: status },
    });

    const io = req.app.get('io');
    // À l'approbation : attribuer le rôle DRIVER à l'utilisateur
    if (status === 'VERIFIED') {
      await prisma.user.update({
        where: { id: profile.userId },
        data: { role: 'DRIVER' },
      });
      io.to(`user:${profile.userId}`).emit('driver_verified', { status: 'VERIFIED' });
      await sendPushNotification({
        userId: profile.userId,
        title: '✅ Compte chauffeur approuvé !',
        body: 'Félicitations ! Vous pouvez maintenant accepter des courses sur 237GO.',
        type: 'driver',
      });
    } else if (status === 'REJECTED') {
      // Au rejet : s'assurer que l'utilisateur n'a pas le rôle DRIVER
      await prisma.user.update({
        where: { id: profile.userId },
        data: { role: 'PASSENGER' },
      }).catch(() => {});
      io.to(`user:${profile.userId}`).emit('driver_verified', { status: 'REJECTED' });
      await sendPushNotification({
        userId: profile.userId,
        title: 'Demande chauffeur refusée',
        body: 'Votre demande n\'a pas été approuvée. Contactez le support pour plus d\'informations.',
        type: 'driver',
      });
    }

    res.json({ success: true, message: `Chauffeur ${status === 'VERIFIED' ? 'approuvé' : 'rejeté'}` });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Toutes les courses (avec filtres)
router.get('/rides', async (req: AuthRequest, res: Response) => {
  try {
    const { page = '1', limit = '50', status } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const where: Record<string, unknown> = {};
    if (status) where.status = status;

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

    res.json({ success: true, data: { rides, total } });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Toutes les livraisons (avec filtres)
router.get('/deliveries', async (req: AuthRequest, res: Response) => {
  try {
    const { page = '1', limit = '50', status } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const where: Record<string, unknown> = {};
    if (status) where.status = status;

    const [deliveries, total] = await Promise.all([
      prisma.delivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit as string),
        include: {
          sender: { select: { firstName: true, lastName: true, phone: true } },
          driver: { select: { firstName: true, lastName: true, phone: true } },
        },
      }),
      prisma.delivery.count({ where }),
    ]);

    res.json({ success: true, data: { deliveries, total } });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Tous les marchands
router.get('/merchants', async (_req: AuthRequest, res: Response) => {
  try {
    const merchants = await prisma.merchantProfile.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { firstName: true, lastName: true, phone: true } },
        _count: { select: { products: true, orders: true } },
      },
    });

    res.json({ success: true, data: merchants });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Approuver / Rejeter un marchand
router.patch('/merchants/:id/verify', async (req: AuthRequest, res: Response) => {
  try {
    const { status, reason } = req.body; // 'VERIFIED' ou 'REJECTED'
    if (!['VERIFIED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Statut invalide' });
    }

    const merchant = await prisma.merchantProfile.update({
      where: { id: req.params.id },
      data: {
        verificationStatus: status,
        rejectionReason: reason || null,
        isOpen: status === 'VERIFIED',
      },
    });

    const io = req.app.get('io');
    if (status === 'VERIFIED') {
      // Attribuer le rôle MERCHANT à l'approbation
      await prisma.user.update({
        where: { id: merchant.userId },
        data: { role: 'MERCHANT' },
      });
      io.to(`user:${merchant.userId}`).emit('merchant_verified', { status: 'VERIFIED' });
      await sendPushNotification({
        userId: merchant.userId,
        title: '✅ Boutique approuvée !',
        body: 'Votre boutique est validée. Vous pouvez maintenant vendre sur 237GO.',
        type: 'merchant',
      }).catch(() => {});
    } else {
      await prisma.user.update({
        where: { id: merchant.userId },
        data: { role: 'PASSENGER' },
      }).catch(() => {});
      io.to(`user:${merchant.userId}`).emit('merchant_verified', { status: 'REJECTED' });
      await sendPushNotification({
        userId: merchant.userId,
        title: 'Demande marchand refusée',
        body: 'Votre demande n\'a pas été approuvée. Contactez le support pour plus d\'informations.',
        type: 'merchant',
      }).catch(() => {});
    }

    res.json({ success: true, message: `Marchand ${status === 'VERIFIED' ? 'approuvé' : 'rejeté'}`, data: merchant });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Revenus par période
router.get('/finance/summary', async (req: AuthRequest, res: Response) => {
  try {
    const { period = 'month' } = req.query;

    const now = new Date();
    let startDate = new Date();

    if (period === 'week') startDate.setDate(now.getDate() - 7);
    else if (period === 'month') startDate.setMonth(now.getMonth() - 1);
    else startDate.setFullYear(now.getFullYear() - 1);

    const [rideRevenue, deposits, withdrawals] = await Promise.all([
      prisma.ride.aggregate({
        _sum: { finalPrice: true },
        where: { status: 'COMPLETED', completedAt: { gte: startDate } },
      }),
      prisma.transaction.aggregate({
        _sum: { amount: true },
        where: { type: 'DEPOSIT', status: 'COMPLETED', createdAt: { gte: startDate } },
      }),
      prisma.transaction.aggregate({
        _sum: { amount: true },
        where: { type: 'WITHDRAWAL', status: 'COMPLETED', createdAt: { gte: startDate } },
      }),
    ]);

    const totalRevenue = rideRevenue._sum.finalPrice || 0;
    const commissionRate = 0.15;

    // Transactions récentes
    const recentTransactions = await prisma.transaction.findMany({
      orderBy: { createdAt: 'desc' },
      take: 15,
      include: {
        wallet: { include: { user: { select: { firstName: true, lastName: true } } } },
      },
    });

    res.json({
      success: true,
      data: {
        totalRevenue,
        commission: totalRevenue * commissionRate,
        walletDeposits: deposits._sum.amount || 0,
        walletWithdrawals: withdrawals._sum.amount || 0,
        period,
        recentTransactions: recentTransactions.map((tx) => ({
          id: tx.id,
          type: tx.type,
          amount: tx.amount,
          method: tx.paymentMethod,
          status: tx.status,
          date: tx.createdAt,
          user: tx.wallet?.user ? `${tx.wallet.user.firstName} ${tx.wallet.user.lastName}` : '-',
        })),
      },
    });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Alertes SOS (par défaut les actives ; ?status=RESOLVED pour l'historique)
router.get('/sos-alerts', async (req: AuthRequest, res: Response) => {
  try {
    const { status = 'ACTIVE' } = req.query;
    const where: Record<string, unknown> = {};
    if (status && status !== 'ALL') where.status = status;

    const alerts = await prisma.sosAlert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        user: { select: { firstName: true, lastName: true, phone: true } },
      },
    });

    res.json({ success: true, data: alerts });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Marquer une alerte SOS comme traitée
router.patch('/sos-alerts/:id/resolve', async (req: AuthRequest, res: Response) => {
  try {
    const alert = await prisma.sosAlert.update({
      where: { id: req.params.id },
      data: {
        status: 'RESOLVED',
        resolvedBy: req.user!.id,
        resolvedAt: new Date(),
      },
    });
    res.json({ success: true, message: 'Alerte marquée comme traitée', data: alert });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// ========== PARAMÈTRES DE L'APPLICATION ==========

// Valeurs par défaut si aucun paramètre n'a encore été enregistré.
const DEFAULT_SETTINGS = {
  pricing: {
    motoBase: 200, motoPerKm: 150,
    ecoBase: 500, ecoPerKm: 300,
    comfortBase: 1000, comfortPerKm: 450,
    vipBase: 2000, vipPerKm: 700,
    commissionRate: 15,
    loyaltyPointsPerXAF: 100,
    bonusRechargeThreshold: 5000,
    bonusRechargePercent: 5,
  },
  sms: {
    provider: 'africas_talking',
    senderId: '237GO',
    enabled: true,
  },
};

// Lire les paramètres (fusionne les valeurs enregistrées avec les défauts)
router.get('/settings', async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await prisma.appSetting.findMany();
    const stored = rows.reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {} as Record<string, unknown>);

    res.json({
      success: true,
      data: {
        pricing: { ...DEFAULT_SETTINGS.pricing, ...(stored.pricing as object || {}) },
        sms: { ...DEFAULT_SETTINGS.sms, ...(stored.sms as object || {}) },
      },
    });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Enregistrer les paramètres (upsert par clé : pricing, sms)
router.put('/settings', async (req: AuthRequest, res: Response) => {
  try {
    const { pricing, sms } = req.body || {};
    const entries: { key: string; value: unknown }[] = [];
    if (pricing && typeof pricing === 'object') entries.push({ key: 'pricing', value: pricing });
    if (sms && typeof sms === 'object') entries.push({ key: 'sms', value: sms });

    if (entries.length === 0) {
      return res.status(400).json({ success: false, message: 'Aucun paramètre fourni' });
    }

    await prisma.$transaction(
      entries.map((e) =>
        prisma.appSetting.upsert({
          where: { key: e.key },
          create: { key: e.key, value: e.value as any },
          update: { value: e.value as any },
        })
      )
    );

    res.json({ success: true, message: 'Paramètres enregistrés' });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// ========== RÉINITIALISATION DES DONNÉES DE TEST ==========
// Vide les données financières/d'activité de test et remet les soldes à 0.
// NE SUPPRIME PAS les comptes utilisateurs, chauffeurs, marchands, véhicules, produits.
// Protégé : réservé admin + nécessite { confirm: "RESET" } dans le corps.
router.post('/reset-test-data', async (req: AuthRequest, res: Response) => {
  try {
    if (req.body?.confirm !== 'RESET') {
      return res.status(400).json({
        success: false,
        message: 'Confirmation requise : envoyez { "confirm": "RESET" } pour réinitialiser.',
      });
    }

    // Ordre de suppression : enfants d'abord, puis parents (contraintes FK).
    const result = await prisma.$transaction(async (tx) => {
      const ratings = await tx.rating.deleteMany({});
      const orderItems = await tx.orderItem.deleteMany({});
      const marketOrders = await tx.marketOrder.deleteMany({});
      const rentalBookings = await tx.rentalBooking.deleteMany({});
      const carpoolBookings = await tx.carpoolBooking.deleteMany({});
      const carpools = await tx.carpool.deleteMany({});
      const rides = await tx.ride.deleteMany({});
      const deliveries = await tx.delivery.deleteMany({});
      const escrows = await tx.escrow.deleteMany({});
      const transactions = await tx.transaction.deleteMany({});
      // Remettre tous les soldes de portefeuille à 0
      const wallets = await tx.wallet.updateMany({ data: { balance: 0 } });
      // Remettre les points de fidélité à 0
      const loyalty = await tx.loyaltyPoints.updateMany({ data: { points: 0, tier: 'BRONZE' } });

      return {
        transactions: transactions.count,
        escrows: escrows.count,
        rides: rides.count,
        deliveries: deliveries.count,
        carpools: carpools.count,
        carpoolBookings: carpoolBookings.count,
        rentalBookings: rentalBookings.count,
        marketOrders: marketOrders.count,
        orderItems: orderItems.count,
        ratings: ratings.count,
        walletsReset: wallets.count,
        loyaltyReset: loyalty.count,
      };
    });

    res.json({
      success: true,
      message: 'Données de test réinitialisées. Comptes, chauffeurs, marchands et véhicules conservés.',
      data: result,
    });
  } catch (error: any) {
    console.error('reset-test-data error:', error?.message || error);
    res.status(500).json({ success: false, message: 'Erreur lors de la réinitialisation' });
  }
});

// ========== GESTION DES ESCROWS ==========

// Lister les escrows (filtrable par statut)
router.get('/escrows', async (req: AuthRequest, res: Response) => {
  try {
    const { page = '1', limit = '50', status, serviceType } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (serviceType) where.serviceType = serviceType;

    const [escrows, total] = await Promise.all([
      prisma.escrow.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit as string),
        include: {
          payer: { select: { firstName: true, lastName: true, phone: true } },
          payee: { select: { firstName: true, lastName: true, phone: true } },
        },
      }),
      prisma.escrow.count({ where }),
    ]);

    res.json({ success: true, data: { escrows, total, page: parseInt(page as string) } });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Litiges en attente de décision
router.get('/escrows/disputes', async (_req: AuthRequest, res: Response) => {
  try {
    const disputes = await prisma.escrow.findMany({
      where: { status: 'DISPUTED' },
      orderBy: { updatedAt: 'asc' },
      include: {
        payer: { select: { firstName: true, lastName: true, phone: true } },
        payee: { select: { firstName: true, lastName: true, phone: true } },
      },
    });

    res.json({ success: true, data: disputes });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// L'admin libère les fonds au prestataire (constat de service effectué)
router.post('/escrows/:id/release', async (req: AuthRequest, res: Response) => {
  try {
    const result = await releaseFunds(req.params.id, req.user!.id);
    res.json({ success: true, message: 'Fonds libérés au prestataire', data: result });
  } catch (error: any) {
    const code = error?.statusCode || 500;
    res.status(code).json({ success: false, message: error?.message || 'Erreur' });
  }
});

// L'admin rembourse le client (litige tranché en faveur du client)
router.post('/escrows/:id/refund', async (req: AuthRequest, res: Response) => {
  try {
    const result = await refundFunds(req.params.id, req.user!.id);
    res.json({ success: true, message: 'Fonds remboursés au client', data: result });
  } catch (error: any) {
    const code = error?.statusCode || 500;
    res.status(code).json({ success: false, message: error?.message || 'Erreur' });
  }
});

// ========== IA : VÉRIFICATION DES DOCUMENTS CHAUFFEUR ==========

// Analyse par IA les documents d'un chauffeur et renvoie une recommandation
router.post('/drivers/:id/ai-verify', async (req: AuthRequest, res: Response) => {
  try {
    if (!isAiConfigured()) {
      return res.status(503).json({ success: false, message: 'Service IA non configuré' });
    }

    const profile = await prisma.driverProfile.findUnique({
      where: { id: req.params.id },
      include: { user: { select: { firstName: true, lastName: true } } },
    });
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Chauffeur non trouvé' });
    }
    if (!profile.licensePhoto && !profile.cniPhoto) {
      return res.status(400).json({ success: false, message: 'Aucun document à analyser' });
    }

    const fullName = `${profile.user.firstName} ${profile.user.lastName}`;
    const system =
      'Tu es un agent de vérification de documents pour une plateforme VTC au Cameroun. ' +
      'Tu analyses des photos de permis de conduire et de CNI (carte nationale d\'identité camerounaise). ' +
      'Tu vérifies : la lisibilité, le type de document, la cohérence du nom, les signes de falsification évidents. ' +
      'Tu réponds UNIQUEMENT en JSON valide, sans texte autour.';

    // Analyser le permis
    const analyses: Record<string, unknown> = {};

    if (profile.licensePhoto) {
      const prompt =
        `Analyse cette photo censée être un PERMIS DE CONDUIRE. ` +
        `Le chauffeur déclaré est "${fullName}", numéro de permis "${profile.licenseNumber}". ` +
        `Réponds en JSON: {"isLicense": bool, "readable": bool, "nameMatches": bool|null, "concerns": "texte court", "confidence": 0-100}`;
      const raw = await aiVision({ system, prompt, imageUrl: profile.licensePhoto });
      analyses.license = parseAiJson(raw) || { raw };
    }

    if (profile.cniPhoto) {
      const prompt =
        `Analyse cette photo censée être une CNI (carte nationale d'identité camerounaise). ` +
        `La personne déclarée est "${fullName}", numéro CNI "${profile.cniNumber}". ` +
        `Réponds en JSON: {"isCni": bool, "readable": bool, "nameMatches": bool|null, "concerns": "texte court", "confidence": 0-100}`;
      const raw = await aiVision({ system, prompt, imageUrl: profile.cniPhoto });
      analyses.cni = parseAiJson(raw) || { raw };
    }

    // Recommandation globale
    const lic = analyses.license as any;
    const cni = analyses.cni as any;
    const avgConfidence = [lic?.confidence, cni?.confidence].filter((c) => typeof c === 'number');
    const meanConf = avgConfidence.length ? avgConfidence.reduce((a: number, b: number) => a + b, 0) / avgConfidence.length : 0;
    const recommendation = meanConf >= 70 && lic?.readable !== false && cni?.readable !== false ? 'APPROVE' : 'REVIEW';

    res.json({
      success: true,
      data: {
        driver: fullName,
        analyses,
        recommendation,
        meanConfidence: Math.round(meanConf),
        note: 'Recommandation IA — la décision finale reste à l\'administrateur.',
      },
    });
  } catch (error: any) {
    console.error('AI verify error:', error.message);
    res.status(500).json({ success: false, message: 'Erreur lors de l\'analyse IA' });
  }
});

// ========== IA : AIDE À LA DÉCISION SUR LES LITIGES ==========

// Suggère une résolution de litige (release/refund) à partir du contexte
router.post('/escrows/:id/ai-suggest', async (req: AuthRequest, res: Response) => {
  try {
    if (!isAiConfigured()) {
      return res.status(503).json({ success: false, message: 'Service IA non configuré' });
    }

    const escrow = await prisma.escrow.findUnique({
      where: { id: req.params.id },
      include: {
        payer: { select: { firstName: true, lastName: true } },
        payee: { select: { firstName: true, lastName: true } },
      },
    });
    if (!escrow) {
      return res.status(404).json({ success: false, message: 'Escrow non trouvé' });
    }

    const system =
      'Tu es un médiateur de litiges pour une plateforme de services au Cameroun (VTC, livraison, etc.). ' +
      'Tu analyses un litige sur un paiement en séquestre et tu suggères une décision équitable. ' +
      'Options : RELEASE (payer le prestataire), REFUND (rembourser le client), ou SPLIT (partage/enquête). ' +
      'Réponds UNIQUEMENT en JSON: {"suggestion":"RELEASE|REFUND|SPLIT","reasoning":"explication courte en français","confidence":0-100}';

    const context =
      `Service: ${escrow.serviceType}\n` +
      `Montant: ${escrow.amount} XAF\n` +
      `Client: ${escrow.payer.firstName} ${escrow.payer.lastName}\n` +
      `Prestataire: ${escrow.payee.firstName} ${escrow.payee.lastName}\n` +
      `Client a confirmé la fin: ${escrow.clientConfirmed}\n` +
      `Prestataire a confirmé la fin: ${escrow.providerConfirmed}\n` +
      `Motif du litige: ${escrow.disputeReason || 'non précisé'}`;

    const raw = await aiChat({
      system,
      messages: [{ role: 'user', content: context }],
      maxTokens: 500,
    });
    const parsed = parseAiJson(raw);

    res.json({
      success: true,
      data: parsed || { suggestion: 'SPLIT', reasoning: raw, confidence: 0 },
      note: 'Suggestion IA — la décision finale reste à l\'administrateur.',
    });
  } catch (error: any) {
    console.error('AI suggest error:', error.message);
    res.status(500).json({ success: false, message: 'Erreur lors de l\'analyse IA' });
  }
});

export { router as adminRouter };
