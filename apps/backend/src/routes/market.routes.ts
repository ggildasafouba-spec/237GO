import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { body, validationResult } from 'express-validator';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';

const router = Router();
const prisma = new PrismaClient();

// Lister les marchands à proximité
router.get('/merchants', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { lat, lng, radius = '5', category } = req.query;

    const where: Record<string, unknown> = { isOpen: true };
    if (category) {
      where.category = category as string;
    }

    const merchants = await prisma.merchantProfile.findMany({
      where,
      include: {
        user: { select: { firstName: true, lastName: true, phone: true } },
        products: { where: { isAvailable: true }, take: 5 },
      },
    });

    // Filtrer par distance si coordonnées fournies
    let filtered = merchants;
    if (lat && lng) {
      const userLat = parseFloat(lat as string);
      const userLng = parseFloat(lng as string);
      const maxRadius = parseFloat(radius as string);

      filtered = merchants.filter((m) => {
        const dist = calculateDistance(userLat, userLng, m.shopLat, m.shopLng);
        return dist <= maxRadius;
      });
    }

    res.json({ success: true, data: filtered });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Détails d'un marchand et ses produits
router.get('/merchants/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const merchant = await prisma.merchantProfile.findUnique({
      where: { id },
      include: {
        user: { select: { firstName: true, lastName: true, phone: true } },
        products: { where: { isAvailable: true }, orderBy: { category: 'asc' } },
      },
    });

    if (!merchant) {
      throw new AppError('Marchand non trouvé', 404);
    }

    res.json({ success: true, data: merchant });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Ajouter un produit (marchand)
router.post(
  '/products',
  authenticate,
  authorize('MERCHANT'),
  [
    body('name').trim().notEmpty(),
    body('price').isFloat({ min: 0 }),
    body('category').trim().notEmpty(),
    body('description').optional().trim(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const merchant = await prisma.merchantProfile.findUnique({
        where: { userId: req.user!.id },
      });

      if (!merchant) {
        throw new AppError('Profil marchand non trouvé', 404);
      }

      const { name, price, category, description, image } = req.body;

      const product = await prisma.product.create({
        data: {
          merchantId: merchant.id,
          name,
          price,
          category,
          description,
          image,
        },
      });

      res.status(201).json({ success: true, data: product });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erreur' });
    }
  }
);

// Passer une commande
router.post(
  '/orders',
  authenticate,
  [
    body('merchantId').isUUID(),
    body('items').isArray({ min: 1 }),
    body('items.*.productId').isUUID(),
    body('items.*.quantity').isInt({ min: 1 }),
    body('deliveryAddress').trim().notEmpty(),
    body('deliveryLat').isFloat(),
    body('deliveryLng').isFloat(),
    body('paymentMethod').isIn(['ORANGE_MONEY', 'MTN_MOMO', 'EXPRESS_UNION', 'CASH', 'WALLET']),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { merchantId, items, deliveryAddress, deliveryLat, deliveryLng, paymentMethod } = req.body;

      const merchant = await prisma.merchantProfile.findUnique({ where: { id: merchantId } });
      if (!merchant) {
        throw new AppError('Marchand non trouvé', 404);
      }

      // Calculer le total
      let totalAmount = 0;
      const orderItems: { productId: string; quantity: number; unitPrice: number }[] = [];

      for (const item of items) {
        const product = await prisma.product.findUnique({ where: { id: item.productId } });
        if (!product || !product.isAvailable) {
          throw new AppError(`Produit ${item.productId} non disponible`, 400);
        }
        totalAmount += product.price * item.quantity;
        orderItems.push({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: product.price,
        });
      }

      // Frais de livraison
      const distance = calculateDistance(merchant.shopLat, merchant.shopLng, deliveryLat, deliveryLng);
      const deliveryFee = Math.ceil((300 + distance * 100) / 50) * 50;

      const order = await prisma.marketOrder.create({
        data: {
          customerId: req.user!.id,
          merchantId,
          totalAmount,
          deliveryFee,
          deliveryAddress,
          deliveryLat,
          deliveryLng,
          paymentMethod,
          items: {
            create: orderItems,
          },
        },
        include: { items: { include: { product: true } } },
      });

      // Notifier le marchand
      const io = req.app.get('io');
      io.to(`merchant:${merchant.userId}`).emit('new_order', {
        orderId: order.id,
        items: order.items,
        totalAmount,
        deliveryFee,
      });

      res.status(201).json({
        success: true,
        message: 'Commande passée avec succès !',
        data: {
          ...order,
          grandTotal: totalAmount + deliveryFee,
        },
      });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erreur de commande' });
    }
  }
);

// Mettre à jour le statut d'une commande (marchand)
router.patch(
  '/orders/:id/status',
  authenticate,
  authorize('MERCHANT'),
  [body('status').isIn(['CONFIRMED', 'PREPARING', 'READY', 'CANCELLED'])],
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      const order = await prisma.marketOrder.update({
        where: { id },
        data: { status },
      });

      const io = req.app.get('io');
      io.to(`user:${order.customerId}`).emit('order_status_update', {
        orderId: id,
        status,
      });

      res.json({ success: true, data: order });
    } catch {
      res.status(500).json({ success: false, message: 'Erreur' });
    }
  }
);

// Historique des commandes
router.get('/orders', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { page = '1', limit = '20' } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const orders = await prisma.marketOrder.findMany({
      where: { customerId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      skip,
      take: parseInt(limit as string),
      include: {
        merchant: { select: { shopName: true } },
        items: { include: { product: { select: { name: true } } } },
      },
    });

    res.json({ success: true, data: orders });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export { router as marketRouter };
