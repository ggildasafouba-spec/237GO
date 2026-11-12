/**
 * SESSIONS (jetons de connexion)
 *
 * Chaque jeton porte la « version de session » du compte (champ tv).
 * Augmenter User.tokenVersion rend IMMÉDIATEMENT invalides tous les jetons déjà émis :
 * changement de mot de passe, « Déconnecter tous mes appareils », action de l'admin.
 *
 * Avant : un jeton restait valable 7 jours quoi qu'il arrive. Un pirate qui avait volé un
 * mot de passe restait connecté même après que la victime l'ait changé.
 *
 * Compatibilité : les jetons émis avant ce changement n'ont pas de « tv » ; ils comptent
 * comme version 0 et restent valides tant que le compte n'a pas été « révoqué ».
 */
import jwt from 'jsonwebtoken';
import type { Server } from 'socket.io';
import { prisma } from './prisma';
import { JWT_KEY, JWT_SIGN_OPTIONS } from './jwtSecret';
import { invalidateUserCache } from '../middleware/auth.middleware';

export const TOKEN_TTL = '7d';

export function signUserToken(user: { id: string; tokenVersion?: number | null }): string {
  return jwt.sign({ userId: user.id, tv: user.tokenVersion ?? 0 }, JWT_KEY, {
    ...JWT_SIGN_OPTIONS,
    expiresIn: TOKEN_TTL,
  } as jwt.SignOptions);
}

/** Version portée par un jeton (0 pour les anciens jetons sans version). */
export function tokenVersionOf(decoded: { tv?: unknown }): number {
  return typeof decoded.tv === 'number' ? decoded.tv : 0;
}

/**
 * Déconnecte TOUS les appareils d'un compte : invalide les jetons, vide le cache
 * d'authentification et coupe les connexions temps réel ouvertes.
 * Renvoie la nouvelle version (pour émettre un nouveau jeton à l'appareil courant).
 */
export async function revokeAllSessions(userId: string, io?: Server | null): Promise<number> {
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
    select: { tokenVersion: true },
  });
  invalidateUserCache(userId);
  try {
    io?.in(`user:${userId}`).disconnectSockets(true);
  } catch {
    /* pas de connexion ouverte */
  }
  return updated.tokenVersion;
}
