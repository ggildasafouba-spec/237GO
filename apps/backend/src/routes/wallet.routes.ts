import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { body, validationResult } from 'express-validator';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';
import { processPayment, verifyDepositTransaction, confirmDeposit } from '../services/payment.service';
import { redeemLoyaltyPoints, addLoyaltyPoints, computeTier } from '../services/loyalty.service';

const router = Router();

// Vérifier manuellement l'état d'un paiement et créditer si confirmé.
// Appelé par l'app après le retour de la page de paiement (ne dépend pas du webhook).
router.post('/verify/:transactionId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { transactionId } = req.params;

    // La transaction doit appartenir au portefeuille de l'utilisateur connecté
    const wallet = await prisma.wallet.findUnique({ where: { userId: req.user!.id } });
    if (!wallet) {
      throw new AppError('Portefeuille non trouvé', 404);
    }

    const transaction = await prisma.transaction.findFirst({
      where: { id: transactionId, walletId: wallet.id, type: 'DEPOSIT' },
    });
    if (!transaction) {
      throw new AppError('Transaction introuvable', 404);
    }

    // Déjà créditée : renvoyer l'état courant (idempotent)
    if (transaction.status === 'COMPLETED') {
      return res.json({
        success: true,
        data: { status: 'COMPLETED', balance: wallet.balance },
      });
    }

    // Interroger la passerelle RÉELLEMENT utilisée (CinetPay ou NotchPay).
    // Avant : toujours NotchPay, donc un paiement CinetPay restait "en attente" côté app.
    const check = await verifyDepositTransaction(transaction);

    if (check.status === 'COMPLETED') {
      await confirmDeposit(transaction.reference || transaction.id);
      const updated = await prisma.wallet.findUnique({ where: { id: wallet.id } });
      return res.json({
        success: true,
        data: { status: 'COMPLETED', balance: updated?.balance ?? wallet.balance },
      });
    }

    if (check.status === 'FAILED') {
      return res.json({ success: true, data: { status: 'FAILED', balance: wallet.balance } });
    }

    // Encore en attente côté NotchPay
    return res.json({ success: true, data: { status: 'PENDING', balance: wallet.balance } });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Erreur de vérification du paiement' });
  }
});

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
    // TOPUP = recharge classique (bonus possible) ; SERVICE = paiement direct d'un service
    body('purpose').optional().isIn(['TOPUP', 'SERVICE']),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { amount, paymentMethod, phone } = req.body;
      const isServicePayment = req.body.purpose === 'SERVICE';

      // Le numéro est requis pour une recharge MoMo / Orange Money.
      // Pour un paiement direct CinetPay, le client saisit son numéro sur la page de paiement.
      if ((paymentMethod === 'MTN_MOMO' || paymentMethod === 'ORANGE_MONEY') && !phone && !isServicePayment) {
        throw new AppError('Numéro de téléphone requis pour ce mode de paiement', 400);
      }

      const wallet = await prisma.wallet.findUnique({
        where: { userId: req.user!.id },
      });

      if (!wallet) {
        throw new AppError('Portefeuille non trouvé', 404);
      }

      const user = await prisma.user.findUnique({ where: { id: req.user!.id } });

      // Bonus de recharge : 5% pour les recharges >= 5000 XAF.
      // Pas de bonus sur un paiement direct de service (sinon 5% offerts sur chaque course).
      const bonus = !isServicePayment && amount >= 5000 ? Math.floor(amount * 0.05) : 0;

      // Créer la transaction EN ATTENTE (le crédit se fera via le webhook ou la vérification)
      const transaction = await prisma.transaction.create({
        data: {
          walletId: wallet.id,
          type: 'DEPOSIT',
          amount,
          paymentMethod,
          status: 'PENDING',
          description: isServicePayment
            ? `Paiement direct ${paymentMethod}`
            : `Recharge ${paymentMethod}${bonus > 0 ? ` (+${bonus} XAF bonus)` : ''}`,
          metadata: { bonus, originalAmount: amount, purpose: isServicePayment ? 'SERVICE' : 'TOPUP' },
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
        description: isServicePayment ? 'Paiement 237GO' : 'Recharge portefeuille 237GO',
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

      // Mémoriser la référence NotchPay (trx.xxx) pour retrouver la transaction
      // lorsque le webhook arrive avec cette référence.
      if (payment.transactionRef) {
        await prisma.transaction.update({
          where: { id: transaction.id },
          data: {
            metadata: {
              bonus,
              originalAmount: amount,
              purpose: isServicePayment ? 'SERVICE' : 'TOPUP',
              notchRef: payment.transactionRef,
            },
          },
        });
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

      if (!wallet) {
        throw new AppError('Solde insuffisant', 400);
      }

      // Débit ATOMIQUE : ne réussit que si le solde couvre le montant au moment du débit.
      // Deux retraits simultanés ne peuvent plus vider deux fois le même solde.
      const newBalance = await prisma.$transaction(async (tx) => {
        const debited = await tx.wallet.updateMany({
          where: { id: wallet.id, balance: { gte: amount } },
          data: { balance: { decrement: amount } },
        });
        if (debited.count !== 1) {
          throw new AppError('Solde insuffisant', 400);
        }

        // DEMANDE DE RETRAIT (statut PENDING) : le montant est réservé sur le solde tout de suite,
        // mais aucun versement automatique n'existe encore vers Orange Money / MTN.
        // Un administrateur envoie l'argent puis valide la demande (COMPLETED),
        // ou la refuse (le montant est alors recrédité automatiquement).
        // Avant : la transaction était marquée "COMPLETED" et l'app affichait "envoyé"
        // alors qu'aucun argent ne partait réellement.
        await tx.transaction.create({
          data: {
            walletId: wallet.id,
            type: 'WITHDRAWAL',
            amount,
            paymentMethod,
            status: 'PENDING',
            description: `Demande de retrait vers ${paymentMethod} (${phone})`,
            metadata: { phone, requestedAt: new Date().toISOString() },
          },
        });

        const fresh = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
        return fresh.balance;
      });

      // Prévenir les admins en temps réel qu'une demande attend un versement
      req.app.get('io')?.to('admins').emit('withdrawal_requested', {
        userId: req.user!.id,
        amount,
        paymentMethod,
        phone,
      });

      res.json({
        success: true,
        message: `Demande de retrait de ${amount} XAF enregistrée. Le versement vers ${phone} sera effectué sous 24 h ouvrées.`,
        data: { newBalance, status: 'PENDING' },
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

      // 1 point = 10 XAF
      const creditAmount = points * 10;

      const wallet = await prisma.wallet.findUnique({
        where: { userId: req.user!.id },
      });

      if (!wallet) {
        throw new AppError('Portefeuille non trouvé', 404);
      }

      // 1) Retirer les points EN PREMIER, de façon atomique. Si deux échanges arrivent en
      //    même temps avec les mêmes points, un seul passe : l'autre reçoit null.
      const result = await redeemLoyaltyPoints(req.user!.id, points);
      if (!result) {
        throw new AppError('Points insuffisants', 400);
      }

      // 2) Créditer le wallet. Si cette étape échoue, on rend les points (pas de perte pour l'utilisateur).
      try {
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
      } catch (creditError) {
        await addLoyaltyPoints(req.user!.id, points).catch(() => {});
        throw creditError;
      }

      res.json({
        success: true,
        message: `${points} points échangés contre ${creditAmount} XAF !`,
        data: {
          creditAmount,
          remainingPoints: result.points,
          tier: result.tier,
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
