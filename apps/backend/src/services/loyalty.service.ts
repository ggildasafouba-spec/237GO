import { PrismaClient, LoyaltyTier } from '@prisma/client';

const prisma = new PrismaClient();

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

  const loyalty = await prisma.loyaltyPoints.findUnique({ where: { userId } });
  if (!loyalty) return null;

  const newPoints = loyalty.points + pointsToAdd;
  const newTier = computeTier(newPoints);
  const tierChanged = newTier !== loyalty.tier;

  await prisma.loyaltyPoints.update({
    where: { userId },
    data: { points: newPoints, tier: newTier },
  });

  return { points: newPoints, tier: newTier, tierChanged };
}

/**
 * Retire des points (échange contre crédit) et recalcule le palier.
 */
export async function redeemLoyaltyPoints(
  userId: string,
  pointsToRemove: number
): Promise<{ points: number; tier: LoyaltyTier } | null> {
  const loyalty = await prisma.loyaltyPoints.findUnique({ where: { userId } });
  if (!loyalty || loyalty.points < pointsToRemove) return null;

  const newPoints = loyalty.points - pointsToRemove;
  const newTier = computeTier(newPoints);

  await prisma.loyaltyPoints.update({
    where: { userId },
    data: { points: newPoints, tier: newTier },
  });

  return { points: newPoints, tier: newTier };
}
