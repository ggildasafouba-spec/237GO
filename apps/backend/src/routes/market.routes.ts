import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { body, validationResult } from 'express-validator';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';
import { holdFunds, refundFunds, confirmSide, openDispute, getEscrowForService } from '../services/escrow.service';
import { SERVICE_PAYMENT_METHODS, SERVICE_PAYMENT_ERROR } from '../lib/paymentMethods';
import { PUBLIC_MERCHANT_SELECT } from '../lib/publicSelects';
import multer from 'multer';
import { parseMenuFile, importMenu, buildMenuTemplate, MENU_MAX_FILE_BYTES } from '../lib/menuImport';

const router = Router();

// Fichier du menu gardé en mémoire (jamais écrit sur le disque), 2 Mo max.
const menuUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MENU_MAX_FILE_BYTES } }).single('file');

/**
 * Calcul UNIQUE du montant d'une commande (produits + livraison).
 * Utilisé par le devis ET par la création : le montant payé par paiement direct
 * est donc exactement celui qui sera bloqué en séquestre.
 */
async function computeOrderTotals(
  merchantId: string,
  items: { productId: string; quantity: number }[],
  deliveryLat: number,
  deliveryLng: number
) {
  const merchant = await prisma.merchantProfile.findUnique({ where: { id: merchantId } });
  if (!merchant) {
    throw new AppError('Marchand non trouvé', 404);
  }
  // Vérifié ici (devis ET commande) : avant, une boutique non vérifiée ou fermée
  // recevait quand même des commandes payées, l'argent du client étant bloqué.
  if (merchant.verificationStatus !== 'VERIFIED') {
    throw new AppError('Cette boutique n\'est pas encore vérifiée par 237GO', 403);
  }
  if (!merchant.isOpen) {
    throw new AppError('Cette boutique est fermée pour le moment. Réessayez plus tard.', 409);
  }

  let totalAmount = 0;
  const orderItems: { productId: string; quantity: number; unitPrice: number }[] = [];

  for (const item of items) {
    const product = await prisma.product.findUnique({ where: { id: item.productId } });
    // Le produit doit exister, être disponible ET appartenir à CETTE boutique
    // (sinon on pourrait commander chez un marchand les produits d'un autre).
    if (!product || !product.isAvailable || product.merchantId !== merchant.id) {
      throw new AppError(`Produit ${item.productId} non disponible`, 400);
    }
    totalAmount += product.price * item.quantity;
    orderItems.push({ productId: item.productId, quantity: item.quantity, unitPrice: product.price });
  }

  const distance = calculateDistance(merchant.shopLat, merchant.shopLng, deliveryLat, deliveryLng);
  const deliveryFee = Math.ceil((300 + distance * 100) / 50) * 50;

  return { merchant, totalAmount, deliveryFee, orderItems };
}

// Devis exact d'une commande (avant paiement)
router.post(
  '/orders/quote',
  authenticate,
  [
    body('merchantId').isUUID(),
    body('items').isArray({ min: 1 }),
    body('items.*.productId').isUUID(),
    body('items.*.quantity').isInt({ min: 1 }),
    body('deliveryLat').isFloat(),
    body('deliveryLng').isFloat(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }
      const { merchantId, items, deliveryLat, deliveryLng } = req.body;
      const { totalAmount, deliveryFee } = await computeOrderTotals(merchantId, items, deliveryLat, deliveryLng);
      res.json({
        success: true,
        data: { totalAmount, deliveryFee, grandTotal: totalAmount + deliveryFee, currency: 'XAF' },
      });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erreur de calcul' });
    }
  }
);

// Lister les marchands à proximité
router.get('/merchants', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { lat, lng, radius = '5', category } = req.query;

    const where: Record<string, unknown> = { isOpen: true, verificationStatus: 'VERIFIED' };
    if (category) {
      where.category = category as string;
    }

    const userLat = lat ? parseFloat(lat as string) : NaN;
    const userLng = lng ? parseFloat(lng as string) : NaN;
    const maxRadius = Math.min(Math.max(parseFloat(radius as string) || 5, 0.5), 50);
    const hasPosition = isFinite(userLat) && isFinite(userLng);

    // PRÉFILTRE EN BASE par un carré autour du client (avant : TOUTES les boutiques du pays
    // étaient chargées à chaque ouverture de GO Market, puis triées en mémoire).
    // 1° de latitude ≈ 111 km ; la longitude se resserre avec cos(latitude).
    if (hasPosition) {
      const dLat = maxRadius / 111;
      const dLng = maxRadius / (111 * Math.max(Math.cos((userLat * Math.PI) / 180), 0.01));
      where.shopLat = { gte: userLat - dLat, lte: userLat + dLat };
      where.shopLng = { gte: userLng - dLng, lte: userLng + dLng };
    }

    // Uniquement les champs publics (avant : pièce d'identité et registre de commerce du
    // gérant envoyés à tous les clients). Les produits ne sont pas affichés dans la liste :
    // ils sont chargés à l'ouverture de la boutique (/merchants/:id).
    const merchants = await prisma.merchantProfile.findMany({
      where,
      select: PUBLIC_MERCHANT_SELECT,
      take: 200,
    });

    // Filtre exact sur le cercle (le carré inclut les coins)
    const filtered = hasPosition
      ? merchants.filter((m) => calculateDistance(userLat, userLng, m.shopLat, m.shopLng) <= maxRadius)
      : merchants;

    res.json({ success: true, data: filtered });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Détails d'un marchand et ses produits
router.get('/merchants/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Champs publics uniquement (avant : documents d'identité du gérant inclus)
    const merchant = await prisma.merchantProfile.findUnique({
      where: { id },
      select: {
        ...PUBLIC_MERCHANT_SELECT,
        user: { select: { id: true, firstName: true, lastName: true, phone: true } },
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

// Boutique du marchand connecté (profil + tous ses produits, dispo ou non)
router.get('/my-shop', authenticate, authorize('MERCHANT'), async (req: AuthRequest, res: Response) => {
  try {
    const merchant = await prisma.merchantProfile.findUnique({
      where: { userId: req.user!.id },
      include: {
        products: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!merchant) {
      throw new AppError('Profil marchand non trouvé', 404);
    }

    res.json({ success: true, data: merchant });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Modifier la position de la boutique (GPS ou point choisi sur la carte).
// Avant : impossible après l'inscription ; une boutique mal placée restait invisible
// pour les clients proches (recherche limitée à 5 km) et les frais de livraison étaient faux.
router.patch(
  '/my-shop/location',
  authenticate,
  authorize('MERCHANT'),
  [
    body('shopLat').isFloat({ min: -90, max: 90 }),
    body('shopLng').isFloat({ min: -180, max: 180 }),
    body('shopAddress').optional().trim().isLength({ min: 1, max: 200 }),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Position invalide', errors: errors.array() });
      }
      const merchant = await prisma.merchantProfile.findUnique({ where: { userId: req.user!.id }, select: { id: true } });
      if (!merchant) throw new AppError('Profil marchand non trouvé', 404);

      const { shopLat, shopLng, shopAddress } = req.body;
      const updated = await prisma.merchantProfile.update({
        where: { id: merchant.id },
        data: {
          shopLat: Number(shopLat),
          shopLng: Number(shopLng),
          ...(shopAddress ? { shopAddress } : {}),
        },
        select: { shopLat: true, shopLng: true, shopAddress: true },
      });
      res.json({ success: true, message: 'Position de la boutique mise à jour', data: updated });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erreur' });
    }
  }
);

// Ouvrir / fermer la boutique
router.patch('/my-shop/toggle', authenticate, authorize('MERCHANT'), async (req: AuthRequest, res: Response) => {
  try {
    const merchant = await prisma.merchantProfile.findUnique({ where: { userId: req.user!.id } });
    if (!merchant) {
      throw new AppError('Profil marchand non trouvé', 404);
    }
    const updated = await prisma.merchantProfile.update({
      where: { id: merchant.id },
      data: { isOpen: !merchant.isOpen },
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Modifier un produit (marchand propriétaire)
router.patch(
  '/products/:id',
  authenticate,
  authorize('MERCHANT'),
  [
    body('name').optional().trim().notEmpty(),
    body('price').optional().isFloat({ min: 0 }),
    body('category').optional().trim().notEmpty(),
    body('description').optional().trim(),
    body('isAvailable').optional().isBoolean(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const merchant = await prisma.merchantProfile.findUnique({ where: { userId: req.user!.id } });
      if (!merchant) {
        throw new AppError('Profil marchand non trouvé', 404);
      }

      const product = await prisma.product.findUnique({ where: { id: req.params.id } });
      if (!product || product.merchantId !== merchant.id) {
        throw new AppError('Produit non trouvé', 404);
      }

      const { name, price, category, description, image, isAvailable } = req.body;
      const updated = await prisma.product.update({
        where: { id: req.params.id },
        data: {
          ...(name !== undefined && { name }),
          ...(price !== undefined && { price }),
          ...(category !== undefined && { category }),
          ...(description !== undefined && { description }),
          ...(image !== undefined && { image }),
          ...(isAvailable !== undefined && { isAvailable }),
        },
      });

      res.json({ success: true, data: updated });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erreur' });
    }
  }
);

// Supprimer un produit (marchand propriétaire)
router.delete('/products/:id', authenticate, authorize('MERCHANT'), async (req: AuthRequest, res: Response) => {
  try {
    const merchant = await prisma.merchantProfile.findUnique({ where: { userId: req.user!.id } });
    if (!merchant) {
      throw new AppError('Profil marchand non trouvé', 404);
    }

    const product = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!product || product.merchantId !== merchant.id) {
      throw new AppError('Produit non trouvé', 404);
    }

    await prisma.product.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Produit supprimé' });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Mettre à jour les horaires d'ouverture de la boutique
router.patch('/my-shop/hours', authenticate, authorize('MERCHANT'), async (req: AuthRequest, res: Response) => {
  try {
    const merchant = await prisma.merchantProfile.findUnique({ where: { userId: req.user!.id } });
    if (!merchant) {
      throw new AppError('Profil marchand non trouvé', 404);
    }
    const { openingHours } = req.body;
    if (!openingHours || typeof openingHours !== 'object') {
      throw new AppError('Horaires invalides', 400);
    }
    const updated = await prisma.merchantProfile.update({
      where: { id: merchant.id },
      data: { openingHours },
    });
    res.json({ success: true, data: updated, message: 'Horaires mis à jour' });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// ========== IMPORT DU MENU (Excel / CSV) ==========

// Modèle Excel à remplir (public : simple fichier vide d'exemple, aucune donnée)
router.get('/menu-template', async (_req, res: Response) => {
  try {
    const file = await buildMenuTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="menu-237go.xlsx"');
    res.send(file);
  } catch {
    res.status(500).json({ success: false, message: 'Erreur de génération du modèle' });
  }
});

// Étape 1 : lecture du fichier → aperçu ligne par ligne (rien n'est enregistré).
// Marchand : sa propre boutique. Admin : ?merchantId=... (import pour le compte d'un restaurant).
router.post('/menu-import/parse', authenticate, authorize('MERCHANT', 'ADMIN'), (req: AuthRequest, res: Response) => {
  menuUpload(req, res, async (uploadError) => {
    try {
      if (uploadError) {
        const tooBig = (uploadError as any).code === 'LIMIT_FILE_SIZE';
        throw new AppError(tooBig ? 'Fichier trop lourd (2 Mo maximum)' : 'Envoi du fichier impossible', 400);
      }
      if (!req.file) throw new AppError('Aucun fichier reçu', 400);

      let merchantId: string | undefined;
      if (req.user!.role === 'ADMIN') {
        merchantId = typeof req.query.merchantId === 'string' ? req.query.merchantId : undefined;
      } else {
        const merchant = await prisma.merchantProfile.findUnique({ where: { userId: req.user!.id }, select: { id: true } });
        if (!merchant) throw new AppError('Profil marchand non trouvé', 404);
        merchantId = merchant.id;
      }

      const result = await parseMenuFile(req.file.buffer, req.file.originalname, merchantId);
      res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      console.error('Lecture du menu échouée:', (error as Error).message);
      res.status(500).json({ success: false, message: 'Lecture du fichier impossible' });
    }
  });
});

// Étape 2 : enregistrement des plats validés dans la boutique du marchand connecté
router.post('/my-shop/menu-import', authenticate, authorize('MERCHANT'), async (req: AuthRequest, res: Response) => {
  try {
    const merchant = await prisma.merchantProfile.findUnique({ where: { userId: req.user!.id }, select: { id: true } });
    if (!merchant) throw new AppError('Profil marchand non trouvé', 404);
    const result = await importMenu(merchant.id, req.body?.items);
    res.json({
      success: true,
      message: `Menu importé : ${result.created} plat(s) ajouté(s), ${result.updated} mis à jour`,
      data: result,
    });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Import du menu impossible' });
  }
});

// Commandes REÇUES par le marchand connecté
router.get('/my-orders', authenticate, authorize('MERCHANT'), async (req: AuthRequest, res: Response) => {
  try {
    const merchant = await prisma.merchantProfile.findUnique({ where: { userId: req.user!.id } });
    if (!merchant) {
      throw new AppError('Profil marchand non trouvé', 404);
    }

    const orders = await prisma.marketOrder.findMany({
      where: { merchantId: merchant.id },
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { firstName: true, lastName: true, phone: true } },
        items: { include: { product: { select: { name: true } } } },
      },
    });

    res.json({ success: true, data: orders });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

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
    body('paymentMethod').isIn([...SERVICE_PAYMENT_METHODS]).withMessage(SERVICE_PAYMENT_ERROR),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { merchantId, items, deliveryAddress, deliveryLat, deliveryLng, paymentMethod } = req.body;

      const { merchant, totalAmount, deliveryFee, orderItems } = await computeOrderTotals(
        merchantId, items, deliveryLat, deliveryLng
      );

      if (merchant.userId === req.user!.id) {
        throw new AppError('Vous ne pouvez pas commander dans votre propre boutique', 400);
      }

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

      // ESCROW : bloquer le montant total (produits + livraison) à la commande.
      // Libéré au marchand quand le client confirme la réception.
      // Si le blocage échoue (solde insuffisant), on supprime la commande : sinon le
      // marchand recevrait une commande NON payée.
      try {
        await holdFunds({
          amount: totalAmount + deliveryFee,
          payerId: req.user!.id,
          payeeId: merchant.userId,
          paymentMethod,
          serviceType: 'MARKET',
          serviceId: order.id,
        });
      } catch (holdError) {
        await prisma.$transaction([
          prisma.orderItem.deleteMany({ where: { orderId: order.id } }),
          prisma.marketOrder.delete({ where: { id: order.id } }),
        ]).catch(() => {});
        throw holdError;
      }

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
  [body('status').isIn(['CONFIRMED', 'PREPARING', 'READY', 'PICKED_UP', 'DELIVERING', 'DELIVERED', 'CANCELLED'])],
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      // Récupérer la commande et vérifier que c'est bien le marchand
      const existingOrder = await prisma.marketOrder.findUnique({
        where: { id },
        include: { merchant: true },
      });
      if (!existingOrder) {
        throw new AppError('Commande non trouvée', 404);
      }
      if (existingOrder.merchant.userId !== req.user!.id) {
        throw new AppError('Vous n\'êtes pas le marchand de cette commande', 403);
      }

      // Une commande déjà livrée ou annulée ne doit plus changer d'état
      // (ex. annuler une commande livrée rembourserait le client à tort).
      if (existingOrder.status === 'DELIVERED' || existingOrder.status === 'CANCELLED') {
        throw new AppError(`Commande déjà ${existingOrder.status === 'DELIVERED' ? 'livrée' : 'annulée'}`, 409);
      }

      const order = await prisma.marketOrder.update({
        where: { id },
        data: { status },
      });

      // Annulation par le marchand : rembourser le client.
      // (Avant : aucun remboursement, l'argent restait bloqué en séquestre.)
      if (status === 'CANCELLED') {
        try {
          const escrow = await getEscrowForService('MARKET', id);
          if (escrow && (escrow.status === 'HELD' || escrow.status === 'DISPUTED')) {
            await refundFunds(escrow.id, 'auto');
          }
        } catch (refundError) {
          console.error(`Remboursement commande ${id} échoué:`, (refundError as Error).message);
        }
      }

      const io = req.app.get('io');
      io.to(`user:${order.customerId}`).emit('order_status_update', {
        orderId: id,
        status,
      });

      // Si livrée : le marchand confirme son côté (prestataire).
      // L'argent reste en séquestre jusqu'à ce que le client confirme la réception.
      if (status === 'DELIVERED') {
        const grandTotal = order.totalAmount + order.deliveryFee;

        await confirmSide('MARKET', id, 'provider', req.user!.id).catch(() => {});

        io.to(`user:${order.customerId}`).emit('order_completed', {
          orderId: id,
          grandTotal,
          action: 'confirm_reception', // le client doit confirmer pour libérer le paiement
        });
      }

      res.json({ success: true, data: order });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
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

// Le client confirme la réception de sa commande (libère l'escrow)
router.post('/orders/:id/confirm-reception', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const result = await confirmSide('MARKET', id, 'client', req.user!.id);

    res.json({
      success: true,
      message: result.status === 'RELEASED'
        ? 'Commande validée ! Le marchand a été payé.'
        : 'Réception confirmée. En attente de la confirmation du marchand.',
      data: result,
    });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Ouvrir un litige sur une commande
router.post(
  '/orders/:id/dispute',
  authenticate,
  [body('reason').trim().notEmpty().withMessage('Motif du litige requis')],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }
      const { id } = req.params;
      const result = await openDispute('MARKET', id, req.user!.id, req.body.reason);

      const io = req.app.get('io');
      io.to('admins').emit('escrow_dispute', { serviceType: 'MARKET', serviceId: id, escrowId: result.id });

      res.json({ success: true, message: 'Litige ouvert. Un administrateur va examiner votre dossier.', data: result });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erreur' });
    }
  }
);

// Consulter l'escrow d'une commande
router.get('/orders/:id/escrow', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const escrow = await getEscrowForService('MARKET', req.params.id);
    res.json({ success: true, data: escrow });
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
