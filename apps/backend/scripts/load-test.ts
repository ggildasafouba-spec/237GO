/**
 * TEST DE CHARGE — à lancer UNIQUEMENT contre une API locale + base de test jetable.
 *
 * Simule des utilisateurs réalistes, par paliers croissants :
 *  - PASSAGERS : connexion temps réel (Socket.IO) + une action toutes les ~3 s
 *    (profil, solde, estimation, boutiques, commande puis annulation de course) ;
 *  - CHAUFFEURS (10 %) : en ligne, position GPS envoyée toutes les 5 s.
 *
 * Mesure à chaque palier : requêtes/s, temps de réponse (médiane, p95, p99), erreurs.
 *
 * Usage : DATABASE_URL=...  API_URL=http://localhost:3099  JWT_SECRET=...  npx ts-node scripts/load-test.ts
 */
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { io as ioClient, Socket } from 'socket.io-client';
import { PrismaClient } from '@prisma/client';

const API = process.env.API_URL || 'http://localhost:3099';
const DB = process.env.DATABASE_URL || '';
const SECRET = process.env.JWT_SECRET || '';

// Garde-fous : jamais contre la production
if (!/localhost|127\.0\.0\.1/.test(API) || !/localhost:55433\/go237load/.test(DB)) {
  console.error('REFUS : ce test ne tourne que contre une API locale et la base de test localhost:55433/go237load');
  process.exit(1);
}

const STAGES = (process.env.STAGES || '100,300,600,1000,1500').split(',').map(Number);
const WARMUP_MS = 10_000;
const MEASURE_MS = Number(process.env.MEASURE_MS || 30_000);
const THINK_MIN_MS = 2000;
const THINK_MAX_MS = 4000;
const DRIVER_RATIO = 0.1;

const prisma = new PrismaClient({ datasources: { db: { url: DB } } });

// Douala, avec dispersion de quelques km
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const near = () => ({ lat: 4.05 + rnd(-0.04, 0.04), lng: 9.75 + rnd(-0.04, 0.04) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Base des numéros configurable : permet de relancer le test sans réinitialiser la base
let phoneSeq = Number(process.env.PHONE_BASE || 10_000_000);
const nextPhone = () => `6${String(phoneSeq++).padStart(8, '0')}`;

interface Sample { ms: number; ok: boolean; name: string; status: number }
let samples: Sample[] = [];
let measuring = false;
let socketConnectFailures = 0;
let socketsConnected = 0;
let locationsSent = 0;
let rideRequestsReceived = 0;

async function call(name: string, method: string, path: string, token: string, body?: unknown): Promise<any> {
  const t0 = performance.now();
  let status = 0;
  let json: any = null;
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    status = res.status;
    json = await res.json().catch(() => null);
  } catch {
    status = 0; // timeout / connexion refusée
  }
  if (measuring) samples.push({ ms: performance.now() - t0, ok: status >= 200 && status < 300, name, status });
  return json;
}

// ---------- Préparation des comptes (directement en base, sans bcrypt, pour aller vite) ----------
async function seedUsers(count: number, role: 'PASSENGER' | 'DRIVER') {
  const ids = Array.from({ length: count }, () => randomUUID());
  await prisma.user.createMany({
    data: ids.map((id, i) => ({ id, phone: nextPhone(), firstName: 'Load', lastName: `${role}${i}`, role })),
  });
  await prisma.wallet.createMany({ data: ids.map((userId) => ({ userId, balance: 100000 })) });
  await prisma.loyaltyPoints.createMany({ data: ids.map((userId) => ({ userId, points: 0 })) });
  if (role === 'DRIVER') {
    await prisma.driverProfile.createMany({
      data: ids.map((userId, i) => {
        const p = near();
        return {
          userId,
          licenseNumber: `LT${i}`,
          licenseExpiry: new Date('2030-01-01'),
          cniNumber: `CNI${i}`,
          vehicleType: i % 2 === 0 ? 'MOTO' : 'CAR_ECONOMY',
          vehiclePlate: `LT-${i}`,
          verificationStatus: 'VERIFIED',
          isOnline: true,
          currentLat: p.lat,
          currentLng: p.lng,
        };
      }),
    });
  }
  return ids.map((id) => jwt.sign({ userId: id }, SECRET, { expiresIn: '2h' }));
}

async function seedMerchants() {
  const ids = Array.from({ length: 20 }, () => randomUUID());
  await prisma.user.createMany({
    data: ids.map((id, i) => ({ id, phone: nextPhone(), firstName: 'Shop', lastName: `${i}`, role: 'MERCHANT' })),
  });
  for (const [i, userId] of ids.entries()) {
    const p = near();
    await prisma.merchantProfile.create({
      data: {
        userId, shopName: `Boutique ${i}`, shopAddress: 'Douala', shopLat: p.lat, shopLng: p.lng,
        category: i % 2 ? 'restaurant' : 'alimentation', verificationStatus: 'VERIFIED',
        products: { create: Array.from({ length: 10 }, (_, j) => ({ name: `Produit ${j}`, price: 500 + j * 100, category: 'plats' })) },
      },
    });
  }
}

function openSocket(token: string): Promise<Socket | null> {
  return new Promise((resolve) => {
    const s = ioClient(API, { auth: { token }, transports: ['websocket'], reconnection: false, timeout: 15_000 });
    s.on('connect', () => { socketsConnected++; resolve(s); });
    s.on('connect_error', () => { socketConnectFailures++; resolve(null); });
    s.on('new_ride_request', () => { rideRequestsReceived++; });
  });
}

const sockets: Socket[] = [];
let stopping = false;

// ---------- Comportement d'un passager ----------
async function passenger(token: string) {
  const s = await openSocket(token);
  if (s) sockets.push(s);
  await sleep(rnd(0, THINK_MAX_MS)); // désynchroniser les utilisateurs
  while (!stopping) {
    const r = Math.random();
    const a = near();
    const b = near();
    if (r < 0.3) {
      await call('profil (/auth/me)', 'GET', '/api/auth/me', token);
    } else if (r < 0.55) {
      await call('solde', 'GET', '/api/wallet/balance', token);
    } else if (r < 0.8) {
      await call('estimation course', 'POST', '/api/rides/estimate', token, {
        pickupLat: a.lat, pickupLng: a.lng, dropoffLat: b.lat, dropoffLng: b.lng, vehicleType: 'MOTO',
      });
    } else if (r < 0.92) {
      await call('liste boutiques', 'GET', `/api/market/merchants?lat=${a.lat}&lng=${a.lng}`, token);
    } else {
      const ride = await call('commande course', 'POST', '/api/rides', token, {
        pickupLat: a.lat, pickupLng: a.lng, pickupAddress: 'Départ test',
        dropoffLat: b.lat, dropoffLng: b.lng, dropoffAddress: 'Arrivée test',
        vehicleType: 'MOTO', paymentMethod: 'CASH',
      });
      const id = ride?.data?.id;
      if (id) {
        await sleep(rnd(1000, 3000));
        await call('annulation course', 'PATCH', `/api/rides/${id}/cancel`, token, { reason: 'test' });
      }
    }
    await sleep(rnd(THINK_MIN_MS, THINK_MAX_MS));
  }
}

// ---------- Comportement d'un chauffeur ----------
async function driver(token: string, vehicleType: string) {
  const s = await openSocket(token);
  if (!s) return;
  sockets.push(s);
  const p = near();
  s.emit('driver:online', { vehicleType, lat: p.lat, lng: p.lng });
  await sleep(rnd(0, 5000));
  while (!stopping) {
    p.lat += rnd(-0.0005, 0.0005);
    p.lng += rnd(-0.0005, 0.0005);
    s.emit('driver:location', { lat: p.lat, lng: p.lng });
    if (measuring) locationsSent++;
    await sleep(5000);
  }
}

function pct(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function main() {
  console.log(`Préparation des comptes pour ${STAGES[STAGES.length - 1]} utilisateurs max…`);
  await seedMerchants();
  const maxUsers = STAGES[STAGES.length - 1];
  const maxDrivers = Math.round(maxUsers * DRIVER_RATIO);
  const passengerTokens = await seedUsers(maxUsers - maxDrivers, 'PASSENGER');
  const driverTokens = await seedUsers(maxDrivers, 'DRIVER');

  let startedPassengers = 0;
  let startedDrivers = 0;
  const results: string[] = [];

  for (const total of STAGES) {
    const wantDrivers = Math.round(total * DRIVER_RATIO);
    const wantPassengers = total - wantDrivers;

    // Montée en charge progressive sur la durée de chauffe
    const toStart = (wantPassengers - startedPassengers) + (wantDrivers - startedDrivers);
    const gap = toStart > 0 ? WARMUP_MS / toStart : 0;
    while (startedDrivers < wantDrivers) {
      driver(driverTokens[startedDrivers], startedDrivers % 2 === 0 ? 'MOTO' : 'CAR_ECONOMY');
      startedDrivers++;
      await sleep(gap);
    }
    while (startedPassengers < wantPassengers) {
      passenger(passengerTokens[startedPassengers]);
      startedPassengers++;
      await sleep(gap);
    }
    await sleep(2000);

    // Mesure
    samples = [];
    locationsSent = 0;
    rideRequestsReceived = 0;
    measuring = true;
    await sleep(MEASURE_MS);
    measuring = false;

    const lat = samples.map((s) => s.ms).sort((a, b) => a - b);
    const errors = samples.filter((s) => !s.ok);
    const byStatus: Record<string, number> = {};
    for (const e of errors) byStatus[e.status || 'timeout'] = (byStatus[e.status || 'timeout'] || 0) + 1;
    const errPct = samples.length ? (errors.length / samples.length) * 100 : 0;

    const line =
      `PALIER ${String(total).padStart(5)} utilisateurs (${wantDrivers} chauffeurs) | ` +
      `${(samples.length / (MEASURE_MS / 1000)).toFixed(0)} req/s | ` +
      `médiane ${pct(lat, 50).toFixed(0)} ms, p95 ${pct(lat, 95).toFixed(0)} ms, p99 ${pct(lat, 99).toFixed(0)} ms | ` +
      `erreurs ${errPct.toFixed(2)} % ${JSON.stringify(byStatus)} | ` +
      `sockets ${socketsConnected} ok / ${socketConnectFailures} échecs | ` +
      `positions ${(locationsSent / (MEASURE_MS / 1000)).toFixed(0)}/s, demandes reçues ${rideRequestsReceived}`;
    console.log(line);
    results.push(line);

    // Détail par action au palier
    const names = [...new Set(samples.map((s) => s.name))];
    for (const n of names) {
      const l = samples.filter((s) => s.name === n).map((s) => s.ms).sort((a, b) => a - b);
      console.log(`   - ${n.padEnd(20)} n=${String(l.length).padStart(5)}  médiane ${pct(l, 50).toFixed(0)} ms  p95 ${pct(l, 95).toFixed(0)} ms`);
    }

    // Arrêt anticipé si le système est saturé
    if (errPct > 5 || pct(lat, 95) > 3000) {
      console.log('⛔ Saturation atteinte (erreurs > 5 % ou p95 > 3 s) : arrêt des paliers.');
      break;
    }
  }

  stopping = true;
  for (const s of sockets) s.disconnect();
  console.log('\n===== RÉSUMÉ =====');
  for (const r of results) console.log(r);
}

main()
  .catch((e) => console.error('Erreur du test :', e))
  .finally(async () => {
    await prisma.$disconnect();
    setTimeout(() => process.exit(0), 1000);
  });
