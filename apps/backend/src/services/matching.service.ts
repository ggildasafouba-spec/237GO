import { PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';

const prisma = new PrismaClient();

// Rayons de recherche (km) par type de service, et paliers d'élargissement.
// Si personne n'accepte dans le rayon initial, on élargit automatiquement.
const RADIUS_STEPS: Record<string, number[]> = {
  MOTO: [4, 8, 15],
  CAR_ECONOMY: [6, 12, 20],
  CAR_COMFORT: [6, 12, 20],
  CAR_VIP: [6, 12, 20],
  TRUCK: [7, 14, 25],
  DELIVERY: [7, 14, 25],
};

// Délai (ms) avant d'élargir le rayon si aucun chauffeur n'a accepté.
const EXPAND_DELAY_MS = 25000;

// Distance Haversine en km entre deux points GPS.
function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

interface NearbyParams {
  vehicleType?: string; // requis pour une course ; absent = livraison (tout chauffeur en ligne)
  pickupLat: number;
  pickupLng: number;
  radiusKm: number;
}

// Renvoie les chauffeurs en ligne, dans le rayon, triés du plus proche au plus loin.
async function findNearbyDrivers(params: NearbyParams) {
  const { vehicleType, pickupLat, pickupLng, radiusKm } = params;

  const where: Record<string, unknown> = {
    isOnline: true,
    currentLat: { not: null },
    currentLng: { not: null },
  };
  if (vehicleType) where.vehicleType = vehicleType;

  const drivers = await prisma.driverProfile.findMany({
    where,
    select: { userId: true, currentLat: true, currentLng: true },
  });

  return drivers
    .map((d) => ({
      userId: d.userId,
      dist: distanceKm(pickupLat, pickupLng, d.currentLat as number, d.currentLng as number),
    }))
    .filter((d) => d.dist <= radiusKm)
    .sort((a, b) => a.dist - b.dist);
}

interface DispatchParams {
  io: Server;
  event: 'new_ride_request' | 'new_delivery_request';
  payload: Record<string, unknown>;
  vehicleType?: string; // course : filtre par type ; livraison : laisser vide
  pickupLat: number;
  pickupLng: number;
  serviceType: 'ride' | 'delivery';
  serviceId: string;
}

// Vérifie si la course/livraison est toujours en attente (personne n'a accepté).
async function isStillPending(serviceType: 'ride' | 'delivery', serviceId: string): Promise<boolean> {
  if (serviceType === 'ride') {
    const r = await prisma.ride.findUnique({ where: { id: serviceId }, select: { status: true } });
    return r?.status === 'PENDING';
  }
  const d = await prisma.delivery.findUnique({ where: { id: serviceId }, select: { status: true } });
  return d?.status === 'PENDING';
}

/**
 * Notifie les chauffeurs à proximité, du plus proche au plus loin.
 * Élargit automatiquement le rayon si personne n'accepte dans le délai imparti.
 */
export async function dispatchToNearbyDrivers(params: DispatchParams) {
  const { io, event, payload, vehicleType, pickupLat, pickupLng, serviceType, serviceId } = params;

  const steps = RADIUS_STEPS[vehicleType || 'DELIVERY'] || RADIUS_STEPS.DELIVERY;
  // Mémorise les chauffeurs déjà notifiés pour ne pas les re-notifier à chaque palier.
  const alreadyNotified = new Set<string>();

  const notifyAtRadius = async (radiusKm: number) => {
    const nearby = await findNearbyDrivers({ vehicleType, pickupLat, pickupLng, radiusKm });
    let count = 0;
    for (const d of nearby) {
      if (alreadyNotified.has(d.userId)) continue;
      alreadyNotified.add(d.userId);
      io.to(`user:${d.userId}`).emit(event, { ...payload, distanceToPickup: Math.round(d.dist * 10) / 10 });
      count++;
    }
    return count;
  };

  // Palier initial : notifier tout de suite les plus proches.
  await notifyAtRadius(steps[0]);

  // Paliers suivants : on élargit seulement si toujours en attente.
  for (let i = 1; i < steps.length; i++) {
    const radius = steps[i];
    setTimeout(async () => {
      try {
        if (await isStillPending(serviceType, serviceId)) {
          await notifyAtRadius(radius);
        }
      } catch {
        // silencieux : un échec d'élargissement ne doit pas crasher le serveur
      }
    }, EXPAND_DELAY_MS * i);
  }

  return alreadyNotified.size;
}
