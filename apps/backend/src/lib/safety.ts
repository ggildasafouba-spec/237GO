/**
 * Sécurité des trajets : alerte SOS et lien public de suivi de course.
 *
 * Le SMS n'est pas encore branché (pas de compte Africa's Talking) : le serveur ne prétend
 * donc plus avoir prévenu les contacts. Il renvoie à l'app un message prêt à envoyer
 * (WhatsApp, SMS…) via le menu de partage du téléphone, et prévient l'équipe 237GO
 * (tableau de bord admin en temps réel + email + notification).
 */
import { createHmac, timingSafeEqual } from 'crypto';
import type { Server } from 'socket.io';
import { prisma } from './prisma';
import { JWT_SECRET } from './jwtSecret';
import { isSmsConfigured, sendSOSAlert } from '../services/sms.service';
import { sendMail } from '../services/mail.service';
import { sendPushNotification } from '../services/notification.service';

// ========== LIEN DE SUIVI (jeton signé, sans base de données) ==========

const SHARE_TTL_SECONDS = 12 * 60 * 60; // 12 h
const ACTIVE_RIDE_STATUSES = ['PENDING', 'ACCEPTED', 'DRIVER_ARRIVING', 'IN_PROGRESS'];

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const sign = (payload: string) =>
  createHmac('sha256', `trip-share:${JWT_SECRET}`).update(payload).digest('base64url').slice(0, 32);

const publicBase = () =>
  (process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3002}`).trim().replace(/\/+$/, '');

/** Jeton opaque : l'identifiant de la course n'est lisible qu'avec la signature valide. */
export function createShareToken(rideId: string, now = Date.now()): string {
  const payload = b64url(`${rideId}.${Math.floor(now / 1000) + SHARE_TTL_SECONDS}`);
  return `${payload}.${sign(payload)}`;
}

/** Renvoie l'identifiant de course si le jeton est authentique et non expiré, sinon null. */
export function verifyShareToken(token: string, now = Date.now()): string | null {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [rideId, exp] = Buffer.from(payload, 'base64url').toString('utf8').split('.');
  if (!rideId || !Number(exp) || Number(exp) * 1000 < now) return null;
  return rideId;
}

export const trackUrl = (token: string) => `${publicBase()}/track/${token}`;

/** Lien de suivi d'une course : réservé au passager et au chauffeur de la course en cours. */
export async function createTripShare(rideId: string, userId: string) {
  const ride = await prisma.ride.findUnique({
    where: { id: rideId },
    select: { id: true, passengerId: true, driverId: true, status: true, passenger: { select: { firstName: true, lastName: true } } },
  });
  if (!ride || (ride.passengerId !== userId && ride.driverId !== userId)) {
    return { error: 'Course introuvable', status: 404 as const };
  }
  if (!ACTIVE_RIDE_STATUSES.includes(ride.status)) {
    return { error: 'Cette course est terminée : il n\'y a plus de trajet à suivre.', status: 409 as const };
  }
  const url = trackUrl(createShareToken(ride.id));
  const name = `${ride.passenger.firstName} ${ride.passenger.lastName}`.trim();
  const message = `${name} partage sa course 237GO avec vous. Suivez le trajet en direct : ${url}`;
  return { url, message };
}

/** Données PUBLIQUES visibles par la personne qui reçoit le lien (aucun téléphone). */
export async function publicTrip(token: string) {
  const rideId = verifyShareToken(token);
  if (!rideId) return null;
  const ride = await prisma.ride.findUnique({
    where: { id: rideId },
    select: {
      status: true, vehicleType: true, pickupAddress: true, dropoffAddress: true,
      pickupLat: true, pickupLng: true, dropoffLat: true, dropoffLng: true,
      startedAt: true, completedAt: true, cancelledAt: true, updatedAt: true,
      passenger: { select: { firstName: true } },
      driver: {
        select: {
          firstName: true, lastName: true,
          driverProfile: {
            select: { vehicleBrand: true, vehicleModel: true, vehiclePlate: true, currentLat: true, currentLng: true, updatedAt: true },
          },
        },
      },
    },
  });
  if (!ride) return null;
  const active = ACTIVE_RIDE_STATUSES.includes(ride.status);
  const p = ride.driver?.driverProfile;
  return {
    status: ride.status,
    active,
    vehicleType: ride.vehicleType,
    passengerFirstName: ride.passenger.firstName,
    pickup: { address: ride.pickupAddress, lat: ride.pickupLat, lng: ride.pickupLng },
    dropoff: { address: ride.dropoffAddress, lat: ride.dropoffLat, lng: ride.dropoffLng },
    startedAt: ride.startedAt,
    completedAt: ride.completedAt,
    cancelledAt: ride.cancelledAt,
    driver: ride.driver
      ? {
          name: `${ride.driver.firstName} ${(ride.driver.lastName || '').charAt(0)}.`.trim(),
          vehicle: [p?.vehicleBrand, p?.vehicleModel].filter(Boolean).join(' ') || null,
          plate: p?.vehiclePlate || null,
        }
      : null,
    // Position du chauffeur seulement pendant la course (mise à jour toutes les ~30 s)
    driverPosition:
      active && p?.currentLat != null && p?.currentLng != null
        ? { lat: p.currentLat, lng: p.currentLng, updatedAt: p.updatedAt }
        : null,
  };
}

// ========== SOS ==========

const SOS_DEDUP_MS = 2 * 60 * 1000; // un 2e appui dans les 2 min met à jour la même alerte

export const SOS_SERVICE_LABELS: Record<string, string> = {
  RIDE: 'Course',
  DELIVERY: 'Livraison',
  CARPOOL: 'Covoiturage',
  RENTAL: 'Location',
};

/**
 * Le service n'est rattaché à l'alerte que si l'utilisateur y participe vraiment
 * (sinon on pourrait attirer l'équipe 237GO sur le service de quelqu'un d'autre).
 *  - RIDE : passager ou chauffeur de la course ;
 *  - DELIVERY : client ou livreur ;
 *  - CARPOOL : passager de la réservation, ou conducteur (réservation ou trajet) ;
 *  - RENTAL : locataire ou propriétaire du véhicule de la réservation.
 */
async function verifiedService(userId: string, type: string, id: string): Promise<boolean> {
  switch (type) {
    case 'RIDE': {
      const r = await prisma.ride.findUnique({ where: { id }, select: { passengerId: true, driverId: true } });
      return !!r && (r.passengerId === userId || r.driverId === userId);
    }
    case 'DELIVERY': {
      const d = await prisma.delivery.findUnique({ where: { id }, select: { senderId: true, driverId: true } });
      return !!d && (d.senderId === userId || d.driverId === userId);
    }
    case 'CARPOOL': {
      const b = await prisma.carpoolBooking.findUnique({ where: { id }, select: { passengerId: true, carpool: { select: { driverId: true } } } });
      if (b) return b.passengerId === userId || b.carpool.driverId === userId;
      const c = await prisma.carpool.findUnique({ where: { id }, select: { driverId: true } });
      return !!c && c.driverId === userId;
    }
    case 'RENTAL': {
      const b = await prisma.rentalBooking.findUnique({ where: { id }, select: { renterId: true, vehicle: { select: { ownerId: true } } } });
      return !!b && (b.renterId === userId || b.vehicle.ownerId === userId);
    }
    default:
      return false;
  }
}

export async function triggerSos(
  io: Server | undefined,
  userId: string,
  input: { lat?: unknown; lng?: unknown; rideId?: unknown; serviceType?: unknown; serviceId?: unknown }
) {
  const lat = Number(input?.lat);
  const lng = Number(input?.lng);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { error: 'Position GPS invalide', status: 400 as const };
  }

  // Service concerné (les anciennes versions de l'app n'envoient que rideId)
  let serviceType = typeof input?.serviceType === 'string' ? input.serviceType.toUpperCase() : null;
  let serviceId = typeof input?.serviceId === 'string' && input.serviceId ? input.serviceId : null;
  if (!serviceType && typeof input?.rideId === 'string' && input.rideId) {
    serviceType = 'RIDE';
    serviceId = input.rideId;
  }
  if (!serviceType || !serviceId || !SOS_SERVICE_LABELS[serviceType] || !(await verifiedService(userId, serviceType, serviceId))) {
    serviceType = null;
    serviceId = null;
  }
  const rideId = serviceType === 'RIDE' ? serviceId : null;

  const [user, contacts] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true, phone: true } }),
    prisma.emergencyContact.findMany({ where: { userId }, select: { name: true, phone: true } }),
  ]);
  const userName = user ? `${user.firstName} ${user.lastName}`.trim() : 'Un utilisateur';

  const recent = await prisma.sosAlert.findFirst({
    where: { userId, status: 'ACTIVE', createdAt: { gte: new Date(Date.now() - SOS_DEDUP_MS) } },
    orderBy: { createdAt: 'desc' },
  });
  const alert = recent
    ? await prisma.sosAlert.update({
        where: { id: recent.id },
        data: {
          lat, lng,
          rideId: rideId ?? recent.rideId,
          serviceType: serviceType ?? recent.serviceType,
          serviceId: serviceId ?? recent.serviceId,
        },
      })
    : await prisma.sosAlert.create({ data: { userId, lat, lng, rideId, serviceType, serviceId } });
  const serviceLine = alert.serviceType && alert.serviceId
    ? `${SOS_SERVICE_LABELS[alert.serviceType] || alert.serviceType} #${alert.serviceId.slice(0, 8)}`
    : null;

  const mapLink = `https://maps.google.com/?q=${lat},${lng}`;
  const share = alert.rideId ? await createTripShare(alert.rideId, userId) : null;
  const followLink = share && 'url' in share ? share.url : null;

  // Tableau de bord admin en temps réel (à chaque appui : la position est actualisée)
  io?.to('admins').emit('sos_alert', {
    id: alert.id, userId, userName, lat, lng, rideId: alert.rideId,
    serviceType: alert.serviceType, serviceId: alert.serviceId, timestamp: alert.createdAt.toISOString(),
  });

  let smsSent = 0;
  if (!recent) {
    // Équipe 237GO : email + notification (best-effort, n'empêche jamais l'alerte)
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true, email: true } });
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:520px;color:#141A17">
        <h2 style="color:#C62828">🚨 Alerte SOS</h2>
        <p><b>${escapeHtml(userName)}</b> (${escapeHtml(user?.phone || '')}) a déclenché une alerte SOS.</p>
        <p>Position : <a href="${mapLink}">${lat.toFixed(5)}, ${lng.toFixed(5)}</a></p>
        ${serviceLine ? `<p>${escapeHtml(serviceLine)}${followLink ? ` — <a href="${followLink}">suivre en direct</a>` : ''}</p>` : ''}
        <p>Contacts d'urgence enregistrés : ${contacts.length}</p>
        <p>Rappelez la personne immédiatement, puis marquez l'alerte comme traitée dans l'administration.</p>
      </div>`;
    await Promise.allSettled([
      ...admins.filter((a) => a.email).map((a) => sendMail({ to: a.email!, subject: `🚨 SOS — ${userName}`, html })),
      ...admins.map((a) =>
        sendPushNotification({
          userId: a.id, title: '🚨 Alerte SOS', body: `${userName} a déclenché une alerte SOS`, type: 'sos', data: { alertId: alert.id },
        })
      ),
    ]);

    if (contacts.length > 0 && isSmsConfigured()) {
      await sendSOSAlert({ contacts, userName, lat, lng, rideId: alert.rideId || undefined });
      smsSent = contacts.length;
    }
  }

  const message =
    `🚨 URGENCE : ${userName} a déclenché une alerte SOS sur 237GO. ` +
    `Position : ${mapLink}` +
    (followLink ? ` — Suivi de la course : ${followLink}` : '') +
    `. Appelez-le immédiatement.`;

  return {
    alertId: alert.id,
    repeated: !!recent,
    contactsCount: contacts.length,
    smsSent,
    // Message prêt à envoyer par WhatsApp/SMS depuis le téléphone (le SMS automatique n'est pas actif)
    shareMessage: message,
    contacts,
  };
}

export function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
