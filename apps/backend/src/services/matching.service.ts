import { prisma } from '../lib/prisma';
import type { Server } from 'socket.io';

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

/**
 * REPRISE APRÈS REDÉMARRAGE
 *
 * L'élargissement du rayon repose sur des timers en mémoire : si le serveur redémarre
 * (redéploiement Railway, crash), ces timers sont perdus et une demande récente restait
 * bloquée sur son premier rayon. Au démarrage, on relance donc la recherche pour les
 * courses et livraisons ENCORE en attente et créées récemment.
 *
 * On ne relance que les demandes de moins de 10 minutes : au-delà, le client a
 * certainement abandonné ou réessayé, inutile de spammer les chauffeurs.
 */
const RESUME_MAX_AGE_MS = 10 * 60 * 1000;

export async function resumePendingDispatches(io: Server): Promise<number> {
  const since = new Date(Date.now() - RESUME_MAX_AGE_MS);
  let resumed = 0;

  const [rides, deliveries] = await Promise.all([
    prisma.ride.findMany({ where: { status: 'PENDING', createdAt: { gte: since } } }),
    prisma.delivery.findMany({ where: { status: 'PENDING', createdAt: { gte: since } } }),
  ]);

  for (const ride of rides) {
    await dispatchToNearbyDrivers({
      io,
      event: 'new_ride_request',
      vehicleType: ride.vehicleType,
      pickupLat: ride.pickupLat,
      pickupLng: ride.pickupLng,
      serviceType: 'ride',
      serviceId: ride.id,
      payload: rideRequestPayload(ride),
    }).catch(() => {});
    resumed++;
  }

  for (const d of deliveries) {
    await dispatchToNearbyDrivers({
      io,
      event: 'new_delivery_request',
      pickupLat: d.pickupLat,
      pickupLng: d.pickupLng,
      serviceType: 'delivery',
      serviceId: d.id,
      payload: deliveryRequestPayload(d),
    }).catch(() => {});
    resumed++;
  }

  return resumed;
}

// Contenu d'une demande de course / livraison envoyée aux chauffeurs (format unique)
type RideRow = Awaited<ReturnType<typeof prisma.ride.findMany>>[number];
type DeliveryRow = Awaited<ReturnType<typeof prisma.delivery.findMany>>[number];

export function rideRequestPayload(ride: RideRow) {
  return {
    rideId: ride.id,
    pickup: { lat: ride.pickupLat, lng: ride.pickupLng, address: ride.pickupAddress },
    dropoff: { lat: ride.dropoffLat, lng: ride.dropoffLng, address: ride.dropoffAddress },
    estimatedPrice: ride.estimatedPrice,
    proposedPrice: ride.proposedPrice,
    vehicleType: ride.vehicleType,
    distance: ride.distance,
    duration: ride.duration,
    passengerCount: ride.passengerCount,
    luggageSize: ride.luggageSize,
  };
}

export function deliveryRequestPayload(d: DeliveryRow) {
  return {
    deliveryId: d.id,
    pickup: { lat: d.pickupLat, lng: d.pickupLng, address: d.pickupAddress },
    dropoff: { lat: d.dropoffLat, lng: d.dropoffLng, address: d.dropoffAddress },
    packageType: d.packageType,
    estimatedPrice: d.estimatedPrice,
    distance: d.distance,
  };
}

/**
 * RATTRAPAGE À LA MISE EN LIGNE
 *
 * Une demande n'était envoyée qu'au moment de sa création (+ 2 relances à 25 s et 50 s).
 * Un chauffeur qui se mettait en ligne APRÈS ne voyait donc jamais les clients qui
 * attendaient déjà. Désormais, à sa mise en ligne, il reçoit les courses (de son type
 * de véhicule) et livraisons encore en attente, dans le plus grand rayon de recherche.
 */
export async function sendPendingRequestsToDriver(params: {
  io: Server;
  driverUserId: string;
  vehicleType: string;
  lat: number;
  lng: number;
}): Promise<{ rides: number; deliveries: number }> {
  const { io, driverUserId, vehicleType, lat, lng } = params;
  const since = new Date(Date.now() - RESUME_MAX_AGE_MS);

  const rideSteps = RADIUS_STEPS[vehicleType] || RADIUS_STEPS.CAR_ECONOMY;
  const rideMaxKm = rideSteps[rideSteps.length - 1];
  const deliveryMaxKm = RADIUS_STEPS.DELIVERY[RADIUS_STEPS.DELIVERY.length - 1];

  const [rides, deliveries] = await Promise.all([
    prisma.ride.findMany({
      where: { status: 'PENDING', driverId: null, vehicleType: vehicleType as any, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.delivery.findMany({
      where: { status: 'PENDING', driverId: null, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ]);

  let rideCount = 0;
  for (const r of rides) {
    const dist = distanceKm(lat, lng, r.pickupLat, r.pickupLng);
    if (dist <= rideMaxKm && r.passengerId !== driverUserId) {
      io.to(`user:${driverUserId}`).emit('new_ride_request', {
        ...rideRequestPayload(r),
        distanceToPickup: Math.round(dist * 10) / 10,
      });
      rideCount++;
    }
  }

  let deliveryCount = 0;
  for (const d of deliveries) {
    const dist = distanceKm(lat, lng, d.pickupLat, d.pickupLng);
    if (dist <= deliveryMaxKm && d.senderId !== driverUserId) {
      io.to(`user:${driverUserId}`).emit('new_delivery_request', {
        ...deliveryRequestPayload(d),
        distanceToPickup: Math.round(dist * 10) / 10,
      });
      deliveryCount++;
    }
  }

  return { rides: rideCount, deliveries: deliveryCount };
}
