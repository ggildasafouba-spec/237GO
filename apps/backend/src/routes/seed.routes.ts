import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const router = Router();
const prisma = new PrismaClient();

/**
 * ⚠️ ENDPOINT TEMPORAIRE DE SEED ⚠️
 * À utiliser UNE SEULE FOIS pour créer les comptes de test en production,
 * puis à SUPPRIMER. Protégé par une clé secrète passée en query (?key=...).
 */
router.post('/run', async (req: Request, res: Response) => {
  try {
    const key = req.query.key || req.body?.key;
    if (key !== 'seed-237go-une-fois-2026') {
      return res.status(403).json({ success: false, message: 'Clé invalide' });
    }

    const adminPassword = await bcrypt.hash('admin237go', 12);
    await prisma.user.upsert({
      where: { phone: '600000000' },
      update: { passwordHash: adminPassword },
      create: {
        phone: '600000000', firstName: 'Admin', lastName: '237GO',
        passwordHash: adminPassword, role: 'ADMIN', language: 'fr',
        wallet: { create: { balance: 0 } },
        loyaltyPoints: { create: { points: 0 } },
      },
    });

    const defaultPassword = await bcrypt.hash('test237go', 12);
    const passengers = [
      { phone: '691234567', firstName: 'Jean', lastName: 'Mballa' },
      { phone: '677654321', firstName: 'Marie', lastName: 'Ngo' },
      { phone: '655112233', firstName: 'Claude', lastName: 'Eto' },
    ];
    for (const p of passengers) {
      await prisma.user.upsert({
        where: { phone: p.phone },
        update: { passwordHash: defaultPassword },
        create: {
          ...p, passwordHash: defaultPassword, role: 'PASSENGER', language: 'fr',
          wallet: { create: { balance: 5000 } },
          loyaltyPoints: { create: { points: 50 } },
        },
      });
    }

    const drivers = [
      { phone: '698765432', firstName: 'Aimé', lastName: 'Fotso', vehicleType: 'MOTO' as const, plate: 'LT 1234 A' },
      { phone: '677112233', firstName: 'Paul', lastName: 'Tchamba', vehicleType: 'CAR_ECONOMY' as const, plate: 'CE 5678 B' },
      { phone: '655443322', firstName: 'Eric', lastName: 'Kamga', vehicleType: 'CAR_COMFORT' as const, plate: 'LT 9012 C' },
    ];
    for (const d of drivers) {
      const user = await prisma.user.upsert({
        where: { phone: d.phone },
        update: { passwordHash: defaultPassword },
        create: {
          phone: d.phone, firstName: d.firstName, lastName: d.lastName,
          passwordHash: defaultPassword, role: 'DRIVER', language: 'fr',
          wallet: { create: { balance: 15000 } },
          loyaltyPoints: { create: { points: 200 } },
        },
      });
      await prisma.driverProfile.upsert({
        where: { userId: user.id },
        update: {},
        create: {
          userId: user.id,
          licenseNumber: `DL-${d.phone.substring(0, 4)}`,
          licenseExpiry: new Date('2028-12-31'),
          cniNumber: `CNI-${d.phone}`,
          vehicleType: d.vehicleType,
          vehiclePlate: d.plate,
          vehicleBrand: d.vehicleType === 'MOTO' ? 'Honda' : 'Toyota',
          vehicleModel: d.vehicleType === 'MOTO' ? 'CG125' : 'Corolla',
          vehicleYear: 2020,
          verificationStatus: 'VERIFIED',
          isOnline: false,
          currentLat: 4.0511 + Math.random() * 0.02,
          currentLng: 9.7679 + Math.random() * 0.02,
          totalTrips: Math.floor(Math.random() * 200),
          averageRating: 4 + Math.random(),
        },
      });
    }

    const merchantUser = await prisma.user.upsert({
      where: { phone: '699887766' },
      update: { passwordHash: defaultPassword },
      create: {
        phone: '699887766', firstName: 'Rose', lastName: 'Ngono',
        passwordHash: defaultPassword, role: 'MERCHANT', language: 'fr',
        wallet: { create: { balance: 0 } },
        loyaltyPoints: { create: { points: 0 } },
      },
    });
    const merchant = await prisma.merchantProfile.upsert({
      where: { userId: merchantUser.id },
      update: {},
      create: {
        userId: merchantUser.id,
        shopName: 'Mama Ngono - Alimentation',
        shopAddress: 'Marché Mboppi, Douala',
        shopLat: 4.0550, shopLng: 9.7700,
        category: 'alimentation',
        description: 'Fruits, légumes frais et produits locaux du marché',
        isOpen: true,
      },
    });

    const existingProducts = await prisma.product.count({ where: { merchantId: merchant.id } });
    if (existingProducts === 0) {
      const products = [
        { name: 'Plantains mûrs (régime)', price: 2000, category: 'fruits' },
        { name: 'Tomates fraîches (seau)', price: 3500, category: 'légumes' },
        { name: 'Arachides grillées (1kg)', price: 1500, category: 'épicerie' },
        { name: 'Piment frais (tas)', price: 500, category: 'condiments' },
        { name: 'Huile de palme (1L)', price: 1200, category: 'épicerie' },
        { name: 'Macabo (5 pièces)', price: 1000, category: 'tubercules' },
        { name: 'Poisson fumé (lot)', price: 4000, category: 'poisson' },
        { name: 'Ndolé préparé (portion)', price: 2500, category: 'plats' },
      ];
      for (const product of products) {
        await prisma.product.create({
          data: { merchantId: merchant.id, ...product, isAvailable: true },
        });
      }
    }

    res.json({
      success: true,
      message: 'Seed terminé ! Comptes de test créés.',
      comptes: {
        admin: '600000000 / admin237go',
        passager: '691234567 / test237go',
        chauffeur: '698765432 / test237go',
        marchand: '699887766 / test237go',
      },
    });
  } catch (error: any) {
    console.error('Seed error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export { router as seedRouter };
