import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { body, validationResult } from 'express-validator';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { aiChat, isAiConfigured, AiMessage } from '../services/ai.service';

const router = Router();
const prisma = new PrismaClient();

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
`;

/**
 * Assistant conversationnel multilingue (français, anglais, pidgin camerounais).
 * Peut consulter des données réelles de l'utilisateur (solde, dernière course).
 */
router.post(
  '/chat',
  authenticate,
  [
    body('message').trim().notEmpty().withMessage('Message requis'),
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
        `Tu es chaleureux, concis et utile. Tu réponds dans la langue du message de l'utilisateur : ` +
        `français, anglais, ou PIDGIN camerounais (ex: "A wan go Akwa", "How much e dey cost?"). ` +
        `Si l'utilisateur écrit en pidgin, réponds en pidgin. ` +
        `Tu aides sur l'utilisation de l'app, les prix, les services, les paiements, la sécurité. ` +
        `Tu ne donnes JAMAIS de conseils médicaux, juridiques ou financiers professionnels. ` +
        `Pour les problèmes graves (accident, litige non résolu), invite à utiliser le bouton SOS ou à contacter le support humain.\n\n` +
        `=== BASE DE CONNAISSANCES ===\n${KNOWLEDGE}\n${userContext}`;

      const messages: AiMessage[] = [
        ...(Array.isArray(history) ? history.slice(-6) : []),
        { role: 'user', content: message },
      ];

      const reply = await aiChat({ system, messages, maxTokens: 600, temperature: 0.6 });

      res.json({ success: true, data: { reply } });
    } catch (error: any) {
      console.error('AI chat error:', error.message);
      res.status(500).json({ success: false, message: 'L\'assistant est momentanément indisponible.' });
    }
  }
);

export { router as aiRouter };
