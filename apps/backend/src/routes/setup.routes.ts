import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const router = Router();
const prisma = new PrismaClient();

/**
 * ROUTE TEMPORAIRE DE SETUP — à retirer après usage.
 * Protégée par une clé secrète (SETUP_KEY) passée en query.
 *
 * POST /api/setup/reset-and-admin?key=XXXX
 * Body: { phone, firstName, lastName, password }
 *
 * 1. Vide toutes les données (TRUNCATE CASCADE sur toutes les tables métier)
 * 2. Crée un compte ADMIN avec les coordonnées fournies (+ wallet + loyalty)
 */
router.post('/reset-and-admin', async (req: Request, res: Response) => {
  try {
    const key = req.query.key as string | undefined;
    const expected = process.env.SETUP_KEY;
    if (!expected || key !== expected) {
      return res.status(403).json({ success: false, message: 'Clé invalide' });
    }

    const { phone, firstName, lastName, password } = req.body as {
      phone?: string; firstName?: string; lastName?: string; password?: string;
    };
    if (!phone || !firstName || !lastName || !password) {
      return res.status(400).json({ success: false, message: 'phone, firstName, lastName, password requis' });
    }
    if (!/^6[0-9]{8}$/.test(phone)) {
      return res.status(400).json({ success: false, message: 'Numéro invalide (format 6XXXXXXXX)' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Mot de passe trop court (min 6 caractères)' });
    }

    // 1) Vider toutes les tables métier (CASCADE gère les dépendances)
    const tables = [
      'ratings', 'notifications', 'emergency_contacts', 'escrows',
      'order_items', 'market_orders', 'products', 'merchant_profiles',
      'carpool_bookings', 'carpools', 'rental_bookings', 'vehicles',
      'business_members', 'business_accounts',
      'rides', 'deliveries', 'transactions', 'wallets',
      'loyalty_points', 'driver_profiles', 'users',
    ];
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE;`
    );

    // 2) Créer le compte ADMIN réel
    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await prisma.user.create({
      data: {
        phone,
        firstName,
        lastName,
        passwordHash,
        role: 'ADMIN',
        language: 'fr',
        wallet: { create: { balance: 0 } },
        loyaltyPoints: { create: { points: 0 } },
      },
    });

    res.json({
      success: true,
      message: 'Base réinitialisée et compte admin créé.',
      data: { phone: admin.phone, role: admin.role, firstName: admin.firstName },
    });
  } catch (error: any) {
    console.error('Setup reset error:', error.message);
    res.status(500).json({ success: false, message: 'Erreur lors de la réinitialisation', detail: error.message });
  }
});

export { router as setupRouter };
