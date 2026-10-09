import axios from 'axios';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface PushPayload {
  userId: string;
  title: string;
  body: string;
  type: string;          // ex: 'ride', 'delivery', 'payment', 'driver'
  data?: Record<string, unknown>;
}

/**
 * Envoie une notification push à un utilisateur ET l'enregistre en base
 * (modèle Notification) pour l'historique in-app.
 * L'envoi push est best-effort : si le token manque ou l'API échoue,
 * la notification reste visible dans l'app.
 */
export async function sendPushNotification(payload: PushPayload): Promise<void> {
  const { userId, title, body, type, data } = payload;

  // 1. Persister la notification (historique in-app)
  await prisma.notification
    .create({
      data: {
        userId,
        title,
        body,
        type,
        data: (data as object) || undefined,
      },
    })
    .catch((e) => console.error('Notification persist error:', e.message));

  // 2. Envoyer le push via Expo (si l'utilisateur a un token)
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { pushToken: true },
    });

    if (!user?.pushToken) return; // pas de token → push ignoré

    // Vérifier que c'est bien un token Expo valide
    if (!user.pushToken.startsWith('ExponentPushToken') && !user.pushToken.startsWith('ExpoPushToken')) {
      return;
    }

    await axios.post(
      EXPO_PUSH_URL,
      {
        to: user.pushToken,
        title,
        body,
        sound: 'default',
        data: { type, ...data },
        priority: 'high',
      },
      {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
  } catch (error: any) {
    console.error('Push send error (non bloquant):', error.message);
  }
}

/**
 * Envoie un push à plusieurs utilisateurs.
 */
export async function sendBulkPush(userIds: string[], base: Omit<PushPayload, 'userId'>): Promise<void> {
  await Promise.allSettled(userIds.map((userId) => sendPushNotification({ userId, ...base })));
}
