import { PaymentMethod, EscrowServiceType, EscrowStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/error.middleware';
import { addLoyaltyPoints } from './loyalty.service';
import { sendPushNotification } from './notification.service';

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
 *
 * CONCURRENCE : chaque transition d'état est ATOMIQUE. On "réclame" d'abord
 * l'escrow avec un updateMany conditionnel (WHERE status = état attendu) ; seule
 * la requête qui obtient count = 1 a le droit de bouger l'argent. Deux appels
 * simultanés ne peuvent donc jamais payer deux fois. Les mouvements d'argent et le
 * changement de statut se font dans UNE seule transaction : tout passe ou rien.
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
 * Si paiement WALLET → débite immédiatement le portefeuille du client, de façon
 * atomique (le débit n'a lieu que si le solde est suffisant AU MOMENT du débit).
 * Pour les autres méthodes (MoMo, Orange, Cash) → l'escrow est créé en attente
 * de confirmation du paiement externe (ou cash remis au prestataire).
 */
export async function holdFunds(params: HoldFundsParams) {
  const { amount, payerId, payeeId, paymentMethod, serviceType, serviceId } = params;

  const commission = Math.round(amount * PLATFORM_COMMISSION_RATE);

  return prisma.$transaction(async (tx) => {
    // VERROU par service : sans lui, deux transactions simultanées lisent toutes les deux
    // "aucun escrow" puis en créent chacune un (le test de concurrence l'a démontré :
    // 20 appels simultanés créaient 10 escrows). pg_advisory_xact_lock sérialise les
    // blocages d'un MÊME service ; il est libéré automatiquement en fin de transaction.
    // Les services différents ne s'attendent pas entre eux.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`escrow:${serviceType}:${serviceId}`}))`;

    // Un seul escrow actif par service : évite un double blocage d'argent.
    const existing = await tx.escrow.findFirst({
      where: { serviceType, serviceId, status: { in: ['HELD', 'DISPUTED'] } },
    });
    if (existing) {
      throw new AppError('Un paiement est déjà en séquestre pour ce service', 409);
    }

    if (paymentMethod === 'WALLET') {
      const wallet = await tx.wallet.findUnique({ where: { userId: payerId } });
      if (!wallet) {
        throw new AppError('Solde insuffisant pour effectuer cette réservation', 400);
      }

      // Débit conditionnel : ne réussit que si balance >= amount, même si
      // plusieurs réservations arrivent en même temps.
      const debited = await tx.wallet.updateMany({
        where: { id: wallet.id, balance: { gte: amount } },
        data: { balance: { decrement: amount } },
      });
      if (debited.count !== 1) {
        throw new AppError('Solde insuffisant pour effectuer cette réservation', 400);
      }

      await tx.transaction.create({
        data: {
          walletId: wallet.id,
          type: 'PAYMENT',
          amount,
          paymentMethod: 'WALLET',
          status: 'COMPLETED',
          description: `Blocage escrow ${serviceType} ${serviceId.substring(0, 8)}`,
          reference: serviceId,
        },
      });
    }

    return tx.escrow.create({
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
  });
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
    try {
      return await releaseFunds(escrow.id, 'auto');
    } catch (error) {
      // L'autre côté vient de déclencher la libération en même temps : c'est normal,
      // les fonds ont déjà été versés une fois. On renvoie l'état actuel.
      if (error instanceof AppError && error.statusCode === 400) {
        return prisma.escrow.findUniqueOrThrow({ where: { id: escrow.id } });
      }
      throw error;
    }
  }

  return updated;
}

/**
 * Libère les fonds vers le prestataire (−commission).
 * Appelé automatiquement (double confirmation) ou manuellement par un admin.
 * Atomique : un escrow ne peut être libéré qu'UNE seule fois.
 */
export async function releaseFunds(escrowId: string, releasedBy: string) {
  const escrow = await prisma.$transaction(async (tx) => {
    const current = await tx.escrow.findUnique({ where: { id: escrowId } });
    if (!current) {
      throw new AppError('Escrow non trouvé', 404);
    }

    // Réclamation atomique : une seule requête peut passer HELD/DISPUTED → RELEASED.
    const claimed = await tx.escrow.updateMany({
      where: { id: escrowId, status: { in: ['HELD', 'DISPUTED'] } },
      data: {
        status: 'RELEASED',
        releasedAt: new Date(),
        resolvedBy: releasedBy === 'auto' ? null : releasedBy,
      },
    });
    if (claimed.count !== 1) {
      throw new AppError('Escrow déjà traité', 400);
    }

    const payeeEarnings = current.amount - current.commission;
    const payeeWallet = await tx.wallet.findUnique({ where: { userId: current.payeeId } });

    if (payeeWallet) {
      if (current.paymentMethod === 'CASH') {
        // CASH : le client a payé le prestataire en liquide (de la main à la main).
        // Le prestataire doit donc la commission à la plateforme → on la PRÉLÈVE de son wallet.
        await tx.wallet.update({
          where: { id: payeeWallet.id },
          data: { balance: { decrement: current.commission } },
        });
        await tx.transaction.create({
          data: {
            walletId: payeeWallet.id,
            type: 'PAYMENT',
            amount: current.commission,
            paymentMethod: 'CASH',
            status: 'COMPLETED',
            description: `Commission 237GO (${current.commission} XAF) sur ${current.serviceType} ${current.serviceId.substring(0, 8)} payé en espèces`,
            reference: current.serviceId,
          },
        });
      } else {
        // Paiement électronique (WALLET, MoMo, Orange...) : on CRÉDITE le prestataire (−commission)
        await tx.wallet.update({
          where: { id: payeeWallet.id },
          data: { balance: { increment: payeeEarnings } },
        });
        await tx.transaction.create({
          data: {
            walletId: payeeWallet.id,
            type: 'PAYMENT',
            amount: payeeEarnings,
            paymentMethod: current.paymentMethod,
            status: 'COMPLETED',
            description: `Libération escrow ${current.serviceType} ${current.serviceId.substring(0, 8)} (commission ${current.commission} XAF)`,
            reference: current.serviceId,
          },
        });
      }
    }

    return current;
  });

  // --- Effets secondaires APRÈS la transaction (un échec ici ne doit pas annuler le paiement) ---

  // Points de fidélité au client (1 point / 100 XAF) + recalcul du palier
  const loyaltyPoints = Math.floor(escrow.amount / 100);
  if (loyaltyPoints > 0) {
    await addLoyaltyPoints(escrow.payerId, loyaltyPoints).catch(() => {});
  }

  // Notifier le prestataire
  const payeeEarnings = escrow.amount - escrow.commission;
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

  return prisma.escrow.findUniqueOrThrow({ where: { id: escrowId } });
}

/**
 * Rembourse les fonds au client. Appelé en cas d'annulation ou de litige tranché
 * en faveur du client (par un admin).
 * Atomique : un escrow ne peut être remboursé qu'UNE seule fois, et jamais après libération.
 */
export async function refundFunds(escrowId: string, refundedBy: string) {
  await prisma.$transaction(async (tx) => {
    const current = await tx.escrow.findUnique({ where: { id: escrowId } });
    if (!current) {
      throw new AppError('Escrow non trouvé', 404);
    }
    if (current.status === 'RELEASED') {
      throw new AppError('Impossible de rembourser : fonds déjà versés au prestataire', 400);
    }
    if (current.status === 'REFUNDED') {
      throw new AppError('Escrow déjà remboursé', 400);
    }

    // Réclamation atomique : une seule requête peut passer HELD/DISPUTED → REFUNDED.
    const claimed = await tx.escrow.updateMany({
      where: { id: escrowId, status: { in: ['HELD', 'DISPUTED'] } },
      data: {
        status: 'REFUNDED',
        refundedAt: new Date(),
        resolvedBy: refundedBy === 'auto' ? null : refundedBy,
      },
    });
    if (claimed.count !== 1) {
      throw new AppError('Escrow déjà traité', 400);
    }

    // Recréditer le client (uniquement si payé par wallet au départ)
    if (current.paymentMethod === 'WALLET') {
      const payerWallet = await tx.wallet.findUnique({ where: { userId: current.payerId } });
      if (payerWallet) {
        await tx.wallet.update({
          where: { id: payerWallet.id },
          data: { balance: { increment: current.amount } },
        });
        await tx.transaction.create({
          data: {
            walletId: payerWallet.id,
            type: 'REFUND',
            amount: current.amount,
            paymentMethod: 'WALLET',
            status: 'COMPLETED',
            description: `Remboursement escrow ${current.serviceType} ${current.serviceId.substring(0, 8)}`,
            reference: current.serviceId,
          },
        });
      }
    }
  });

  return prisma.escrow.findUniqueOrThrow({ where: { id: escrowId } });
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

  // Bascule atomique HELD → DISPUTED : si les fonds viennent d'être libérés
  // entre-temps, le litige ne doit pas écraser ce statut.
  const claimed = await prisma.escrow.updateMany({
    where: { id: escrow.id, status: 'HELD' },
    data: { status: 'DISPUTED', disputeReason: reason },
  });
  if (claimed.count !== 1) {
    throw new AppError('Ce paiement a déjà été traité, litige impossible', 409);
  }

  return prisma.escrow.findUniqueOrThrow({ where: { id: escrow.id } });
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

/**
 * Indique si une prestation est terminée (paiement libéré au prestataire).
 * Sert de "garde" avant d'autoriser une évaluation.
 */
export async function isServiceCompleted(serviceType: EscrowServiceType, serviceId: string): Promise<boolean> {
  const escrow = await getEscrowForService(serviceType, serviceId);
  return escrow?.status === 'RELEASED';
}
