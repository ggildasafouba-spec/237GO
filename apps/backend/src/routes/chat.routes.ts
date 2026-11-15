import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { body, validationResult } from 'express-validator';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { sendPushNotification } from '../services/notification.service';

const router = Router();

/**
 * Le message doit concerner un vrai service qui relie les deux personnes.
 * Avant : n'importe quel compte pouvait écrire (et envoyer une notification push) à
 * n'importe quel autre compte en inventant un serviceId.
 *  - RIDE / DELIVERY : uniquement le client et le chauffeur de CETTE course / livraison ;
 *  - CARPOOL / RENTAL : l'un des deux est le conducteur du trajet / propriétaire du véhicule
 *    (un client peut poser une question avant de réserver) ;
 *  - MARKET : l'un des deux est le marchand de la boutique (ou de la commande) ;
 *  - DIRECT : réservé aux échanges avec l'équipe 237GO (un des deux est admin).
 */
async function chatAllowed(serviceType: string, serviceId: string, a: string, b: string): Promise<boolean> {
  const pair = (x?: string | null, y?: string | null) =>
    !!x && !!y && ((x === a && y === b) || (x === b && y === a));
  const oneOf = (owner?: string | null) => !!owner && (owner === a || owner === b);
  switch (serviceType) {
    case 'RIDE': {
      const r = await prisma.ride.findUnique({ where: { id: serviceId }, select: { passengerId: true, driverId: true } });
      return pair(r?.passengerId, r?.driverId);
    }
    case 'DELIVERY': {
      const d = await prisma.delivery.findUnique({ where: { id: serviceId }, select: { senderId: true, driverId: true } });
      return pair(d?.senderId, d?.driverId);
    }
    case 'CARPOOL': {
      const c = await prisma.carpool.findUnique({ where: { id: serviceId }, select: { driverId: true } });
      return oneOf(c?.driverId);
    }
    case 'RENTAL': {
      const v = await prisma.vehicle.findUnique({ where: { id: serviceId }, select: { ownerId: true } });
      return oneOf(v?.ownerId);
    }
    case 'MARKET': {
      const m = await prisma.merchantProfile.findUnique({ where: { id: serviceId }, select: { userId: true } });
      if (m) return oneOf(m.userId);
      const o = await prisma.marketOrder.findUnique({
        where: { id: serviceId },
        select: { customerId: true, merchant: { select: { userId: true } } },
      });
      return pair(o?.customerId, o?.merchant?.userId);
    }
    case 'DIRECT': {
      const admins = await prisma.user.count({ where: { id: { in: [a, b] }, role: 'ADMIN' } });
      return admins > 0;
    }
    default:
      return false;
  }
}

/**
 * Liste des conversations de l'utilisateur connecté.
 * Une conversation = un interlocuteur + un service (serviceType/serviceId).
 * On renvoie le dernier message de chaque conversation + le nombre de non-lus.
 */
router.get('/conversations', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    // Tous les messages où l'utilisateur est impliqué, récents d'abord
    const messages = await prisma.message.findMany({
      where: { OR: [{ senderId: userId }, { receiverId: userId }] },
      orderBy: { createdAt: 'desc' },
      include: {
        sender: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        receiver: { select: { id: true, firstName: true, lastName: true, avatar: true } },
      },
    });

    // Grouper par conversation (serviceType + serviceId + interlocuteur)
    const convMap = new Map<string, any>();
    for (const m of messages) {
      const other = m.senderId === userId ? m.receiver : m.sender;
      const key = `${m.serviceType}:${m.serviceId}:${other.id}`;
      if (!convMap.has(key)) {
        convMap.set(key, {
          serviceType: m.serviceType,
          serviceId: m.serviceId,
          interlocutor: other,
          lastMessage: { content: m.content, imageUrl: m.imageUrl, createdAt: m.createdAt, senderId: m.senderId },
          unreadCount: 0,
        });
      }
      // Compter les non-lus reçus
      if (m.receiverId === userId && !m.isRead) {
        convMap.get(key).unreadCount += 1;
      }
    }

    res.json({ success: true, data: Array.from(convMap.values()) });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

/**
 * Messages d'une conversation précise (serviceType/serviceId avec un interlocuteur).
 * Marque automatiquement comme lus les messages reçus.
 */
router.get('/messages', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { serviceType, serviceId, withUserId } = req.query as Record<string, string>;

    if (!serviceType || !serviceId || !withUserId) {
      return res.status(400).json({ success: false, message: 'Paramètres requis : serviceType, serviceId, withUserId' });
    }

    const messages = await prisma.message.findMany({
      where: {
        serviceType,
        serviceId,
        OR: [
          { senderId: userId, receiverId: withUserId },
          { senderId: withUserId, receiverId: userId },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });

    // Marquer comme lus les messages reçus de cet interlocuteur
    await prisma.message.updateMany({
      where: { serviceType, serviceId, senderId: withUserId, receiverId: userId, isRead: false },
      data: { isRead: true },
    });

    res.json({ success: true, data: messages });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

/**
 * Envoyer un message (texte et/ou image).
 */
router.post(
  '/messages',
  authenticate,
  [
    body('serviceType').isIn(['RIDE', 'DELIVERY', 'CARPOOL', 'RENTAL', 'MARKET', 'DIRECT']),
    body('serviceId').trim().notEmpty(),
    body('receiverId').trim().notEmpty(),
    body('content').optional().trim(),
    body('imageUrl').optional().isURL(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { serviceType, serviceId, receiverId, content, imageUrl } = req.body;
      if (!content && !imageUrl) {
        return res.status(400).json({ success: false, message: 'Message vide' });
      }
      if (receiverId === req.user!.id) {
        return res.status(400).json({ success: false, message: 'Impossible de s\'envoyer un message' });
      }
      if (typeof content === 'string' && content.length > 2000) {
        return res.status(400).json({ success: false, message: 'Message trop long (2000 caractères max)' });
      }

      const receiver = await prisma.user.findUnique({ where: { id: String(receiverId) }, select: { id: true, isActive: true } });
      if (!receiver || !receiver.isActive) {
        return res.status(404).json({ success: false, message: 'Destinataire introuvable' });
      }
      if (!(await chatAllowed(serviceType, String(serviceId), req.user!.id, receiver.id))) {
        return res.status(403).json({ success: false, message: 'Vous ne pouvez pas écrire à cette personne pour ce service' });
      }

      const message = await prisma.message.create({
        data: {
          serviceType,
          serviceId,
          senderId: req.user!.id,
          receiverId,
          content: content || null,
          imageUrl: imageUrl || null,
        },
        include: {
          sender: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        },
      });

      // Temps réel : livrer au destinataire s'il est connecté
      const io = req.app.get('io');
      io.to(`user:${receiverId}`).emit('new_message', message);

      // Notification push (best-effort)
      const senderName = `${message.sender.firstName} ${message.sender.lastName}`;
      await sendPushNotification({
        userId: receiverId,
        title: `💬 ${senderName}`,
        body: content || '📷 Photo',
        type: 'chat',
        data: { serviceType, serviceId, withUserId: req.user!.id },
      }).catch(() => {});

      res.status(201).json({ success: true, data: message });
    } catch {
      res.status(500).json({ success: false, message: 'Erreur d\'envoi' });
    }
  }
);

/**
 * Nombre total de messages non lus (pour le badge global).
 */
router.get('/unread-count', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const count = await prisma.message.count({
      where: { receiverId: req.user!.id, isRead: false },
    });
    res.json({ success: true, data: { count } });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

export { router as chatRouter };
