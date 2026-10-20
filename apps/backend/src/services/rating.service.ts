import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export type RatingServiceType = 'RIDE' | 'DELIVERY' | 'CARPOOL' | 'RENTAL';

export class RatingError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

interface SubmitRatingInput {
  serviceType: RatingServiceType;
  serviceId: string;
  raterId: string; // utilisateur qui note (connecté)
  ratedId: string; // utilisateur noté
  score: number;
  comment?: string;
  rideId?: string; // compat historique pour les courses
}

/**
 * Enregistre une note générique et bidirectionnelle.
 * - Empêche les doublons via la contrainte (serviceType, serviceId, raterId).
 * - Recalcule la moyenne du chauffeur si le noté possède un DriverProfile.
 *
 * Les vérifications métier (qui a le droit de noter, prestation terminée) sont
 * faites par chaque route appelante, qui fournit raterId/ratedId déjà validés.
 */
export async function submitRating(input: SubmitRatingInput) {
  const { serviceType, serviceId, raterId, ratedId, score, comment, rideId } = input;

  if (!ratedId) {
    throw new RatingError('Aucun utilisateur à évaluer', 400);
  }
  if (raterId === ratedId) {
    throw new RatingError('Vous ne pouvez pas vous évaluer vous-même', 400);
  }
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw new RatingError('Note entre 1 et 5', 400);
  }

  // Empêcher les doublons pour cette prestation par cet évaluateur
  const existing = await prisma.rating.findFirst({
    where: { serviceType, serviceId, raterId },
  });
  if (existing) {
    throw new RatingError('Vous avez déjà évalué cette prestation', 409);
  }

  const rating = await prisma.rating.create({
    data: {
      serviceType,
      serviceId,
      rideId: rideId || null,
      raterId,
      ratedId,
      score,
      comment: comment || null,
    },
  });

  // Recalculer la moyenne de l'évalué s'il est chauffeur (a un DriverProfile)
  const agg = await prisma.rating.aggregate({
    where: { ratedId },
    _avg: { score: true },
    _count: true,
  });
  const average = Math.round((agg._avg.score || score) * 10) / 10;

  const driverProfile = await prisma.driverProfile.findUnique({ where: { userId: ratedId } });
  if (driverProfile) {
    await prisma.driverProfile.update({
      where: { userId: ratedId },
      data: { averageRating: average },
    }).catch(() => {});
  }

  return { rating, average, totalRatings: agg._count };
}
