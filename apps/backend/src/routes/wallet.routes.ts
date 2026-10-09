import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { body, validationResult } from 'express-validator';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';
import { processPayment } from '../services/payment.service';
import { redeemLoyaltyPoints, computeTier } from '../services/loyalty.service';

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

      const { amount, paymentMethod, phone } = req.body;

      // Le numéro est requis pour MoMo / Orange Money
      if ((paymentMethod === 'MTN_MOMO' || paymentMethod === 'ORANGE_MONEY') && !phone) {
        throw new AppError('Numéro de téléphone requis pour ce mode de paiement', 400);
      }

      const wallet = await prisma.wallet.findUnique({
        where: { userId: req.user!.id },
      });

      if (!wallet) {
        throw new AppError('Portefeuille non trouvé', 404);
      }

      const user = await prisma.user.findUnique({ where: { id: req.user!.id } });

      // Bonus de recharge : 5% pour les recharges >= 5000 XAF
      const bonus = amount >= 5000 ? Math.floor(amount * 0.05) : 0;

      // Créer la transaction EN ATTENTE (le crédit se fera via le webhook)
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

      // La référence de paiement = l'id de la transaction (utilisée par les webhooks)
      await prisma.transaction.update({
        where: { id: transaction.id },
        data: { reference: transaction.id },
      });

      // Lancer le paiement réel via le prestataire
      const apiBaseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3002}`;
      const payment = await processPayment({
        amount,
        currency: 'XAF',
        transactionId: transaction.id,
        description: `Recharge portefeuille 237GO`,
        customerPhone: phone || user?.phone || '',
        customerName: user ? `${user.firstName} ${user.lastName}` : 'Client 237GO',
        paymentMethod: paymentMethod === 'CARD' ? 'MTN_MOMO' : paymentMethod,
        notifyUrl: `${apiBaseUrl}/api/webhooks/cinetpay`,
        returnUrl: `${apiBaseUrl}/api/webhooks/return`,
      });

      if (!payment.success) {
        // Marquer la transaction comme échouée
        await prisma.transaction.update({
          where: { id: transaction.id },
          data: { status: 'FAILED' },
        });
        throw new AppError(payment.message || 'Échec de l\'initiation du paiement', 502);
      }

      res.json({
        success: true,
        message: payment.paymentUrl
          ? 'Redirection vers le paiement...'
          : 'Demande de paiement envoyée. Confirmez sur votre téléphone.',
        data: {
          transactionId: transaction.id,
          paymentUrl: payment.paymentUrl || null,
          transactionRef: payment.transactionRef || null,
          bonus,
          status: 'PENDING',
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

    const points = loyalty?.points || 0;
    // Le palier est recalculé depuis les points (source de vérité)
    const tier = computeTier(points);

    // Auto-correction : si le tier stocké est obsolète, on le met à jour
    if (loyalty && loyalty.tier !== tier) {
      await prisma.loyaltyPoints.update({ where: { userId: req.user!.id }, data: { tier } });
    }

    res.json({
      success: true,
      data: {
        points,
        tier,
        nextTier: getNextTier(tier),
        pointsToNextTier: getPointsToNextTier(points, tier),
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

      // Créditer le wallet et enregistrer la transaction
      await prisma.$transaction([
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

      // Retirer les points et recalculer le palier
      const result = await redeemLoyaltyPoints(req.user!.id, points);

      res.json({
        success: true,
        message: `${points} points échangés contre ${creditAmount} XAF !`,
        data: {
          creditAmount,
          remainingPoints: result?.points ?? loyalty.points - points,
          tier: result?.tier,
        },
      });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erreur' });
    }
  }
);

// Vérifier le statut d'une transaction (pour le polling côté mobile)
router.get('/transactions/:id/status', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const wallet = await prisma.wallet.findUnique({ where: { userId: req.user!.id } });
    if (!wallet) {
      throw new AppError('Portefeuille non trouvé', 404);
    }

    const transaction = await prisma.transaction.findFirst({
      where: { id: req.params.id, walletId: wallet.id },
    });

    if (!transaction) {
      throw new AppError('Transaction non trouvée', 404);
    }

    res.json({
      success: true,
      data: {
        id: transaction.id,
        status: transaction.status,
        amount: transaction.amount,
        type: transaction.type,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

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
