import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { body, validationResult } from 'express-validator';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';

const router = Router();
const prisma = new PrismaClient();

// Consulter le solde
router.get('/balance', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const wallet = await prisma.wallet.findUnique({
      where: { userId: req.user!.id },
    });

    if (!wallet) {
      throw new AppError('Portefeuille non trouvé', 404);
    }

    res.json({
      success: true,
      data: {
        balance: wallet.balance,
        currency: wallet.currency,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Recharger le portefeuille
router.post(
  '/deposit',
  authenticate,
  [
    body('amount').isFloat({ min: 100 }).withMessage('Montant minimum: 100 XAF'),
    body('paymentMethod').isIn(['ORANGE_MONEY', 'MTN_MOMO', 'EXPRESS_UNION', 'CARD']),
    body('phone').optional().matches(/^6[0-9]{8}$/),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { amount, paymentMethod } = req.body;

      const wallet = await prisma.wallet.findUnique({
        where: { userId: req.user!.id },
      });

      if (!wallet) {
        throw new AppError('Portefeuille non trouvé', 404);
      }

      // Bonus de recharge : 5% pour les recharges >= 5000 XAF
      const bonus = amount >= 5000 ? Math.floor(amount * 0.05) : 0;
      const totalCredit = amount + bonus;

      // Créer la transaction
      const transaction = await prisma.transaction.create({
        data: {
          walletId: wallet.id,
          type: 'DEPOSIT',
          amount,
          paymentMethod,
          status: 'PENDING',
          description: `Recharge ${paymentMethod}${bonus > 0 ? ` (+${bonus} XAF bonus)` : ''}`,
          metadata: { bonus, originalAmount: amount },
        },
      });

      // TODO: Intégrer l'API de paiement réelle (CinetPay, MoMo, etc.)
      // Pour le moment, on simule un succès
      await prisma.$transaction([
        prisma.wallet.update({
          where: { id: wallet.id },
          data: { balance: { increment: totalCredit } },
        }),
        prisma.transaction.update({
          where: { id: transaction.id },
          data: { status: 'COMPLETED' },
        }),
      ]);

      // Ajouter des points de fidélité (1 point / 500 XAF rechargés)
      const loyaltyPointsEarned = Math.floor(amount / 500);
      if (loyaltyPointsEarned > 0) {
        await prisma.loyaltyPoints.update({
          where: { userId: req.user!.id },
          data: { points: { increment: loyaltyPointsEarned } },
        });
      }

      res.json({
        success: true,
        message: `Recharge de ${amount} XAF réussie${bonus > 0 ? ` (+${bonus} XAF bonus !)` : ''}`,
        data: {
          newBalance: wallet.balance + totalCredit,
          bonus,
          loyaltyPointsEarned,
          transactionId: transaction.id,
        },
      });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erreur de recharge' });
    }
  }
);

// Retrait
router.post(
  '/withdraw',
  authenticate,
  [
    body('amount').isFloat({ min: 500 }).withMessage('Montant minimum de retrait: 500 XAF'),
    body('paymentMethod').isIn(['ORANGE_MONEY', 'MTN_MOMO', 'EXPRESS_UNION']),
    body('phone').matches(/^6[0-9]{8}$/).withMessage('Numéro de téléphone requis'),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { amount, paymentMethod, phone } = req.body;

      const wallet = await prisma.wallet.findUnique({
        where: { userId: req.user!.id },
      });

      if (!wallet || wallet.balance < amount) {
        throw new AppError('Solde insuffisant', 400);
      }

      await prisma.$transaction([
        prisma.wallet.update({
          where: { id: wallet.id },
          data: { balance: { decrement: amount } },
        }),
        prisma.transaction.create({
          data: {
            walletId: wallet.id,
            type: 'WITHDRAWAL',
            amount,
            paymentMethod,
            status: 'COMPLETED',
            description: `Retrait vers ${paymentMethod} (${phone})`,
          },
        }),
      ]);

      res.json({
        success: true,
        message: `Retrait de ${amount} XAF envoyé vers ${phone}`,
        data: { newBalance: wallet.balance - amount },
      });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erreur de retrait' });
    }
  }
);

// Historique des transactions
router.get('/transactions', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { page = '1', limit = '20' } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const wallet = await prisma.wallet.findUnique({
      where: { userId: req.user!.id },
    });

    if (!wallet) {
      throw new AppError('Portefeuille non trouvé', 404);
    }

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit as string),
      }),
      prisma.transaction.count({ where: { walletId: wallet.id } }),
    ]);

    res.json({
      success: true,
      data: { transactions, total, page: parseInt(page as string) },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Points de fidélité
router.get('/loyalty', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const loyalty = await prisma.loyaltyPoints.findUnique({
      where: { userId: req.user!.id },
    });

    res.json({
      success: true,
      data: {
        points: loyalty?.points || 0,
        tier: loyalty?.tier || 'BRONZE',
        nextTier: getNextTier(loyalty?.tier || 'BRONZE'),
        pointsToNextTier: getPointsToNextTier(loyalty?.points || 0, loyalty?.tier || 'BRONZE'),
      },
    });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Échanger des points contre du crédit
router.post(
  '/loyalty/redeem',
  authenticate,
  [body('points').isInt({ min: 100 }).withMessage('Minimum 100 points à échanger')],
  async (req: AuthRequest, res: Response) => {
    try {
      const { points } = req.body;

      const loyalty = await prisma.loyaltyPoints.findUnique({
        where: { userId: req.user!.id },
      });

      if (!loyalty || loyalty.points < points) {
        throw new AppError('Points insuffisants', 400);
      }

      // 1 point = 10 XAF
      const creditAmount = points * 10;

      const wallet = await prisma.wallet.findUnique({
        where: { userId: req.user!.id },
      });

      if (!wallet) {
        throw new AppError('Portefeuille non trouvé', 404);
      }

      await prisma.$transaction([
        prisma.loyaltyPoints.update({
          where: { userId: req.user!.id },
          data: { points: { decrement: points } },
        }),
        prisma.wallet.update({
          where: { id: wallet.id },
          data: { balance: { increment: creditAmount } },
        }),
        prisma.transaction.create({
          data: {
            walletId: wallet.id,
            type: 'LOYALTY_REDEEM',
            amount: creditAmount,
            paymentMethod: 'WALLET',
            status: 'COMPLETED',
            description: `Échange de ${points} points fidélité`,
          },
        }),
      ]);

      res.json({
        success: true,
        message: `${points} points échangés contre ${creditAmount} XAF !`,
        data: { creditAmount, remainingPoints: loyalty.points - points },
      });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erreur' });
    }
  }
);

function getNextTier(currentTier: string): string | null {
  const tiers = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'];
  const index = tiers.indexOf(currentTier);
  return index < tiers.length - 1 ? tiers[index + 1] : null;
}

function getPointsToNextTier(currentPoints: number, currentTier: string): number {
  const thresholds: Record<string, number> = {
    BRONZE: 500,   // 500 points pour SILVER
    SILVER: 2000,  // 2000 points pour GOLD
    GOLD: 5000,    // 5000 points pour PLATINUM
    PLATINUM: 0,
  };
  return Math.max(0, thresholds[currentTier] - currentPoints);
}

export { router as walletRouter };
