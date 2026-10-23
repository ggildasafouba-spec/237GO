import express from 'express';
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
const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: Number(process.env.RATE_LIMIT_MAX || 300), // 300 req/min/IP par défaut
  standardHeaders: true,
  legacyHeaders: false,
  // Ne pas limiter le health check (pings d'uptime de Railway).
  skip: (req) => req.path === '/health' || req.path === '/api/health',
  message: { success: false, message: 'Trop de requêtes, veuillez réessayer dans un instant.' },
});

// Limiteur strict anti-bruteforce pour l'authentification (login, register, reset).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: Number(process.env.AUTH_RATE_LIMIT_MAX || 30), // 30 tentatives / 15 min / IP
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
app.use('/api/auth', authLimiter, authRouter);
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
