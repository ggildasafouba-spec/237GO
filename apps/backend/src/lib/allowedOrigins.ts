/**
 * SITES AUTORISÉS À APPELER L'API DEPUIS UN NAVIGATEUR (CORS)
 *
 * Avant : n'importe quel site web pouvait appeler api.237go.app depuis le navigateur
 * d'un utilisateur. Maintenant : seuls les sites 237GO.
 *
 * Non concernés (aucun en-tête Origin, donc toujours acceptés) : l'application installée
 * (APK), les appels de serveur à serveur (webhooks CinetPay / NotchPay), les images.
 * Note : l'app mobile envoie parfois « Origin: https://api.237go.app » sur sa connexion
 * temps réel (WebSocket) : cette valeur est donc autorisée aussi.
 *
 * Ajout ponctuel sans redéployer le code : variable CORS_EXTRA_ORIGINS sur Railway
 * (liste séparée par des virgules, ex. « https://237go-xxx.vercel.app »).
 */
const PRODUCTION_ORIGINS = [
  'https://app.237go.app',
  'https://admin.237go.app',
  'https://www.237go.app',
  'https://237go.app',
  'https://api.237go.app',
];

const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.RAILWAY_ENVIRONMENT);

const extra = (process.env.CORS_EXTRA_ORIGINS || '')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, '').toLowerCase())
  .filter(Boolean);

const ALLOWED = new Set([...PRODUCTION_ORIGINS, ...extra]);

// En développement uniquement : le PC du développeur (Expo web, admin Vite)
const DEV_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)(:\d+)?$/;

/** Vrai si la requête peut être servie : pas d'Origin (app installée, serveur) ou site autorisé. */
export function isAllowedOrigin(origin: string | undefined | null): boolean {
  if (!origin) return true;
  const o = origin.trim().replace(/\/+$/, '').toLowerCase();
  if (ALLOWED.has(o)) return true;
  if (!isProduction && DEV_ORIGIN.test(o)) return true;
  return false;
}

export const ALLOWED_ORIGINS_LIST = [...ALLOWED];
