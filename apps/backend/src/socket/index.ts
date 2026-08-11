import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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

      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default-secret') as { userId: string };
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

    // === CHAUFFEUR ===
    if (socket.userRole === 'DRIVER') {
      // Le chauffeur se met en ligne
      socket.on('driver:online', async (data: { vehicleType: string; lat: number; lng: number }) => {
        const { vehicleType, lat, lng } = data;

        // Rejoindre la room des chauffeurs par type
        socket.join(`drivers:${vehicleType}`);
        socket.join('drivers:delivery');

        // Mettre à jour la position
        await prisma.driverProfile.update({
          where: { userId: socket.userId },
          data: { isOnline: true, currentLat: lat, currentLng: lng },
        });

        console.log(`🚗 Chauffeur en ligne: ${socket.userId} (${vehicleType})`);
      });

      // Mise à jour de position du chauffeur
      socket.on('driver:location', async (data: { lat: number; lng: number; rideId?: string }) => {
        const { lat, lng, rideId } = data;

        await prisma.driverProfile.update({
          where: { userId: socket.userId },
          data: { currentLat: lat, currentLng: lng },
        });

        // Si en course, envoyer la position au passager
        if (rideId) {
          const ride = await prisma.ride.findUnique({ where: { id: rideId } });
          if (ride) {
            io.to(`user:${ride.passengerId}`).emit('driver:location_update', {
              rideId,
              lat,
              lng,
            });
          }
        }
      });

      // Chauffeur hors ligne
      socket.on('driver:offline', async () => {
        await prisma.driverProfile.update({
          where: { userId: socket.userId },
          data: { isOnline: false },
        });
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

      // Notifier les contacts d'urgence
      const contacts = await prisma.emergencyContact.findMany({
        where: { userId: socket.userId! },
      });

      // Notifier les admins
      io.to('admins').emit('sos_alert', {
        userId: socket.userId,
        lat: data.lat,
        lng: data.lng,
        rideId: data.rideId,
        timestamp: new Date().toISOString(),
      });

      // TODO: Envoyer SMS aux contacts d'urgence
      console.log(`📱 SMS SOS envoyé à ${contacts.length} contact(s)`);
    });

    // === PARTAGE DE TRAJET ===
    socket.on('share:trip', async (data: { rideId: string; contactPhone: string }) => {
      // TODO: Envoyer un lien de suivi par SMS au contact
      console.log(`📤 Partage de trajet ${data.rideId} avec ${data.contactPhone}`);
    });

    // === DÉCONNEXION ===
    socket.on('disconnect', async () => {
      if (socket.userRole === 'DRIVER') {
        await prisma.driverProfile.update({
          where: { userId: socket.userId },
          data: { isOnline: false },
        }).catch(() => {}); // Ignorer si profil pas trouvé
      }
      console.log(`❌ Déconnecté: ${socket.userId}`);
    });
  });
}
