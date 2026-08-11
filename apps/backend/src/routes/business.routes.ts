import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { body, validationResult } from 'express-validator';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';

const router = Router();
const prisma = new PrismaClient();

// Créer un compte entreprise
router.post(
  '/accounts',
  authenticate,
  [
    body('name').trim().notEmpty().withMessage('Nom de l\'entreprise requis'),
    body('contactEmail').isEmail(),
    body('contactPhone').matches(/^6[0-9]{8}$/),
    body('monthlyBudget').optional().isFloat({ min: 0 }),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { name, contactEmail, contactPhone, address, monthlyBudget } = req.body;

      const account = await prisma.businessAccount.create({
        data: {
          name,
          contactEmail,
          contactPhone,
          address,
          monthlyBudget,
          members: {
            create: {
              userId: req.user!.id,
              role: 'ADMIN',
            },
          },
        },
        include: { members: true },
      });

      res.status(201).json({
        success: true,
        message: 'Compte entreprise créé !',
        data: account,
      });
    } catch {
      res.status(500).json({ success: false, message: 'Erreur de création' });
    }
  }
);

// Ajouter un membre
router.post(
  '/accounts/:id/members',
  authenticate,
  [
    body('userId').isUUID(),
    body('role').optional().isIn(['MANAGER', 'EMPLOYEE']),
    body('monthlyLimit').optional().isFloat({ min: 0 }),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { userId, role, monthlyLimit } = req.body;

      // Vérifier que l'utilisateur est admin du compte
      const membership = await prisma.businessMember.findFirst({
        where: { businessId: id, userId: req.user!.id, role: 'ADMIN' },
      });

      if (!membership) {
        throw new AppError('Vous n\'êtes pas administrateur de ce compte', 403);
      }

      const member = await prisma.businessMember.create({
        data: {
          businessId: id,
          userId,
          role: role || 'EMPLOYEE',
          monthlyLimit,
        },
      });

      res.status(201).json({ success: true, data: member });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erreur' });
    }
  }
);

// Dashboard entreprise (stats)
router.get('/accounts/:id/dashboard', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Vérifier appartenance
    const membership = await prisma.businessMember.findFirst({
      where: { businessId: id, userId: req.user!.id, role: { in: ['ADMIN', 'MANAGER'] } },
    });

    if (!membership) {
      throw new AppError('Accès non autorisé', 403);
    }

    const account = await prisma.businessAccount.findUnique({
      where: { id },
      include: {
        members: {
          include: { user: { select: { firstName: true, lastName: true, phone: true } } },
        },
      },
    });

    // TODO: Agréger les courses des membres pour les stats
    res.json({
      success: true,
      data: {
        account,
        stats: {
          totalMembers: account?.members.length || 0,
          monthlyBudget: account?.monthlyBudget || 0,
          budgetUsed: 0, // TODO: calculer
          totalTrips: 0, // TODO: calculer
        },
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Mes comptes entreprise
router.get('/my-accounts', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const memberships = await prisma.businessMember.findMany({
      where: { userId: req.user!.id },
      include: {
        business: true,
      },
    });

    res.json({ success: true, data: memberships });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

export { router as businessRouter };
