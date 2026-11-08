/**
 * Vérifie, par de vraies requêtes sur l'API LOCALE, qu'aucune donnée sensible ne fuite.
 * Crée en base de test : un chauffeur (avec documents + code de réinitialisation),
 * un passager, un marchand (avec pièce d'identité) et un véhicule (avec documents).
 */
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');

const API = process.env.API_URL || 'http://localhost:3099';
const url = process.env.DATABASE_URL || '';
if (!/localhost:55433\/go237load/.test(url) || !/localhost/.test(API)) { console.error('REFUS: test local uniquement'); process.exit(1); }
const prisma = new PrismaClient({ datasources: { db: { url } } });
const SECRET = process.env.JWT_SECRET;

// Valeurs "piégées" : si elles apparaissent dans une réponse, c'est une fuite
const SECRETS = {
  passwordHash: '$2a$12$FAKEHASHFAKEHASHFAKEHASHFAKEHASH',
  resetOtp: '424242',
  cni: 'CNI-SECRET-123',
  license: 'PERMIS-SECRET-456',
  cniPhoto: 'https://x/cni-secret.jpg',
  ownerIdPhoto: 'https://x/gerant-cni-secret.jpg',
  regPhoto: 'https://x/registre-secret.jpg',
  vehicleOwnerId: 'https://x/proprio-cni-secret.jpg',
  insurance: 'https://x/assurance-secret.jpg',
  localContact: '699111222',
};

let fails = 0;
const check = (name, json) => {
  const text = JSON.stringify(json);
  const leaked = Object.entries(SECRETS).filter(([, v]) => text.includes(v)).map(([k]) => k);
  const forbiddenKeys = ['passwordHash', 'resetOtp', 'resetOtpExpiry', 'ownerIdPhoto', 'businessRegPhoto', 'cniPhoto', 'licensePhoto', 'cniNumber', 'licenseNumber', 'registrationPhoto', 'insurancePhoto', 'localContactPhone']
    .filter((k) => new RegExp(`"${k}"`).test(text));
  const ok = leaked.length === 0 && forbiddenKeys.length === 0;
  console.log(`${ok ? 'OK   ' : 'FUITE'} ${name}${ok ? '' : ` -> valeurs: ${leaked.join(', ') || '-'} | champs: ${forbiddenKeys.join(', ') || '-'}`}`);
  if (!ok) fails++;
  return json;
};

const call = async (method, path, token, body) => {
  const r = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => null) };
};

(async () => {
  const phone = () => `6${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const driverId = randomUUID(), passengerId = randomUUID(), merchantUserId = randomUUID(), ownerId = randomUUID();
  const base = (id, role) => ({ id, phone: phone(), firstName: 'T', lastName: role, role, passwordHash: SECRETS.passwordHash, resetOtp: SECRETS.resetOtp, resetOtpExpiry: new Date(Date.now() + 600000) });

  await prisma.user.create({ data: { ...base(driverId, 'DRIVER'), wallet: { create: { balance: 100000 } }, loyaltyPoints: { create: {} },
    driverProfile: { create: { licenseNumber: SECRETS.license, licenseExpiry: new Date('2030-01-01'), cniNumber: SECRETS.cni, cniPhoto: SECRETS.cniPhoto, licensePhoto: SECRETS.cniPhoto, vehicleType: 'MOTO', vehiclePlate: 'LT-1', vehicleBrand: 'Yamaha', verificationStatus: 'VERIFIED', isOnline: true, currentLat: 4.05, currentLng: 9.75 } } } });
  await prisma.user.create({ data: { ...base(passengerId, 'PASSENGER'), wallet: { create: { balance: 100000 } }, loyaltyPoints: { create: {} } } });
  await prisma.user.create({ data: { ...base(merchantUserId, 'MERCHANT'), wallet: { create: {} }, loyaltyPoints: { create: {} },
    merchantProfile: { create: { shopName: 'Boutique test', shopAddress: 'Douala', shopLat: 4.05, shopLng: 9.75, category: 'restaurant', ownerIdPhoto: SECRETS.ownerIdPhoto, businessRegPhoto: SECRETS.regPhoto, verificationStatus: 'VERIFIED', products: { create: [{ name: 'Ndolé', price: 2000, category: 'plats' }] } } } } });
  await prisma.user.create({ data: { ...base(ownerId, 'PASSENGER'), wallet: { create: {} }, loyaltyPoints: { create: {} } } });
  const vehicle = await prisma.vehicle.create({ data: { ownerId, type: 'CAR_ECONOMY', brand: 'Toyota', model: 'Yaris', year: 2019, plate: 'LT-V1', pricePerDay: 20000, locationLat: 4.05, locationLng: 9.75, locationAddress: 'Douala', ownerIdPhoto: SECRETS.vehicleOwnerId, registrationPhoto: SECRETS.regPhoto, insurancePhoto: SECRETS.insurance, localContactPhone: SECRETS.localContact, verificationStatus: 'VERIFIED' } });
  const merchant = await prisma.merchantProfile.findUnique({ where: { userId: merchantUserId } });

  const tP = jwt.sign({ userId: passengerId }, SECRET, { expiresIn: '1h' });
  const tD = jwt.sign({ userId: driverId }, SECRET, { expiresIn: '1h' });

  // 1) /auth/me (passager et chauffeur) : pas de secrets
  const meP = await call('GET', '/api/auth/me', tP);
  check('/auth/me (passager)', meP.json);
  // Le chauffeur voit SES documents (normal), mais jamais ses secrets
  const meD = await call('GET', '/api/auth/me', tD);
  const meDText = JSON.stringify(meD.json);
  const okD = !meDText.includes(SECRETS.passwordHash) && !meDText.includes(SECRETS.resetOtp) && !/"passwordHash"|"resetOtp"/.test(meDText);
  console.log(`${okD ? 'OK   ' : 'FUITE'} /auth/me (chauffeur) : ni mot de passe chiffré ni code de réinitialisation`);
  if (!okD) fails++;
  console.log(`      champs utiles présents : firstName=${!!meP.json?.data?.firstName} role=${!!meP.json?.data?.role} wallet=${!!meP.json?.data?.wallet} driverProfile.vehicleType=${meD.json?.data?.driverProfile?.vehicleType}`);

  // 2) Course : le passager commande, le chauffeur accepte -> réponse vue par le chauffeur ET envoyée au passager
  const ride = await call('POST', '/api/rides', tP, { pickupLat: 4.05, pickupLng: 9.75, pickupAddress: 'A', dropoffLat: 4.06, dropoffLng: 9.77, dropoffAddress: 'B', vehicleType: 'MOTO', paymentMethod: 'CASH' });
  const accepted = await call('PATCH', `/api/rides/${ride.json?.data?.id}/accept`, tD);
  check('acceptation de course (données du chauffeur vues par le passager)', accepted.json);
  const drv = accepted.json?.data?.driver;
  console.log(`      champs utiles présents : nom=${drv?.firstName} tel=${!!drv?.phone} vehicule=${drv?.driverProfile?.vehicleBrand} plaque=${drv?.driverProfile?.vehiclePlate} note=${drv?.driverProfile?.averageRating}`);

  // 3) Boutiques : liste et fiche
  const list = await call('GET', '/api/market/merchants?lat=4.05&lng=9.75', tP);
  check('liste des boutiques', list.json);
  console.log(`      boutique trouvée dans la liste : ${list.json?.data?.some((m) => m.id === merchant.id)}`);
  const detail = await call('GET', `/api/market/merchants/${merchant.id}`, tP);
  check('fiche boutique', detail.json);
  console.log(`      produits=${detail.json?.data?.products?.length} gérant=${detail.json?.data?.user?.firstName}`);

  // 4) Véhicules : liste et fiche
  const vl = await call('GET', '/api/rentals/vehicles?lat=4.05&lng=9.75', tP);
  check('liste des véhicules', vl.json);
  const vd = await call('GET', `/api/rentals/vehicles/${vehicle.id}`, tP);
  check('fiche véhicule', vd.json);
  console.log(`      véhicule=${vd.json?.data?.brand} propriétaire=${vd.json?.data?.owner?.firstName}`);

  console.log(fails === 0 ? '\nAUCUNE FUITE DÉTECTÉE' : `\n${fails} FUITE(S)`);
  await prisma.$disconnect();
  process.exit(fails ? 1 : 0);
})().catch(async (e) => { console.error('Erreur:', e.message); await prisma.$disconnect(); process.exit(1); });
