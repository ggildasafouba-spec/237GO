import { PrismaClient } from '@prisma/client';

/**
 * Client Prisma UNIQUE et partagé par toute l'application.
 *
 * Pourquoi : chaque `new PrismaClient()` ouvre son propre pool de connexions
 * PostgreSQL. En multipliant les instances (une par route/service), on épuise
 * très vite le nombre maximum de connexions autorisé par la base (erreurs
 * "too many connections" / "connection pool timeout") sous charge.
 *
 * En n'ayant qu'une seule instance, le pool est maîtrisé et l'application tient
 * beaucoup plus d'utilisateurs simultanés.
 *
 * Le `globalThis` évite de recréer un client à chaque rechargement à chaud
 * (hot-reload) en développement.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
