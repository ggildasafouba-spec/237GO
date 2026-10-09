import { PrismaClient, PaymentMethod, EscrowServiceType, EscrowStatus } from '@prisma/client';
import { AppError } from '../middleware/error.middleware';
import { addLoyaltyPoints } from './loyalty.service';
import { sendPushNotification } from './notification.service';

const prisma = new PrismaClient();

// Taux de commission de la plateforme (15%)
export const PLATFORM_COMMISSION_RATE = 0.15;

/**
 * SYSTÈME D'ESCROW (séquestre de paiement)
 *
 * Flux :
 * 1. holdFunds()    → le client est débité, l'argent est BLOQUÉ (status HELD)
 * 2. confirmSide()  → client ET/OU prestataire valident la fin du service
 *                     quand les deux ont confirmé → libération automatique
 * 3. releaseFunds() → l'argent (−commission) est versé au prestataire (status RELEASED)
 * 4. refundFunds()  → l'argent est rendu au client (status REFUNDED)
 * 5. openDispute()  → litige, décision admin requise (status DISPUTED)
 */

export interface HoldFundsParams {
  amount: number;
  payerId: string;             // client
  payeeId: string;             // prestataire
  paymentMethod: PaymentMethod;
  serviceType: EscrowServiceType;
  serviceId: string;
}

/**
 * Bloque les fonds du client dans l'escrow.
 * Si paiement WALLET → débite immédiatement le portefeuille du client.
 * Pour les autres méthodes (MoMo, Orange, Cash) → l'escrow est créé en attente
 * de confirmation du paiement externe (ou cash remis au prestataire).
 */
export async function holdFunds(params: HoldFundsParams) {
  const { amount, payerId, payeeId, paymentMethod, serviceType, serviceId } = params;

  const commission = Math.round(amount * PLATFORM_COMMISSION_RATE);

  // Débiter le client si paiement par portefeuille
  if (paymentMethod === 'WALLET') {
    const wallet = await prisma.wallet.findUnique({ where: { userId: payerId } });
    if (!wallet || wallet.balance < amount) {
      throw new AppError('Solde insuffisant pour effectuer cette réservation', 400);
    }

    await prisma.$transaction([
      prisma.wallet.update({
        where: { id: wallet.id },
        data: { balance: { decrement: amount } },
      }),
      prisma.transaction.create({
        data: {
          walletId: wallet.id,
          type: 'PAYMENT',
          amount,
          paymentMethod: 'WALLET',
          status: 'COMPLETED',
          description: `Blocage escrow ${serviceType} ${serviceId.substring(0, 8)}`,
          reference: serviceId,
        },
      }),
    ]);
  }

  // Créer l'enregistrement escrow
  const escrow = await prisma.escrow.create({
    data: {
      serviceType,
      serviceId,
      amount,
      commission,
      payerId,
      payeeId,
      paymentMethod,
      status: 'HELD',
    },
  });

  return escrow;
}

/**
 * Enregistre la confirmation de fin de service par un côté (client ou prestataire).
 * Si les DEUX ont confirmé, libère automatiquement les fonds.
 */
export async function confirmSide(
  serviceType: EscrowServiceType,
  serviceId: string,
  side: 'client' | 'provider',
  userId: string
) {
  const escrow = await prisma.escrow.findFirst({
    where: { serviceType, serviceId, status: 'HELD' },
  });

  if (!escrow) {
    throw new AppError('Aucun paiement en séquestre pour ce service', 404);
  }

  // Vérifier que l'utilisateur a le droit de confirmer ce côté
  if (side === 'client' && escrow.payerId !== userId) {
    throw new AppError('Vous n\'êtes pas le client de ce service', 403);
  }
  if (side === 'provider' && escrow.payeeId !== userId) {
    throw new AppError('Vous n\'êtes pas le prestataire de ce service', 403);
  }

  const updated = await prisma.escrow.update({
    where: { id: escrow.id },
    data: side === 'client' ? { clientConfirmed: true } : { providerConfirmed: true },
  });

  // Si les deux ont confirmé → libérer automatiquement
  if (updated.clientConfirmed && updated.providerConfirmed) {
    return releaseFunds(escrow.id, 'auto');
  }

  return updated;
}

/**
 * Libère les fonds vers le prestataire (−commission).
 * Appelé automatiquement (double confirmation) ou manuellement par un admin.
 */
export async function releaseFunds(escrowId: string, releasedBy: string) {
  const escrow = await prisma.escrow.findUnique({ where: { id: escrowId } });
  if (!escrow) {
    throw new AppError('Escrow non trouvé', 404);
  }
  if (escrow.status !== 'HELD' && escrow.status !== 'DISPUTED') {
    throw new AppError(`Escrow déjà traité (${escrow.status})`, 400);
  }

  const payeeEarnings = escrow.amount - escrow.commission;
  const payeeWallet = await prisma.wallet.findUnique({ where: { userId: escrow.payeeId } });

  if (escrow.paymentMethod === 'CASH') {
    // CASH : le client a payé le prestataire en liquide (de la main à la main).
    // Le prestataire doit donc la commission à la plateforme → on la PRÉLÈVE de son wallet.
    if (payeeWallet) {
      await prisma.$transaction([
        prisma.wallet.update({
          where: { id: payeeWallet.id },
          data: { balance: { decrement: escrow.commission } },
        }),
        prisma.transaction.create({
          data: {
            walletId: payeeWallet.id,
            type: 'PAYMENT',
            amount: escrow.commission,
            paymentMethod: 'CASH',
            status: 'COMPLETED',
            description: `Commission 237GO (${escrow.commission} XAF) sur ${escrow.serviceType} ${escrow.serviceId.substring(0, 8)} payé en espèces`,
            reference: escrow.serviceId,
          },
        }),
      ]);
    }
  } else {
    // Paiement électronique (WALLET, MoMo, Orange...) : on CRÉDITE le prestataire (−commission)
    if (payeeWallet) {
      await prisma.$transaction([
        prisma.wallet.update({
          where: { id: payeeWallet.id },
          data: { balance: { increment: payeeEarnings } },
        }),
        prisma.transaction.create({
          data: {
            walletId: payeeWallet.id,
            type: 'PAYMENT',
            amount: payeeEarnings,
            paymentMethod: escrow.paymentMethod,
            status: 'COMPLETED',
            description: `Libération escrow ${escrow.serviceType} ${escrow.serviceId.substring(0, 8)} (commission ${escrow.commission} XAF)`,
            reference: escrow.serviceId,
          },
        }),
      ]);
    }
  }

  // Points de fidélité au client (1 point / 100 XAF) + recalcul du palier
  const loyaltyPoints = Math.floor(escrow.amount / 100);
  if (loyaltyPoints > 0) {
    await addLoyaltyPoints(escrow.payerId, loyaltyPoints).catch(() => {});
  }

  // Notifier le prestataire
  const payNotif = escrow.paymentMethod === 'CASH'
    ? { title: '✅ Service validé', body: `Course réglée en espèces. Commission 237GO : ${escrow.commission.toLocaleString()} XAF prélevée.` }
    : { title: '💰 Paiement reçu !', body: `Vous avez reçu ${payeeEarnings.toLocaleString()} XAF pour votre prestation.` };
  await sendPushNotification({
    userId: escrow.payeeId,
    title: payNotif.title,
    body: payNotif.body,
    type: 'payment',
    data: { serviceType: escrow.serviceType, serviceId: escrow.serviceId },
  }).catch(() => {});

  return prisma.escrow.update({
    where: { id: escrowId },
    data: {
      status: 'RELEASED',
      releasedAt: new Date(),
      resolvedBy: releasedBy === 'auto' ? null : releasedBy,
    },
  });
}

/**
 * Rembourse les fonds au client. Appelé en cas d'annulation ou de litige tranché
 * en faveur du client (par un admin).
 */
export async function refundFunds(escrowId: string, refundedBy: string) {
  const escrow = await prisma.escrow.findUnique({ where: { id: escrowId } });
  if (!escrow) {
    throw new AppError('Escrow non trouvé', 404);
  }
  if (escrow.status === 'RELEASED') {
    throw new AppError('Impossible de rembourser : fonds déjà versés au prestataire', 400);
  }
  if (escrow.status === 'REFUNDED') {
    throw new AppError('Escrow déjà remboursé', 400);
  }

  // Recréditer le client (uniquement si payé par wallet au départ)
  if (escrow.paymentMethod === 'WALLET') {
    const payerWallet = await prisma.wallet.findUnique({ where: { userId: escrow.payerId } });
    if (payerWallet) {
      await prisma.$transaction([
        prisma.wallet.update({
          where: { id: payerWallet.id },
          data: { balance: { increment: escrow.amount } },
        }),
        prisma.transaction.create({
          data: {
            walletId: payerWallet.id,
            type: 'REFUND',
            amount: escrow.amount,
            paymentMethod: 'WALLET',
            status: 'COMPLETED',
            description: `Remboursement escrow ${escrow.serviceType} ${escrow.serviceId.substring(0, 8)}`,
            reference: escrow.serviceId,
          },
        }),
      ]);
    }
  }

  return prisma.escrow.update({
    where: { id: escrowId },
    data: {
      status: 'REFUNDED',
      refundedAt: new Date(),
      resolvedBy: refundedBy === 'auto' ? null : refundedBy,
    },
  });
}

/**
 * Ouvre un litige sur un escrow. Bloque la libération automatique
 * jusqu'à décision d'un admin.
 */
export async function openDispute(
  serviceType: EscrowServiceType,
  serviceId: string,
  userId: string,
  reason: string
) {
  const escrow = await prisma.escrow.findFirst({
    where: { serviceType, serviceId, status: 'HELD' },
  });

  if (!escrow) {
    throw new AppError('Aucun paiement en séquestre pour ce service', 404);
  }

  // Seuls le client ou le prestataire concernés peuvent ouvrir un litige
  if (escrow.payerId !== userId && escrow.payeeId !== userId) {
    throw new AppError('Vous n\'êtes pas concerné par ce service', 403);
  }

  return prisma.escrow.update({
    where: { id: escrow.id },
    data: { status: 'DISPUTED', disputeReason: reason },
  });
}

/**
 * Récupère l'escrow d'un service donné.
 */
export async function getEscrowForService(serviceType: EscrowServiceType, serviceId: string) {
  return prisma.escrow.findFirst({
    where: { serviceType, serviceId },
    orderBy: { createdAt: 'desc' },
  });
}
