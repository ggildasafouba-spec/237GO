/**
 * Outils de sécurité partagés : codes à usage unique, règles de mot de passe,
 * clés dérivées (signature des liens de documents, double vérification admin).
 */
import { createHmac, createSecretKey, randomInt, timingSafeEqual } from 'crypto';
import { JWT_SECRET } from './jwtSecret';

// ===== Clés dérivées =====
// Chaque usage a SA clé : un jeton de double vérification ne peut jamais servir de jeton de
// connexion, et une signature de lien de document ne peut pas être réutilisée ailleurs.
const derive = (purpose: string) => createHmac('sha256', JWT_SECRET).update(`237go:${purpose}`).digest();
export const ADMIN_2FA_KEY = createSecretKey(derive('admin-2fa'));
const OTP_KEY = derive('otp');
export const DOC_LINK_KEY = derive('private-docs');

// ===== Codes à usage unique (6 chiffres) =====
export const OTP_MAX_ATTEMPTS = 5;

export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Empreinte stockée en base (jamais le code en clair), liée au compte et à l'usage. */
export function hashOtp(userId: string, purpose: 'reset' | 'admin-2fa', code: string): string {
  return createHmac('sha256', OTP_KEY).update(`${purpose}:${userId}:${code}`).digest('hex');
}

export function otpMatches(stored: string | null | undefined, userId: string, purpose: 'reset' | 'admin-2fa', code: string): boolean {
  if (!stored || !/^\d{6}$/.test(String(code || ''))) return false;
  const a = Buffer.from(stored, 'hex');
  const b = Buffer.from(hashOtp(userId, purpose, String(code)), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// ===== Règles de mot de passe =====
export const PASSWORD_MIN_LENGTH = 8;

const COMMON_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', '12341234', '11223344',
  'password', 'password1', 'motdepasse', 'azertyui', 'azerty123', 'qwertyui', 'qwerty123', 'abcd1234',
  'cameroun', 'cameroun1', 'cameroun237', 'camerounais', '237237237', '23712345', 'yaounde1', 'douala237',
  'iloveyou', 'bonjour1', 'soleil123', 'jesus123', 'dieu1234', 'motdepasse1', '237go237', '237gopass',
]);

/** Renvoie un message d'erreur, ou null si le mot de passe est acceptable. */
export function passwordProblem(password: unknown, phone?: string | null): string | null {
  const p = String(password ?? '');
  if (p.length < PASSWORD_MIN_LENGTH) return `Mot de passe trop court : ${PASSWORD_MIN_LENGTH} caractères minimum`;
  if (p.length > 128) return 'Mot de passe trop long (128 caractères maximum)';
  const lower = p.toLowerCase();
  if (COMMON_PASSWORDS.has(lower) || /^(.)\1+$/.test(p)) {
    return 'Ce mot de passe est trop courant. Choisissez-en un autre.';
  }
  // Le numéro de téléphone (avec ou sans indicatif) est le premier essai d'un pirate
  const digits = (phone || '').replace(/\D/g, '');
  const local = digits.slice(-9);
  if (local.length >= 8 && [local, digits, `237${local}`, `+${digits}`, `+237${local}`].includes(p)) {
    return 'N\'utilisez pas votre numéro de téléphone comme mot de passe.';
  }
  return null;
}

// ===== Affichage =====
export function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  if (!domain) return '***';
  const visible = name.slice(0, Math.min(2, name.length));
  return `${visible}${'*'.repeat(Math.min(6, Math.max(3, name.length - visible.length)))}@${domain}`;
}

// Numéro WhatsApp du support (modifiable sur Railway sans toucher au code)
export const SUPPORT_WHATSAPP = (process.env.SUPPORT_WHATSAPP || '+33650222474').trim();
