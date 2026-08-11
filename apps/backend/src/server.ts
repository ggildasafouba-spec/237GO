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
import { setupSocketHandlers } from './socket';
import { errorHandler } from './middleware/error.middleware';

dotenv.config();

const app = express();
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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Trop de requêtes, veuillez réessayer plus tard.',
});
app.use('/api/', limiter);

// Routes
app.use('/api/auth', authRouter);
app.use('/api/users', userRouter);
app.use('/api/rides', rideRouter);
app.use('/api/deliveries', deliveryRouter);
app.use('/api/wallet', walletRouter);
app.use('/api/market', marketRouter);
app.use('/api/carpools', carpoolRouter);
app.use('/api/rentals', rentalRouter);
app.use('/api/business', businessRouter);
app.use('/api/admin', adminRouter);
app.use('/api/webhooks', webhookRouter);

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
