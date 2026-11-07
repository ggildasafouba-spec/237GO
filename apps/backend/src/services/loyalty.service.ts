import { LoyaltyTier } from '@prisma/client';
import { prisma } from '../lib/prisma';

// Seuils des paliers (points cumulés)
export const TIER_THRESHOLDS: { tier: LoyaltyTier; min: number }[] = [
  { tier: 'PLATINUM', min: 5000 },
  { tier: 'GOLD', min: 2000 },
  { tier: 'SILVER', min: 500 },
  { tier: 'BRONZE', min: 0 },
];

/**
 * Calcule le palier correspondant à un nombre de points.
 */
export function computeTier(points: number): LoyaltyTier {
  for (const t of TIER_THRESHOLDS) {
    if (points >= t.min) return t.tier;
  }
  return 'BRONZE';
}

/**
 * Ajoute des points de fidélité à un utilisateur ET recalcule son palier.
 * Centralise toute la logique de fidélité (gain + mise à jour du tier).
 *
 * @returns les points totaux et le nouveau palier, ou null si pas de points à ajouter
 */
export async function addLoyaltyPoints(
  userId: string,
  pointsToAdd: number
): Promise<{ points: number; tier: LoyaltyTier; tierChanged: boolean } | null> {
  if (pointsToAdd <= 0) return null;

  // Incrément ATOMIQUE côté base : deux gains simultanés s'additionnent tous les deux
  // (l'ancienne lecture puis écriture pouvait en perdre un).
  let updated;
  try {
    updated = await prisma.loyaltyPoints.update({
      where: { userId },
      data: { points: { increment: pointsToAdd } },
    });
  } catch {
    return null; // pas de ligne de fidélité pour cet utilisateur
  }

  const newTier = computeTier(updated.points);
  const tierChanged = newTier !== updated.tier;
  if (tierChanged) {
    await prisma.loyaltyPoints.update({ where: { userId }, data: { tier: newTier } });
  }

  return { points: updated.points, tier: newTier, tierChanged };
}

/**
 * Retire des points (échange contre crédit) et recalcule le palier.
 */
export async function redeemLoyaltyPoints(
  userId: string,
  pointsToRemove: number
): Promise<{ points: number; tier: LoyaltyTier } | null> {
  // Retrait ATOMIQUE : ne réussit que s'il reste assez de points AU MOMENT du retrait.
  // Renvoie null sinon (ex. deux échanges simultanés avec les mêmes points).
  const claimed = await prisma.loyaltyPoints.updateMany({
    where: { userId, points: { gte: pointsToRemove } },
    data: { points: { decrement: pointsToRemove } },
  });
  if (claimed.count !== 1) return null;

  const loyalty = await prisma.loyaltyPoints.findUnique({ where: { userId } });
  if (!loyalty) return null;

  const newTier = computeTier(loyalty.points);
  if (newTier !== loyalty.tier) {
    await prisma.loyaltyPoints.update({ where: { userId }, data: { tier: newTier } });
  }

  return { points: loyalty.points, tier: newTier };
}
