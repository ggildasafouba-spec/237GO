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
