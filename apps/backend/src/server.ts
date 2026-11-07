import express, { Request } from 'express';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';

import { authRouter } from './routes/auth.routes';
import { rideRouter } from './routes/ride.routes';
import { deliveryRouter } from './routes/delivery.routes';
import { walletRouter } from './routes/wallet.routes';
import { marketRouter } from './routes/market.routes';
import { carpoolRouter } from './routes/carpool.routes';
import { rentalRouter } from './routes/rental.routes';
import { businessRouter } from './routes/business.routes';
import { userRouter } from './routes/user.routes';
import { adminRouter } from './routes/admin.routes';
import { webhookRouter } from './routes/webhook.routes';
import { uploadRouter, UPLOAD_DIR } from './routes/upload.routes';
import { aiRouter } from './routes/ai.routes';
import { chatRouter } from './routes/chat.routes';
import { setupSocketHandlers } from './socket';
import { errorHandler } from './middleware/error.middleware';

dotenv.config();

const app = express();

// Railway (et la plupart des hébergeurs) placent l'app derrière un proxy qui
// ajoute l'en-tête X-Forwarded-For. Sans ce réglage, express-rate-limit lève
// l'erreur ERR_ERL_UNEXPECTED_X_FORWARDED_FOR et identifie mal les clients.
// '1' = faire confiance au premier proxy (Railway), suffisant et sûr.
app.set('trust proxy', 1);

const httpServer = createServer(app);

// Socket.IO pour le tracking temps réel
const io = new SocketServer(httpServer, {
  cors: {
    origin: process.env.SOCKET_CORS_ORIGIN || '*',
    methods: ['GET', 'POST'],
  },
});

// Middleware globaux
app.use(helmet());
app.use(cors());
// Conserver le corps brut (nécessaire pour vérifier la signature des webhooks NotchPay)
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf.toString('utf8');
    },
  })
);
app.use(express.urlencoded({ extended: true }));

// ===== Rate limiting =====
// Limiteur global : généreux, car un seul utilisateur actif génère beaucoup de
// requêtes (carte, positions, listes...). Trop bas = on bloque de vrais clients,
// surtout plusieurs utilisateurs derrière une même IP (réseau mobile/wifi public).
// Surchargeable via RATE_LIMIT_MAX. On n'applique PAS de limite aux webhooks
// (prestataires de paiement) ni au health check.
// CLÉ DE LIMITATION : l'utilisateur connecté, pas l'IP.
// Au Cameroun, des centaines d'utilisateurs partagent la même IP publique (réseau mobile
// partagé, "CGNAT"). Limiter par IP bloquerait de vrais clients à cause de leurs voisins.
// On vérifie la signature du token (jwt.verify, pas jwt.decode) : sinon un attaquant
// pourrait fabriquer de faux identifiants pour contourner la limite.
// Les visiteurs sans token valide (login, inscription...) restent limités par IP.
const rateLimitKey = (req: Request): string => {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(
        header.split(' ')[1],
        process.env.JWT_SECRET || 'default-secret'
      ) as { userId?: string };
      if (decoded?.userId) return `user:${decoded.userId}`;
    } catch {
      /* token invalide ou expiré : on retombe sur l'IP */
    }
  }
  return `ip:${req.ip}`;
};

const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: Number(process.env.RATE_LIMIT_MAX || 300), // 300 req/min par utilisateur (ou par IP si anonyme)
  keyGenerator: rateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  // Ne pas limiter le health check (pings d'uptime de Railway).
  skip: (req) => req.path === '/health' || req.path === '/api/health',
  message: { success: false, message: 'Trop de requêtes, veuillez réessayer dans un instant.' },
});

// Limiteur anti-bruteforce pour l'authentification (login, register, reset).
// Clé = IP + identifiant saisi : un attaquant qui vise UN compte est bloqué rapidement,
// mais les autres utilisateurs derrière la même IP partagée ne sont pas touchés.
// skipSuccessfulRequests : seules les tentatives ÉCHOUÉES comptent (un login réussi ne consomme rien).
const authAccountKey = (req: Request): string => {
  const id = String(req.body?.identifier || req.body?.phone || req.body?.email || '')
    .trim()
    .toLowerCase();
  return `auth:${req.ip}|${id}`;
};

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: Number(process.env.AUTH_RATE_LIMIT_MAX || 10), // 10 échecs / 15 min / (IP + compte)
  keyGenerator: authAccountKey,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Trop de tentatives. Réessayez dans quelques minutes.' },
});

// "Mot de passe oublié" répond toujours succès (pour ne pas révéler si un compte existe) :
// le limiteur ci-dessus, qui ne compte que les échecs, ne l'arrêterait donc jamais.
// Cette limite compte TOUTES les demandes : elle évite le spam de codes (et de SMS payants).
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.FORGOT_PASSWORD_RATE_LIMIT_MAX || 5),
  keyGenerator: authAccountKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Trop de demandes de code. Réessayez dans quelques minutes.' },
});

// Filet de sécurité par IP sur les routes d'authentification (très large, pour les
// IP partagées) : stoppe quand même un script qui tenterait des milliers de comptes.
const authIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_IP_RATE_LIMIT_MAX || 500),
  keyGenerator: (req: Request) => `authip:${req.ip}`,
  // Les requêtes déjà identifiées par un token valide (ex. /auth/me à l'ouverture de l'app)
  // sont limitées par le limiteur global par utilisateur, pas ici.
  skip: (req: Request) => rateLimitKey(req).startsWith('user:'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Trop de tentatives. Réessayez dans quelques minutes.' },
});

// Les webhooks de paiement ne doivent JAMAIS être limités (sinon on rate des
// confirmations de paiement). Ils sont montés avant le limiteur global.
app.use('/api/webhooks', webhookRouter);

// Limiteur global pour le reste de l'API (hors webhooks déjà montés).
app.use('/api/', globalLimiter);

// Routes
app.use('/api/auth/forgot-password', forgotPasswordLimiter);
app.use('/api/auth', authIpLimiter, authLimiter, authRouter);
app.use('/api/users', userRouter);
app.use('/api/rides', rideRouter);
app.use('/api/deliveries', deliveryRouter);
app.use('/api/wallet', walletRouter);
app.use('/api/market', marketRouter);
app.use('/api/carpools', carpoolRouter);
app.use('/api/rentals', rentalRouter);
app.use('/api/business', businessRouter);
app.use('/api/admin', adminRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/ai', aiRouter);
app.use('/api/chat', chatRouter);

// Servir les fichiers téléversés
app.use('/uploads', express.static(UPLOAD_DIR));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: '237GO API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// Error handler
app.use(errorHandler);

// Socket.IO handlers
setupSocketHandlers(io);

// Rendre io accessible dans les routes
app.set('io', io);

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
  console.log(`🚀 237GO API démarrée sur le port ${PORT}`);
  console.log(`📍 Environnement: ${process.env.NODE_ENV || 'development'}`);
});

export { app, io };
