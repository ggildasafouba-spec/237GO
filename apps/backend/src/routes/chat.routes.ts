import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { body, validationResult } from 'express-validator';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { sendPushNotification } from '../services/notification.service';

const router = Router();

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
