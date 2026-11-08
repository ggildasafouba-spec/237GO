/**
 * Rejoue, sur l'API LOCALE, le parcours "le chauffeur ne reçoit pas les courses".
 */
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');

const API = process.env.API_URL || 'http://localhost:3099';
const url = process.env.DATABASE_URL || '';
if (!/localhost:55433\/go237load/.test(url) || !/localhost/.test(API)) { console.error('REFUS: test local uniquement'); process.exit(1); }
const prisma = new PrismaClient({ datasources: { db: { url } } });
const SECRET = process.env.JWT_SECRET;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'OK   ' : 'ECHEC'} ${name}${detail ? ' — ' + detail : ''}`); if (!ok) fails++; };

const phone = () => `6${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const token = (id) => jwt.sign({ userId: id }, SECRET, { expiresIn: '1h' });
const connect = (t) => new Promise((resolve, reject) => {
  const s = io(API, { auth: { token: t }, transports: ['websocket'], reconnection: false });
  s.on('connect', () => resolve(s));
  s.on('connect_error', reject);
});
const waitEvent = (s, ev, ms = 4000) => new Promise((resolve) => {
  const t = setTimeout(() => { s.off(ev, h); resolve(null); }, ms);
  const h = (d) => { clearTimeout(t); s.off(ev, h); resolve(d); };
  s.on(ev, h);
});
const collect = (s, ev) => { const arr = []; s.on(ev, (d) => arr.push(d)); return arr; };
const post = async (path, t, body) => {
  const r = await fetch(API + path, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
};

(async () => {
  const pos = { lat: 4.0511, lng: 9.7679 };
  const passengerId = randomUUID(), driverId = randomUUID(), pendingDriverId = randomUUID();
  const mk = (id, role) => prisma.user.create({ data: { id, phone: phone(), firstName: 'T', lastName: role, role, wallet: { create: { balance: 100000 } }, loyaltyPoints: { create: {} } } });
  await mk(passengerId, 'PASSENGER');
  await mk(driverId, 'PASSENGER'); // pas encore approuvé
  await mk(pendingDriverId, 'PASSENGER');
  const profileData = (userId) => ({ userId, licenseNumber: 'L', licenseExpiry: new Date('2030-01-01'), cniNumber: 'C', vehicleType: 'MOTO', vehiclePlate: 'P' });
  await prisma.driverProfile.create({ data: profileData(driverId) });      // PENDING
  await prisma.driverProfile.create({ data: profileData(pendingDriverId) }); // PENDING

  const rideBody = { pickupLat: pos.lat, pickupLng: pos.lng, pickupAddress: 'A', dropoffLat: 4.06, dropoffLng: 9.78, dropoffAddress: 'B', vehicleType: 'MOTO', paymentMethod: 'CASH' };

  // 1) Le chauffeur se connecte AVANT son approbation (comme dans ton test)
  const sDriver = await connect(token(driverId));
  const received = collect(sDriver, 'new_ride_request');

  // 2) Une course est commandée AVANT qu'il soit en ligne
  const before = await post('/api/rides', token(passengerId), rideBody);
  const rideBeforeId = before?.data?.id;

  // 3) L'admin l'approuve (rôle DRIVER + dossier VERIFIED), sans qu'il se reconnecte
  await prisma.user.update({ where: { id: driverId }, data: { role: 'DRIVER' } });
  await prisma.driverProfile.update({ where: { userId: driverId }, data: { verificationStatus: 'VERIFIED' } });

  // 4) Il se met en ligne sur la MÊME connexion
  const okP = waitEvent(sDriver, 'driver:online_ok');
  sDriver.emit('driver:online', { lat: pos.lat, lng: pos.lng });
  const ok = await okP;
  check('chauffeur approuvé après connexion : mise en ligne acceptée', !!ok, ok ? `type ${ok.vehicleType}` : 'aucune réponse (ancien bug : ignorée en silence)');
  await sleep(500);
  check('course commandée AVANT la mise en ligne : reçue au rattrapage', received.some((r) => r.rideId === rideBeforeId));

  // 5) Une course commandée APRÈS la mise en ligne lui arrive normalement
  const after = await post('/api/rides', token(passengerId), rideBody);
  await sleep(1000);
  check('course commandée APRÈS la mise en ligne : reçue', received.some((r) => r.rideId === after?.data?.id));

  // 6) Un chauffeur dont le dossier est en attente reçoit un message clair
  const sPending = await connect(token(pendingDriverId));
  const errP = waitEvent(sPending, 'driver:online_error');
  sPending.emit('driver:online', { lat: pos.lat, lng: pos.lng });
  const err = await errP;
  check('dossier en attente : message clair', !!err?.message, err?.message || 'aucun message');
  sPending.disconnect();

  // 7) Coupure : le serveur le passe hors ligne, puis l'envoi de position le remet en ligne
  sDriver.disconnect();
  await sleep(800);
  const offline = await prisma.driverProfile.findUnique({ where: { userId: driverId } });
  check('après coupure : marqué hors ligne', offline.isOnline === false);
  const sDriver2 = await connect(token(driverId));
  sDriver2.emit('driver:location', { lat: pos.lat + 0.001, lng: pos.lng });
  await sleep(800);
  const healed = await prisma.driverProfile.findUnique({ where: { userId: driverId } });
  check('après reconnexion : la position le remet en ligne', healed.isOnline === true);

  // 8) Un passager ne peut pas se faire passer pour un chauffeur
  const sPass = await connect(token(passengerId));
  const passErrP = waitEvent(sPass, 'driver:online_error');
  sPass.emit('driver:online', { lat: pos.lat, lng: pos.lng });
  check('un passager ne peut pas se mettre en ligne comme chauffeur', !!(await passErrP));

  sDriver2.disconnect(); sPass.disconnect();
  console.log(fails === 0 ? '\nTOUS LES CONTROLES PASSENT' : `\n${fails} controle(s) en echec`);
  await prisma.$disconnect();
  process.exit(fails ? 1 : 0);
})().catch(async (e) => { console.error('Erreur:', e.message); await prisma.$disconnect(); process.exit(1); });
