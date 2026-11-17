import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { body, validationResult } from 'express-validator';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { aiChat, isAiConfigured, AiMessage } from '../services/ai.service';
import rateLimit from 'express-rate-limit';

const router = Router();

// Chaque question coûte un appel au fournisseur IA : limite par utilisateur
// (le limiteur global de 300 req/min ne protège pas la facture).
const aiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.AI_RATE_LIMIT_MAX || 30), // 30 questions / 10 min / utilisateur
  keyGenerator: (req: AuthRequest) => `ai:${req.user?.id || req.ip}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Trop de questions à l\'assistant. Réessayez dans quelques minutes.' },
});

const MAX_MESSAGE_CHARS = 1000;

// Historique envoyé par l'app : seuls les rôles user/assistant et du texte court sont gardés
// (sinon on pouvait injecter un faux message « system » ou un texte géant facturé).
function cleanHistory(history: unknown): AiMessage[] {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-6)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, MAX_MESSAGE_CHARS) }));
}

// Base de connaissances 237GO injectée dans le system prompt
const KNOWLEDGE = `
237GO est une super-app camerounaise de mobilité et services. Services disponibles :
- GO Ride : courses VTC (moto, voiture éco/confort/VIP). Le passager peut PROPOSER son prix (négociation).
- GO Deliver : livraison de colis, documents, repas.
- GO Market : commande chez les marchands locaux, livrée à domicile.
- GO Share : covoiturage entre villes (Douala, Yaoundé, Bafoussam...).
- GO Rent : location de véhicules avec ou sans chauffeur.
- GO Business : comptes entreprise.

Paiements : Orange Money, MTN MoMo, Express Union, espèces, portefeuille 237GO.
Sécurité : le paiement est protégé par un système de séquestre (escrow) — l'argent n'est versé au prestataire qu'après confirmation de la fin du service. Bouton SOS en cas d'urgence.
Fidélité : 1 point par 100 XAF dépensés. Paliers Bronze, Silver, Gold, Platinum. 1 point = 10 XAF échangeable.
Pour devenir chauffeur : fournir permis, CNI, infos véhicule. Validation par l'équipe 237GO.
Prix de livraison (colis et GO Market) : 1 000 XAF jusqu'à 3 km, puis +150 XAF par km.
Restaurants et boutiques : on ne peut commander que pendant leurs horaires d'ouverture.
Partage de trajet : dès que la course GO Ride est commandée (pendant la recherche du chauffeur, puis pendant tout le trajet), bouton « Partager » pour envoyer un lien de suivi en direct par WhatsApp, SMS… Le lien est valable 12 h et le proche n'a pas besoin de l'application.
Mot de passe oublié : code reçu par email, sinon contacter le support WhatsApp.
Support humain : WhatsApp +33 6 50 22 24 74.
Ne jamais demander ni accepter de mot de passe ou de code reçu par email/SMS.
`;

/**
 * Assistant conversationnel multilingue (français, anglais, pidgin camerounais).
 * Peut consulter des données réelles de l'utilisateur (solde, dernière course).
 */
router.post(
  '/chat',
  authenticate,
  aiLimiter,
  [
    body('message').trim().notEmpty().withMessage('Message requis')
      .isLength({ max: MAX_MESSAGE_CHARS }).withMessage(`Message trop long (${MAX_MESSAGE_CHARS} caractères max)`),
    body('history').optional().isArray(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      if (!isAiConfigured()) {
        return res.status(503).json({
          success: false,
          message: 'L\'assistant IA n\'est pas encore activé. Contactez le support au besoin.',
        });
      }

      const { message, history } = req.body as { message: string; history?: AiMessage[] };

      // Récupérer un peu de contexte utilisateur réel
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        include: {
          wallet: true,
          loyaltyPoints: true,
        },
      });

      const userContext = user
        ? `Contexte de l'utilisateur connecté : prénom ${user.firstName}, rôle ${user.role}, ` +
          `langue préférée ${user.language}, solde portefeuille ${user.wallet?.balance ?? 0} XAF, ` +
          `points fidélité ${user.loyaltyPoints?.points ?? 0} (palier ${user.loyaltyPoints?.tier ?? 'BRONZE'}).`
        : '';

      const system =
        `Tu es "Go-Assistant", l'assistant virtuel de l'application 237GO au Cameroun. ` +
        `Tu es chaleureux, concis et utile. Réponds en 120 mots maximum, avec des phrases complètes. Tu réponds dans la langue du message de l'utilisateur : ` +
        `français, anglais, ou PIDGIN camerounais (ex: "A wan go Akwa", "How much e dey cost?"). ` +
        `Si l'utilisateur écrit en pidgin, réponds en pidgin. ` +
        `Tu aides sur l'utilisation de l'app, les prix, les services, les paiements, la sécurité. ` +
        `Tu ne donnes JAMAIS de conseils médicaux, juridiques ou financiers professionnels. ` +
        `Pour les problèmes graves (accident, litige non résolu), invite à utiliser le bouton SOS ou à contacter le support humain.\n\n` +
        `=== BASE DE CONNAISSANCES ===\n${KNOWLEDGE}\n${userContext}`;

      const messages: AiMessage[] = [
        ...cleanHistory(history),
        { role: 'user', content: message },
      ];

      const reply = await aiChat({ system, messages, maxTokens: 400, temperature: 0.6 });

      res.json({ success: true, data: { reply } });
    } catch (error: any) {
      // Le détail du fournisseur IA reste dans les logs Railway (il pouvait contenir des
      // informations sur la clé ou le compte : il n'est plus envoyé à l'app).
      const detail = error?.response?.data?.error?.message || error?.response?.data || error?.message;
      console.error('AI chat error:', typeof detail === 'string' ? detail : JSON.stringify(detail));
      res.status(500).json({
        success: false,
        message: 'L\'assistant est momentanément indisponible.',
      });
    }
  }
);

export { router as aiRouter };
