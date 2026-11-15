/**
 * LIVRAISON DES COMMANDES GO MARKET PAR LES CHAUFFEURS 237GO
 *
 * Le restaurant qui n'a pas de livreur appuie sur « Demander un livreur 237GO » :
 *  1. une livraison est créée (retrait : la boutique ; dépôt : l'adresse du client) et proposée
 *     aux chauffeurs proches, comme un colis ;
 *  2. à l'acceptation, le paiement déjà bloqué pour la commande est PARTAGÉ :
 *       - le prix des produits reste au restaurant (versé après réception, −15 %) ;
 *       - les frais de livraison passent au livreur (versés après réception, −15 %).
 *     Aucun argent n'est redébité au client : il a déjà payé la commande ET la livraison ;
 *  3. le livreur fait avancer la commande (récupérée → en route → livrée) ;
 *  4. le client confirme la réception une seule fois : le restaurant ET le livreur sont payés.
 *
 * Commandes payées en ESPÈCES : non concernées (l'argent est remis en main propre au restaurant,
 * qui livre lui-même). Uniquement les commandes payées par portefeuille / Mobile Money.
 */
import type { Server } from 'socket.io';
import { prisma } from './prisma';
import { AppError } from '../middleware/error.middleware';
import { PLATFORM_COMMISSION_RATE, refundFunds, confirmSide } from '../services/escrow.service';
import { dispatchToNearbyDrivers, deliveryRequestPayload } from '../services/matching.service';

const ACTIVE = ['PENDING', 'ACCEPTED', 'PICKING_UP', 'IN_TRANSIT'] as const;

function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

const commissionOf = (amount: number) => Math.round(amount * PLATFORM_COMMISSION_RATE);

/** Le restaurant demande un livreur 237GO pour une de ses commandes. */
export async function requestCourier(orderId: string, merchantUserId: string, io: Server) {
  const order = await prisma.marketOrder.findUnique({
    where: { id: orderId },
    include: {
      merchant: { select: { userId: true, shopName: true, shopAddress: true, shopLat: true, shopLng: true, user: { select: { phone: true } } } },
      customer: { select: { phone: true } },
      courierDelivery: true,
    },
  });
  if (!order || order.merchant.userId !== merchantUserId) throw new AppError('Commande non trouvée', 404);
  if (!['PENDING', 'CONFIRMED', 'PREPARING', 'READY'].includes(order.status)) {
    throw new AppError('Cette commande n\'est plus en préparation', 409);
  }
  if (order.paymentMethod !== 'WALLET') {
    throw new AppError(
      'Livraison 237GO possible uniquement pour les commandes payées dans l\'application. Pour une commande en espèces, livrez vous-même.',
      400
    );
  }
  if (!(order.deliveryFee > 0)) throw new AppError('Aucuns frais de livraison sur cette commande', 400);
  if (order.courierDelivery && (ACTIVE as readonly string[]).includes(order.courierDelivery.status)) {
    throw new AppError('Un livreur 237GO est déjà demandé pour cette commande', 409);
  }
  const escrow = await prisma.escrow.findFirst({ where: { serviceType: 'MARKET', serviceId: orderId, status: 'HELD' } });
  if (!escrow) throw new AppError('Le paiement de cette commande n\'est plus en attente', 409);

  const data = {
    senderId: order.customerId, // le client a payé la livraison
    driverId: null,
    status: 'PENDING' as const,
    packageType: 'FOOD' as const,
    packageDesc: `Commande ${order.merchant.shopName}`,
    pickupLat: order.merchant.shopLat,
    pickupLng: order.merchant.shopLng,
    pickupAddress: `${order.merchant.shopName} — ${order.merchant.shopAddress}`,
    pickupContact: order.merchant.user.phone,
    dropoffLat: order.deliveryLat,
    dropoffLng: order.deliveryLng,
    dropoffAddress: order.deliveryAddress,
    dropoffContact: order.customer.phone,
    distance: distanceKm(order.merchant.shopLat, order.merchant.shopLng, order.deliveryLat, order.deliveryLng),
    estimatedPrice: order.deliveryFee,
    finalPrice: null,
    paymentMethod: 'WALLET' as const,
    cancelledAt: null,
    cancelReason: null,
    pickedUpAt: null,
    deliveredAt: null,
  };
  // Une commande = au plus une livraison : une demande annulée est simplement relancée
  const delivery = order.courierDelivery
    ? await prisma.delivery.update({ where: { id: order.courierDelivery.id }, data })
    : await prisma.delivery.create({ data: { ...data, marketOrderId: orderId } });

  await dispatchToNearbyDrivers({
    io,
    event: 'new_delivery_request',
    pickupLat: delivery.pickupLat,
    pickupLng: delivery.pickupLng,
    serviceType: 'delivery',
    serviceId: delivery.id,
    payload: deliveryRequestPayload(delivery),
  });
  return delivery;
}

/** Le restaurant retire sa demande tant qu'aucun livreur n'a accepté. */
export async function cancelCourierRequest(orderId: string, merchantUserId: string) {
  const order = await prisma.marketOrder.findUnique({
    where: { id: orderId },
    include: { merchant: { select: { userId: true } }, courierDelivery: true },
  });
  if (!order || order.merchant.userId !== merchantUserId) throw new AppError('Commande non trouvée', 404);
  const d = order.courierDelivery;
  if (!d || d.status === 'CANCELLED') return;
  const done = await prisma.delivery.updateMany({
    where: { id: d.id, status: 'PENDING', driverId: null },
    data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'Demande retirée par le marchand' },
  });
  if (done.count !== 1) throw new AppError('Un livreur a déjà accepté : contactez-le directement', 409);
}

/**
 * À l'acceptation par le livreur : les frais de livraison quittent le paiement du restaurant
 * pour un paiement propre au livreur (même argent, déjà bloqué : rien n'est redébité).
 */
export async function attachCourierPayment(deliveryId: string, marketOrderId: string, driverId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`escrow:MARKET:${marketOrderId}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`escrow:DELIVERY:${deliveryId}`}))`;
    const order = await tx.marketOrder.findUniqueOrThrow({ where: { id: marketOrderId }, select: { deliveryFee: true, customerId: true, status: true } });
    if (order.status === 'CANCELLED' || order.status === 'DELIVERED') {
      throw new AppError('Cette commande vient d\'être annulée ou terminée', 409);
    }
    const market = await tx.escrow.findFirst({ where: { serviceType: 'MARKET', serviceId: marketOrderId, status: 'HELD' } });
    if (!market) throw new AppError('Le paiement de cette commande n\'est plus disponible', 409);
    const already = await tx.escrow.findFirst({ where: { serviceType: 'DELIVERY', serviceId: deliveryId, status: { in: ['HELD', 'DISPUTED'] } } });
    if (already) throw new AppError('Un paiement est déjà en séquestre pour cette livraison', 409);

    const fee = Math.min(order.deliveryFee, market.amount);
    const rest = market.amount - fee;
    await tx.escrow.update({ where: { id: market.id }, data: { amount: rest, commission: commissionOf(rest) } });
    await tx.escrow.create({
      data: {
        serviceType: 'DELIVERY',
        serviceId: deliveryId,
        amount: fee,
        commission: commissionOf(fee),
        payerId: order.customerId,
        payeeId: driverId,
        paymentMethod: market.paymentMethod,
        status: 'HELD',
      },
    });
  });
}

/**
 * Le livreur se désiste : les frais de livraison reviennent au paiement de la commande et la
 * livraison est reproposée aux autres chauffeurs (le client n'est pas pénalisé).
 */
export async function releaseCourier(deliveryId: string, marketOrderId: string, io: Server) {
  let orphanEscrowId: string | null = null;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`escrow:MARKET:${marketOrderId}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`escrow:DELIVERY:${deliveryId}`}))`;
    const courier = await tx.escrow.findFirst({ where: { serviceType: 'DELIVERY', serviceId: deliveryId, status: 'HELD' } });
    const market = await tx.escrow.findFirst({ where: { serviceType: 'MARKET', serviceId: marketOrderId, status: 'HELD' } });
    if (courier && market) {
      const back = market.amount + courier.amount;
      await tx.escrow.update({ where: { id: market.id }, data: { amount: back, commission: commissionOf(back) } });
      await tx.escrow.update({
        where: { id: courier.id },
        data: { status: 'REFUNDED', refundedAt: new Date(), resolvedBy: 'courier-reassigned' },
      });
    } else if (courier) {
      orphanEscrowId = courier.id; // commande déjà réglée/annulée : on rend les frais au client
    }
    await tx.delivery.update({
      where: { id: deliveryId },
      data: { status: 'PENDING', driverId: null, pickedUpAt: null },
    });
  });
  if (orphanEscrowId) await refundFunds(orphanEscrowId, 'auto').catch(() => {});

  const delivery = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
  const order = await prisma.marketOrder.findUnique({ where: { id: marketOrderId }, select: { status: true } });
  if (order && order.status !== 'CANCELLED' && order.status !== 'DELIVERED') {
    await dispatchToNearbyDrivers({
      io,
      event: 'new_delivery_request',
      pickupLat: delivery.pickupLat,
      pickupLng: delivery.pickupLng,
      serviceType: 'delivery',
      serviceId: delivery.id,
      payload: deliveryRequestPayload(delivery),
    });
  }
}

/** La commande est annulée : la livraison aussi, et les frais déjà attribués au livreur sont rendus au client. */
export async function cancelCourierForOrder(marketOrderId: string, io: Server) {
  const d = await prisma.delivery.findUnique({ where: { marketOrderId } });
  if (!d || !(ACTIVE as readonly string[]).includes(d.status)) return;
  await prisma.delivery.update({
    where: { id: d.id },
    data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'Commande annulée par le marchand' },
  });
  const courier = await prisma.escrow.findFirst({ where: { serviceType: 'DELIVERY', serviceId: d.id, status: { in: ['HELD', 'DISPUTED'] } } });
  if (courier) await refundFunds(courier.id, 'auto').catch((e) => console.error('Remboursement frais de livraison échoué:', e.message));
  if (d.driverId) io.to(`user:${d.driverId}`).emit('delivery_status_update', { deliveryId: d.id, status: 'CANCELLED' });
}

/**
 * Le livreur fait avancer la livraison : la commande suit.
 *  - colis récupéré (IN_TRANSIT) : la commande est « en livraison » et le restaurant a remis
 *    la commande → sa part peut être versée dès que le client confirme ;
 *  - livré (DELIVERED) : la commande est « livrée » ; le client confirme la réception.
 */
export async function syncOrderWithCourier(marketOrderId: string, deliveryStatus: string, io: Server) {
  const order = await prisma.marketOrder.findUnique({
    where: { id: marketOrderId },
    include: { merchant: { select: { userId: true } } },
  });
  if (!order || order.status === 'CANCELLED' || order.status === 'DELIVERED') return;

  let status: 'DELIVERING' | 'DELIVERED' | null = null;
  if (deliveryStatus === 'IN_TRANSIT') status = 'DELIVERING';
  if (deliveryStatus === 'DELIVERED') status = 'DELIVERED';
  if (!status) {
    io.to(`user:${order.merchant.userId}`).emit('order_courier_update', { orderId: order.id, deliveryStatus });
    return;
  }

  await prisma.marketOrder.updateMany({
    where: { id: order.id, status: { notIn: ['CANCELLED', 'DELIVERED'] } },
    data: { status },
  });
  // Le restaurant a remis la commande au livreur : c'est sa confirmation de « service rendu »
  await confirmSide('MARKET', order.id, 'provider', order.merchant.userId).catch(() => {});

  io.to(`user:${order.customerId}`).emit('order_status_update', { orderId: order.id, status });
  io.to(`user:${order.merchant.userId}`).emit('order_courier_update', { orderId: order.id, deliveryStatus });
  if (status === 'DELIVERED') {
    io.to(`user:${order.customerId}`).emit('order_completed', {
      orderId: order.id,
      grandTotal: order.totalAmount + order.deliveryFee,
      action: 'confirm_reception',
    });
  }
}
