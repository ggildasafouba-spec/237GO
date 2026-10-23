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

/**
 * Construit l'URL de connexion en bornant la taille du pool.
 * Sans limite explicite, Prisma ouvre (num_cpus * 2 + 1) connexions, ce qui peut
 * dépasser le maximum autorisé par PostgreSQL (surtout avec plusieurs replicas).
 * On fixe une limite raisonnable, surchargeable via DB_CONNECTION_LIMIT.
 */
function buildDatabaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', process.env.DB_CONNECTION_LIMIT || '10');
    }
    if (!url.searchParams.has('pool_timeout')) {
      url.searchParams.set('pool_timeout', process.env.DB_POOL_TIMEOUT || '20');
    }
    return url.toString();
  } catch {
    // URL non parsable (ex. format inhabituel) : on laisse Prisma utiliser la valeur brute.
    return raw;
  }
}

const databaseUrl = buildDatabaseUrl();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['error'],
    ...(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : {}),
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
