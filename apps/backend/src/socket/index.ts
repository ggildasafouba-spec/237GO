import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { JWT_KEY, JWT_VERIFY_OPTIONS } from '../lib/jwtSecret';
import { sendPendingRequestsToDriver } from '../services/matching.service';
import { sendSOSAlert, sendTripShareLink } from '../services/sms.service';

interface AuthSocket extends Socket {
  userId?: string;
  userRole?: string;
}

export function setupSocketHandlers(io: Server) {
  // Middleware d'authentification Socket.IO
  io.use(async (socket: AuthSocket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
      if (!token) {
        return next(new Error('Token requis'));
      }

      const decoded = jwt.verify(token, JWT_KEY, JWT_VERIFY_OPTIONS) as { userId: string };
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: { id: true, role: true },
      });

      if (!user) {
        return next(new Error('Utilisateur non trouvé'));
      }

      socket.userId = user.id;
      socket.userRole = user.role;
      next();
    } catch {
      next(new Error('Token invalide'));
    }
  });

  io.on('connection', (socket: AuthSocket) => {
    console.log(`✅ Connecté: ${socket.userId} (${socket.userRole})`);

    // Rejoindre la room personnelle
    socket.join(`user:${socket.userId}`);

    // Les admins rejoignent la room 'admins' (alertes SOS, litiges escrow)
    if (socket.userRole === 'ADMIN') {
      socket.join('admins');
    }

    // === CHAUFFEUR ===
    // État propre à CE chauffeur connecté (une connexion = un chauffeur)
    const LOCATION_PERSIST_INTERVAL_MS = 30_000;
    let lastPersistedAt = 0;
    let lastLocation: { lat: number; lng: number } | null = null;
    // rideId -> passengerId (null = course invalide pour ce chauffeur)
    const rideCache = new Map<string, string | null>();

    // Les événements chauffeur sont TOUJOURS écoutés, et le droit est vérifié en base à la
    // mise en ligne. Avant, ils n'étaient écoutés que si le rôle valait DRIVER au moment de
    // la connexion : un chauffeur approuvé APRÈS s'être connecté voyait sa mise en ligne
    // ignorée sans aucun message, et ne recevait jamais de course.
    {
      // Le chauffeur se met en ligne
      socket.on('driver:online', async (data: { vehicleType?: string; lat: number; lng: number }) => {
        try {
          const lat = Number(data?.lat);
          const lng = Number(data?.lng);
          if (!isFinite(lat) || !isFinite(lng)) {
            socket.emit('driver:online_error', { message: 'Position GPS invalide. Activez la localisation.' });
            return;
          }

          // Rôle et validation relus en base (et non figés à la connexion)
          const user = await prisma.user.findUnique({
            where: { id: socket.userId },
            select: { role: true, isActive: true, driverProfile: { select: { verificationStatus: true, vehicleType: true } } },
          });
          const profile = user?.driverProfile;
          if (!user?.isActive || !profile || profile.verificationStatus !== 'VERIFIED') {
            socket.emit('driver:online_error', {
              message: profile?.verificationStatus === 'PENDING'
                ? 'Votre dossier chauffeur est en cours de vérification. Vous pourrez vous mettre en ligne après validation.'
                : 'Votre compte chauffeur n\'est pas validé.',
            });
            return;
          }
          socket.userRole = 'DRIVER';

          // Le type de véhicule vient du profil (source de vérité), pas de l'app
          const vehicleType = profile.vehicleType;
          socket.join(`drivers:${vehicleType}`);
          socket.join('drivers:delivery');

          await prisma.driverProfile.update({
            where: { userId: socket.userId },
            data: { isOnline: true, currentLat: lat, currentLng: lng },
          });
          lastLocation = { lat, lng };
          lastPersistedAt = Date.now();

          // Rattrapage : les clients qui attendaient déjà
          const pending = await sendPendingRequestsToDriver({
            io, driverUserId: socket.userId!, vehicleType, lat, lng,
          });
          socket.emit('driver:online_ok', { vehicleType, ...pending });

          console.log(`🚗 Chauffeur en ligne: ${socket.userId} (${vehicleType}) — ${pending.rides} course(s) et ${pending.deliveries} livraison(s) en attente envoyée(s)`);
        } catch (error) {
          console.error('driver:online échoué:', (error as Error).message);
          socket.emit('driver:online_error', { message: 'Mise en ligne impossible, réessayez.' });
        }
      });

      // Mise à jour de position du chauffeur.
      // Avant : 1 écriture + 1 lecture en base à CHAQUE position (toutes les ~5 s par chauffeur),
      // soit environ 20 écritures/s avec 100 chauffeurs en ligne.
      // Maintenant :
      //  - la position est relayée au passager EN TEMPS RÉEL, sans toucher la base ;
      //  - le passager de la course est mis en cache (1 lecture par course, pas par position) ;
      //  - la base n'est mise à jour qu'au plus toutes les 30 s par chauffeur
      //    (suffisant pour trouver les chauffeurs proches lors d'une nouvelle demande).
      socket.on('driver:location', async (data: { lat: number; lng: number; rideId?: string }) => {
        // Réservé aux chauffeurs (rôle lu à la connexion OU confirmé par une mise en ligne)
        if (socket.userRole !== 'DRIVER') return;
        const { lat, lng, rideId } = data || ({} as any);
        if (typeof lat !== 'number' || typeof lng !== 'number' || !isFinite(lat) || !isFinite(lng)) {
          return;
        }

        try {
          // 1) Relais temps réel au passager (le passager est vérifié une fois puis mis en cache)
          if (rideId) {
            let passengerId = rideCache.get(rideId);
            if (passengerId === undefined) {
              const ride = await prisma.ride.findUnique({
                where: { id: rideId },
                select: { passengerId: true, driverId: true },
              });
              // On ne relaie QUE si ce chauffeur est bien celui de la course
              passengerId = ride && ride.driverId === socket.userId ? ride.passengerId : null;
              rideCache.set(rideId, passengerId);
            }
            if (passengerId) {
              io.to(`user:${passengerId}`).emit('driver:location_update', { rideId, lat, lng });
            }
          }

          // 2) Écriture en base limitée (au plus toutes les 30 s par chauffeur)
          const now = Date.now();
          if (now - lastPersistedAt >= LOCATION_PERSIST_INTERVAL_MS) {
            lastPersistedAt = now;
            // isOnline: true = auto-réparation. Un chauffeur qui envoie sa position est en ligne,
            // même si une coupure réseau l'avait fait passer hors ligne côté serveur.
            await prisma.driverProfile.update({
              where: { userId: socket.userId },
              data: { currentLat: lat, currentLng: lng, isOnline: true },
            });
          }
          lastLocation = { lat, lng };
        } catch {
          // Une position perdue n'est pas grave : la suivante arrive dans quelques secondes.
        }
      });

      // Chauffeur hors ligne
      socket.on('driver:offline', async () => {
        if (socket.userRole !== 'DRIVER') return;
        // updateMany : pas d'erreur (et pas de crash) si le profil n'existe pas
        await prisma.driverProfile.updateMany({
          where: { userId: socket.userId },
          data: { isOnline: false },
        }).catch(() => {});
        console.log(`🔴 Chauffeur hors ligne: ${socket.userId}`);
      });
    }

    // === MARCHAND ===
    if (socket.userRole === 'MERCHANT') {
      socket.join(`merchant:${socket.userId}`);
    }

    // === SOS / URGENCE ===
    socket.on('sos', async (data: { lat: number; lng: number; rideId?: string }) => {
      console.log(`🚨 SOS de ${socket.userId} à (${data.lat}, ${data.lng})`);

      try {
        // Récupérer l'utilisateur et ses contacts d'urgence
        const [user, contacts] = await Promise.all([
          prisma.user.findUnique({
            where: { id: socket.userId! },
            select: { firstName: true, lastName: true },
          }),
          prisma.emergencyContact.findMany({ where: { userId: socket.userId! } }),
        ]);

        const userName = user ? `${user.firstName} ${user.lastName}` : 'Un utilisateur';

        // Persister l'alerte pour qu'un admin non connecté au moment du SOS
        // puisse la retrouver (tableau de bord).
        const alert = await prisma.sosAlert.create({
          data: {
            userId: socket.userId!,
            lat: data.lat,
            lng: data.lng,
            rideId: data.rideId || null,
          },
        });

        // Notifier les admins en temps réel
        io.to('admins').emit('sos_alert', {
          id: alert.id,
          userId: socket.userId,
          userName,
          lat: data.lat,
          lng: data.lng,
          rideId: data.rideId,
          timestamp: alert.createdAt.toISOString(),
        });

        // Envoyer un SMS d'alerte aux contacts d'urgence
        if (contacts.length > 0) {
          await sendSOSAlert({
            contacts: contacts.map((c) => ({ name: c.name, phone: c.phone })),
            userName,
            lat: data.lat,
            lng: data.lng,
            rideId: data.rideId,
          });
        }

        // Confirmer à l'émetteur
        socket.emit('sos_sent', { contactsNotified: contacts.length });
      } catch (error) {
        console.error('Erreur SOS:', error);
        socket.emit('sos_error', { message: 'Échec de l\'envoi de l\'alerte SOS' });
      }
    });

    // === PARTAGE DE TRAJET ===
    socket.on('share:trip', async (data: { rideId: string; contactPhone: string }) => {
      try {
        const user = await prisma.user.findUnique({
          where: { id: socket.userId! },
          select: { firstName: true, lastName: true },
        });
        const passengerName = user ? `${user.firstName} ${user.lastName}` : 'Un passager';

        // Construire le lien de suivi
        const baseUrl = process.env.APP_BASE_URL || process.env.API_BASE_URL || 'https://237go.app';
        const trackingUrl = `${baseUrl}/track/${data.rideId}`;

        const result = await sendTripShareLink({
          contactPhone: data.contactPhone,
          passengerName,
          rideId: data.rideId,
          trackingUrl,
        });

        socket.emit('share:trip_result', { success: result.success });
        console.log(`📤 Partage de trajet ${data.rideId} avec ${data.contactPhone} : ${result.success ? 'OK' : 'échec'}`);
      } catch (error) {
        console.error('Erreur partage trajet:', error);
        socket.emit('share:trip_result', { success: false });
      }
    });

    // === DÉCONNEXION ===
    socket.on('disconnect', async () => {
      if (socket.userRole === 'DRIVER') {
        // On enregistre la dernière position connue (qui n'a peut-être pas encore été écrite)
        await prisma.driverProfile.update({
          where: { userId: socket.userId },
          data: {
            isOnline: false,
            ...(lastLocation ? { currentLat: lastLocation.lat, currentLng: lastLocation.lng } : {}),
          },
        }).catch(() => {}); // Ignorer si profil pas trouvé
        rideCache.clear();
      }
      console.log(`❌ Déconnecté: ${socket.userId}`);
    });
  });
}
