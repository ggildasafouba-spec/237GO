import axios from 'axios';

// Service d'envoi d'emails via Resend (API REST, pas de dépendance npm supplémentaire).
// Best-effort : si aucune clé n'est configurée, on ne bloque rien (log + retour false).

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
// Adresse d'expéditeur vérifiée sur Resend (ex: "237GO <no-reply@237go.app>").
const MAIL_FROM = process.env.MAIL_FROM || '237GO <onboarding@resend.dev>';

export function isMailConfigured(): boolean {
  return !!RESEND_API_KEY;
}

interface SendMailInput {
  to: string;
  subject: string;
  html: string;
}

/**
 * Envoie un email transactionnel. Renvoie true si envoyé, false sinon (sans lever d'erreur).
 */
export async function sendMail({ to, subject, html }: SendMailInput): Promise<boolean> {
  // TESTS LOCAUX UNIQUEMENT : les emails sont écrits dans un fichier au lieu d'être envoyés.
  // Cette variable n'existe jamais sur Railway.
  if (process.env.MAIL_CAPTURE_FILE) {
    try {
      require('fs').appendFileSync(process.env.MAIL_CAPTURE_FILE, JSON.stringify({ to, subject, html }) + '\n');
      return true;
    } catch {
      return false;
    }
  }
  if (!RESEND_API_KEY) {
    console.warn('sendMail: RESEND_API_KEY non configurée — email ignoré');
    return false;
  }
  try {
    await axios.post(
      'https://api.resend.com/emails',
      { from: MAIL_FROM, to: [to], subject, html },
      {
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );
    return true;
  } catch (error: any) {
    console.error('sendMail error:', error?.response?.data || error.message);
    return false;
  }
}

/**
 * Email de code de réinitialisation du mot de passe.
 */
export async function sendPasswordResetEmail(to: string, code: string): Promise<boolean> {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #141A17;">
      <div style="text-align:center; margin-bottom: 20px;">
        <span style="font-size: 26px; font-weight: 900; color: #1DB954;">237<span style="color:#141A17;">GO</span></span>
      </div>
      <h2 style="font-size: 20px;">Réinitialisation de votre mot de passe</h2>
      <p>Voici votre code de réinitialisation 237GO :</p>
      <div style="font-size: 32px; font-weight: 900; letter-spacing: 6px; text-align:center; background:#F4F7F4; border-radius: 12px; padding: 18px; margin: 16px 0; color:#0E7A35;">
        ${code}
      </div>
      <p style="color:#6B7B70; font-size: 14px;">Ce code est valable <strong>10 minutes</strong>. Ne le partagez avec personne.</p>
      <p style="color:#6B7B70; font-size: 13px;">Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
      <hr style="border:none; border-top:1px solid #E2EAE4; margin: 20px 0;" />
      <p style="color:#B0BDB4; font-size: 12px; text-align:center;">237GO — On bouge ensemble 🇨🇲</p>
    </div>
  `;
  return sendMail({ to, subject: 'Votre code de réinitialisation 237GO', html });
}

function layout(title: string, body: string): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #141A17;">
      <div style="text-align:center; margin-bottom: 20px;">
        <span style="font-size: 26px; font-weight: 900; color: #1DB954;">237<span style="color:#141A17;">GO</span></span>
      </div>
      <h2 style="font-size: 20px;">${title}</h2>
      ${body}
      <hr style="border:none; border-top:1px solid #E2EAE4; margin: 20px 0;" />
      <p style="color:#B0BDB4; font-size: 12px; text-align:center;">237GO — On bouge ensemble 🇨🇲</p>
    </div>
  `;
}

/**
 * Code de connexion à l'administration (double vérification).
 */
export async function sendAdminLoginCodeEmail(to: string, code: string): Promise<boolean> {
  const html = layout(
    'Code de connexion à l\'administration',
    `
      <p>Une connexion à l'administration 237GO vient d'être demandée. Votre code :</p>
      <div style="font-size: 32px; font-weight: 900; letter-spacing: 6px; text-align:center; background:#F4F7F4; border-radius: 12px; padding: 18px; margin: 16px 0; color:#0E7A35;">
        ${code}
      </div>
      <p style="color:#6B7B70; font-size: 14px;">Valable <strong>10 minutes</strong>. Ne le communiquez à personne, même à l'équipe 237GO.</p>
      <p style="color:#D32F2F; font-size: 13px;"><strong>Ce n'est pas vous ?</strong> Quelqu'un connaît votre mot de passe administrateur : changez-le immédiatement.</p>
    `
  );
  return sendMail({ to, subject: 'Code de connexion admin 237GO', html });
}

/**
 * Alerte : le mot de passe du compte vient d'être modifié.
 */
export async function sendPasswordChangedEmail(to: string, firstName?: string | null): Promise<boolean> {
  const when = new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Douala', dateStyle: 'long', timeStyle: 'short' });
  const html = layout(
    'Votre mot de passe a été modifié',
    `
      <p>Bonjour${firstName ? ` ${firstName}` : ''},</p>
      <p>Le mot de passe de votre compte 237GO a été modifié le <strong>${when}</strong> (heure du Cameroun).
      Tous vos autres appareils ont été déconnectés.</p>
      <p style="color:#D32F2F; font-size: 14px;"><strong>Ce n'est pas vous ?</strong> Contactez immédiatement le support 237GO
      pour bloquer votre compte.</p>
    `
  );
  return sendMail({ to, subject: 'Votre mot de passe 237GO a été modifié', html });
}
