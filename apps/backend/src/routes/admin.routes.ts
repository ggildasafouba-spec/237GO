import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.middleware';

const router = Router();
const prisma = new PrismaClient();

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

// Approuver/Rejeter un chauffeur
router.patch('/drivers/:id/verify', async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.body; // 'VERIFIED' ou 'REJECTED'
    if (!['VERIFIED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Statut invalide' });
    }

    await prisma.driverProfile.update({
      where: { id: req.params.id },
      data: { verificationStatus: status },
    });

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

    res.json({
      success: true,
      data: {
        totalRevenue,
        commission: totalRevenue * commissionRate,
        walletDeposits: deposits._sum.amount || 0,
        walletWithdrawals: withdrawals._sum.amount || 0,
        period,
      },
    });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Alertes SOS actives
router.get('/sos-alerts', async (_req: AuthRequest, res: Response) => {
  // TODO: Implémenter un modèle SOSAlert
  res.json({ success: true, data: [] });
});

export { router as adminRouter };
