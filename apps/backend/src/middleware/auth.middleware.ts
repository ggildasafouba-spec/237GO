import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { JWT_KEY, JWT_VERIFY_OPTIONS } from '../lib/jwtSecret';
import { AppError } from './error.middleware';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    phone: string;
    role: string;
  };
}

/**
 * CACHE UTILISATEUR (en mémoire)
 *
 * Avant : chaque requête authentifiée faisait une requête SQL pour retrouver l'utilisateur.
 * Avec un pool de connexions limité, cela devenait le goulot d'étranglement sous charge.
 * Maintenant : on garde l'utilisateur quelques secondes en mémoire.
 *
 * Sécurité / cohérence :
 *  - TTL court (15 s) : un compte désactivé ou un rôle modifié est pris en compte vite.
 *  - invalidateUserCache() est appelé par l'admin quand il désactive un compte ou change un rôle,
 *    l'effet est alors IMMÉDIAT.
 *  - On ne met en cache QUE les utilisateurs actifs : un compte désactivé est toujours revérifié en base.
 *  - Taille bornée (les plus anciennes entrées sont supprimées).
 *
 * Limite connue : ce cache est propre à chaque instance du serveur. Avec plusieurs instances
 * il faudra le remplacer par Redis (l'invalidation ne se propagerait pas entre instances).
 */
interface CachedUser {
  id: string;
  phone: string;
  role: string;
  expiresAt: number;
}

const USER_CACHE_TTL_MS = Number(process.env.AUTH_CACHE_TTL_MS || 15_000);
const USER_CACHE_MAX = 5000;
const userCache = new Map<string, CachedUser>();

export function invalidateUserCache(userId: string): void {
  userCache.delete(userId);
}

function cacheUser(user: { id: string; phone: string; role: string }): void {
  // delete puis set : place l'entrée en dernier (ordre d'insertion = ancienneté)
  userCache.delete(user.id);
  userCache.set(user.id, { ...user, expiresAt: Date.now() + USER_CACHE_TTL_MS });
  if (userCache.size > USER_CACHE_MAX) {
    const oldest = userCache.keys().next().value;
    if (oldest) userCache.delete(oldest);
  }
}

export const authenticate = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('Token d\'authentification requis', 401);
    }

    const token = authHeader.split(' ')[1];

    // Le limiteur de requêtes a souvent déjà vérifié ce jeton : on réutilise le résultat.
    const preVerified = (req as any).jwtVerified as { token: string; userId: string } | undefined;
    const decoded =
      preVerified && preVerified.token === token
        ? { userId: preVerified.userId }
        : (jwt.verify(token, JWT_KEY, JWT_VERIFY_OPTIONS) as { userId: string });

    // 1) Cache : évite une requête SQL pour les utilisateurs actifs récemment vus
    const cached = userCache.get(decoded.userId);
    if (cached && cached.expiresAt > Date.now()) {
      req.user = { id: cached.id, phone: cached.phone, role: cached.role };
      return next();
    }

    // 2) Sinon, lecture en base
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, phone: true, role: true, isActive: true },
    });

    if (!user || !user.isActive) {
      userCache.delete(decoded.userId);
      throw new AppError('Utilisateur non trouvé ou désactivé', 401);
    }

    cacheUser({ id: user.id, phone: user.phone, role: user.role });
    req.user = { id: user.id, phone: user.phone, role: user.role };
    next();
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('Token invalide ou expiré', 401));
    }
  }
};

export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError('Accès non autorisé', 403));
    }
    next();
  };
};
