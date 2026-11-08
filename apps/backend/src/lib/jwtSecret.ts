/**
 * Secret de signature des jetons de connexion (JWT), centralisé.
 *
 * Avant : chaque fichier faisait `process.env.JWT_SECRET || 'default-secret'`.
 * Si JWT_SECRET n'était pas défini sur l'hébergeur, le serveur utilisait silencieusement
 * 'default-secret' : n'importe qui pouvait alors fabriquer un jeton et se connecter
 * comme n'importe quel utilisateur, y compris un administrateur.
 *
 * Maintenant : en PRODUCTION, le serveur REFUSE DE DÉMARRER si le secret est absent,
 * trop court, ou s'il s'agit d'une valeur d'exemple connue. En développement local,
 * une valeur de secours est tolérée (avec un avertissement).
 */
import { createSecretKey } from 'crypto';

const KNOWN_WEAK_SECRETS = new Set([
  'default-secret',
  'change-this-in-production',
  'your-super-secret-key-change-in-production',
  '237go-super-secret-dev-key-change-in-production',
  'secret',
]);

const MIN_LENGTH = 32;

function resolveJwtSecret(): string {
  const value = (process.env.JWT_SECRET || '').trim();
  // On ne se fie pas uniquement à NODE_ENV (souvent oublié sur l'hébergeur) :
  // Railway définit automatiquement RAILWAY_ENVIRONMENT, ce qui suffit à exiger un vrai secret.
  const isProduction =
    process.env.NODE_ENV === 'production' || Boolean(process.env.RAILWAY_ENVIRONMENT);
  const isWeak = !value || value.length < MIN_LENGTH || KNOWN_WEAK_SECRETS.has(value);

  if (isWeak) {
    if (isProduction) {
      throw new Error(
        'JWT_SECRET absent ou trop faible. Définissez sur l\'hébergeur une valeur aléatoire ' +
        `d'au moins ${MIN_LENGTH} caractères (ex. : node -e "console.log(require('crypto').randomBytes(48).toString('hex'))").`
      );
    }
    console.warn('⚠️  JWT_SECRET faible ou absent : acceptable en développement seulement.');
    return value || 'dev-only-insecure-secret';
  }

  return value;
}

export const JWT_SECRET = resolveJwtSecret();

/**
 * Clé préparée UNE SEULE FOIS, à passer à jwt.sign / jwt.verify à la place du texte.
 *
 * Pourquoi : quand jsonwebtoken (v9) reçoit la clé sous forme de texte, il essaie à CHAQUE
 * appel de la lire comme une clé publique RSA (createPublicKey), échoue, puis crée la clé.
 * Le profilage sous charge a montré que cet essai raté consommait ~45 % du temps processeur
 * de l'API. Avec une KeyObject déjà prête, cet essai n'a plus lieu.
 *
 * Mêmes octets, même algorithme (HS256) : les jetons déjà émis restent valides.
 */
export const JWT_KEY = createSecretKey(Buffer.from(JWT_SECRET, 'utf8'));

// On fixe l'algorithme attendu : un jeton signé autrement est refusé.
export const JWT_VERIFY_OPTIONS = { algorithms: ['HS256'] as ['HS256'] };
export const JWT_SIGN_OPTIONS = { algorithm: 'HS256' as const };
