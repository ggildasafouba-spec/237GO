import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Début du seeding...');

  // Admin
  const adminPassword = await bcrypt.hash('admin237go', 12);
  const admin = await prisma.user.upsert({
    where: { phone: '600000000' },
    update: {},
    create: {
      phone: '600000000',
      firstName: 'Admin',
      lastName: '237GO',
      role: 'ADMIN',
      language: 'fr',
      wallet: { create: { balance: 0 } },
      loyaltyPoints: { create: { points: 0 } },
    },
  });
  console.log('✅ Admin créé:', admin.phone);

  // Passagers de test
  const passengers = [
    { phone: '691234567', firstName: 'Jean', lastName: 'Mballa' },
    { phone: '677654321', firstName: 'Marie', lastName: 'Ngo' },
    { phone: '655112233', firstName: 'Claude', lastName: 'Eto' },
  ];

  for (const p of passengers) {
    await prisma.user.upsert({
      where: { phone: p.phone },
      update: {},
      create: {
        ...p,
        role: 'PASSENGER',
        language: 'fr',
        wallet: { create: { balance: 5000 } },
        loyaltyPoints: { create: { points: 50 } },
      },
    });
  }
  console.log('✅ Passagers créés');

  // Chauffeurs de test
  const drivers = [
    { phone: '698765432', firstName: 'Aimé', lastName: 'Fotso', vehicleType: 'MOTO' as const, plate: 'LT 1234 A' },
    { phone: '677112233', firstName: 'Paul', lastName: 'Tchamba', vehicleType: 'CAR_ECONOMY' as const, plate: 'CE 5678 B' },
    { phone: '655443322', firstName: 'Eric', lastName: 'Kamga', vehicleType: 'CAR_COMFORT' as const, plate: 'LT 9012 C' },
  ];

  for (const d of drivers) {
    const user = await prisma.user.upsert({
      where: { phone: d.phone },
      update: {},
      create: {
        phone: d.phone,
        firstName: d.firstName,
        lastName: d.lastName,
        role: 'DRIVER',
        language: 'fr',
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
  console.log('✅ Chauffeurs créés');

  // Marchand de test
  const merchantUser = await prisma.user.upsert({
    where: { phone: '699887766' },
    update: {},
    create: {
      phone: '699887766',
      firstName: 'Rose',
      lastName: 'Ngono',
      role: 'MERCHANT',
      language: 'fr',
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
      shopLat: 4.0550,
      shopLng: 9.7700,
      category: 'alimentation',
      description: 'Fruits, légumes frais et produits locaux du marché',
      isOpen: true,
    },
  });

  // Produits
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
      data: {
        merchantId: merchant.id,
        ...product,
        isAvailable: true,
      },
    });
  }
  console.log('✅ Marchand et produits créés');

  // Covoiturage de test
  const driverUser = await prisma.user.findUnique({ where: { phone: '677112233' } });
  if (driverUser) {
    await prisma.carpool.create({
      data: {
        driverId: driverUser.id,
        departureLat: 4.0511,
        departureLng: 9.7679,
        departureCity: 'Douala',
        departureAddress: 'Rond-point Deido',
        arrivalLat: 3.8480,
        arrivalLng: 11.5021,
        arrivalCity: 'Yaoundé',
        arrivalAddress: 'Poste Centrale',
        departureTime: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // dans 2 jours
        availableSeats: 3,
        pricePerSeat: 5000,
        description: 'Voiture climatisée, départ ponctuel. Bagages acceptés.',
        status: 'ACTIVE',
      },
    });
  }
  console.log('✅ Covoiturage de test créé');

  console.log('🎉 Seeding terminé !');
  console.log('');
  console.log('📋 Comptes de test:');
  console.log('   Admin:     600000000 / admin237go');
  console.log('   Passager:  691234567');
  console.log('   Chauffeur: 698765432');
  console.log('   Marchand:  699887766');
}

main()
  .catch((e) => {
    console.error('❌ Erreur de seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
