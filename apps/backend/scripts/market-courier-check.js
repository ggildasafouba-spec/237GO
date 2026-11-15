/**
 * Test LOCAL : livraison des commandes GO Market par les chauffeurs 237GO.
 * Usage : DATABASE_URL=...localhost:55433/go237load JWT_SECRET=... node scripts/market-courier-check.js
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
const api = async (method, path, t, body) => {
  const r = await fetch(API + '/api' + path, { method, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* vide */ }
  return { status: r.status, body: json };
};
const msg = (r) => `HTTP ${r.status} ${r.body?.message || ''}`;
const balance = async (userId) => (await prisma.wallet.findUnique({ where: { userId } })).balance;
const net = (a) => a - Math.round(a * 0.15);
const escrows = (serviceType, serviceId) => prisma.escrow.findMany({ where: { serviceType, serviceId }, orderBy: { createdAt: 'asc' } });
const POS = { lat: 3.8480, lng: 11.5021 };

const mkUser = (role, bal) => prisma.user.create({
  data: { id: randomUUID(), phone: phone(), firstName: 'T', lastName: role, role, wallet: { create: { balance: bal } }, loyaltyPoints: { create: {} } },
});
const goOnline = (t) => new Promise((resolve, reject) => {
  const s = io(API, { auth: { token: t }, transports: ['websocket'], reconnection: false });
  const requests = [];
  s.on('new_delivery_request', (d) => requests.push(d));
  s.on('connect', () => { s.once('driver:online_ok', () => resolve({ s, requests })); s.emit('driver:online', POS); });
  s.on('connect_error', reject);
});

(async () => {
  const customer = await mkUser('PASSENGER', 200000);
  const merchantUser = await mkUser('MERCHANT', 0);
  const d1 = await mkUser('DRIVER', 0);
  const d2 = await mkUser('DRIVER', 0); // solde 0 : une commande Market n'exige aucune commission d'avance
  for (const d of [d1, d2]) {
    await prisma.driverProfile.create({ data: { userId: d.id, licenseNumber: 'L', licenseExpiry: new Date('2030-01-01'), cniNumber: 'C', vehicleType: 'MOTO', vehiclePlate: 'LT', verificationStatus: 'VERIFIED' } });
  }
  const merchant = await prisma.merchantProfile.create({
    data: { userId: merchantUser.id, shopName: 'Chez Mama', shopAddress: 'Mvog-Mbi', shopLat: POS.lat, shopLng: POS.lng, category: 'restaurant', verificationStatus: 'VERIFIED' },
  });
  const product = await prisma.product.create({ data: { merchantId: merchant.id, name: 'Ndolé', price: 2500, category: 'Plats' } });
  const T = { c: token(customer.id), m: token(merchantUser.id), d1: token(d1.id), d2: token(d2.id) };
  const order = async (paymentMethod) => (await api('POST', '/market/orders', T.c, {
    merchantId: merchant.id, items: [{ productId: product.id, quantity: 2 }], deliveryAddress: 'Bastos', deliveryLat: 3.8667, deliveryLng: 11.5167, paymentMethod,
  })).body.data;

  const D1 = await goOnline(T.d1);
  const D2 = await goOnline(T.d2);

  console.log('\n=== Demande d\'un livreur ===');
  const cBefore = await balance(customer.id);
  const o1 = await order('WALLET');
  const total = o1.totalAmount, fee = o1.deliveryFee;
  check('commande payée (produits + livraison)', (await balance(customer.id)) === cBefore - total - fee, `${total} + ${fee} XAF`);

  const cash = await order('CASH');
  const rCash = await api('POST', `/market/orders/${cash.id}/request-courier`, T.m);
  check('commande en espèces : livreur 237GO refusé (message clair)', rCash.status === 400, msg(rCash));
  check('un client ne peut pas demander de livreur', (await api('POST', `/market/orders/${o1.id}/request-courier`, T.c)).status === 403);

  await api('PATCH', `/market/orders/${o1.id}/status`, T.m, { status: 'CONFIRMED' });
  const r1 = await api('POST', `/market/orders/${o1.id}/request-courier`, T.m);
  check('le restaurant demande un livreur 237GO', r1.status === 200, msg(r1));
  const deliveryId = r1.body?.data?.deliveryId;
  await sleep(800);
  const req1 = D1.requests.find((r) => r.deliveryId === deliveryId);
  check('les chauffeurs proches reçoivent la demande, présentée comme commande de restaurant', !!req1 && req1.isMarketOrder === true && /Chez Mama/.test(req1.packageDesc || ''), JSON.stringify(req1 && { isMarketOrder: req1.isMarketOrder, packageDesc: req1.packageDesc, prix: req1.estimatedPrice }));
  check('… prix affiché = frais de livraison de la commande', req1?.estimatedPrice === fee);
  check('2e demande pour la même commande : refusée', (await api('POST', `/market/orders/${o1.id}/request-courier`, T.m)).status === 409);
  const custCancel = await api('PATCH', `/deliveries/${deliveryId}/cancel`, T.c);
  check('le client ne peut pas annuler la livraison du restaurant', custCancel.status === 409, msg(custCancel));
  await api('PATCH', `/market/orders/${o1.id}/status`, T.m, { status: 'READY' });
  const selfDeliver = await api('PATCH', `/market/orders/${o1.id}/status`, T.m, { status: 'DELIVERED' });
  check('livreur demandé : le restaurant ne peut plus marquer « livrée » lui-même', selfDeliver.status === 409, msg(selfDeliver));

  console.log('\n=== Acceptation et partage du paiement ===');
  const cBeforeAccept = await balance(customer.id);
  const acc = await api('PATCH', `/deliveries/${deliveryId}/accept`, T.d1);
  check('chauffeur accepte (sans solde de commission : commande déjà payée)', acc.status === 200, msg(acc));
  check('… le client n\'est PAS redébité', (await balance(customer.id)) === cBeforeAccept);
  let [mEsc] = await escrows('MARKET', o1.id);
  let [dEsc] = await escrows('DELIVERY', deliveryId);
  check('… paiement partagé : produits → restaurant, frais → livreur', mEsc.amount === total && dEsc.amount === fee && dEsc.payeeId === d1.id && dEsc.status === 'HELD', `resto ${mEsc.amount}, livreur ${dEsc?.amount}`);
  const myOrders = await api('GET', '/market/my-orders', T.m);
  const seen = myOrders.body.data.find((o) => o.id === o1.id)?.courierDelivery;
  check('le restaurant voit le livreur (nom, téléphone)', seen?.status === 'ACCEPTED' && !!seen?.driver?.phone);
  const custOrders = await api('GET', '/market/orders', T.c);
  check('le client voit aussi le livreur', !!custOrders.body.data.find((o) => o.id === o1.id)?.courierDelivery?.driver?.firstName);

  console.log('\n=== Le livreur se désiste ===');
  const quit = await api('PATCH', `/deliveries/${deliveryId}/status`, T.d1, { status: 'CANCELLED' });
  check('désistement du livreur : accepté', quit.status === 200, msg(quit));
  [mEsc] = await escrows('MARKET', o1.id);
  const allD = await escrows('DELIVERY', deliveryId);
  check('… frais de livraison revenus à la commande, sans toucher au portefeuille du client',
    mEsc.amount === total + fee && allD[0].status === 'REFUNDED' && (await balance(customer.id)) === cBeforeAccept);
  check('… livraison reproposée aux chauffeurs', (await prisma.delivery.findUnique({ where: { id: deliveryId } })).status === 'PENDING');

  console.log('\n=== 2e livreur : récupère et livre ===');
  check('2e livreur accepte', (await api('PATCH', `/deliveries/${deliveryId}/accept`, T.d2)).status === 200);
  check('… l\'ancien livreur ne peut plus agir', (await api('PATCH', `/deliveries/${deliveryId}/status`, T.d1, { status: 'IN_TRANSIT' })).status === 403);
  await api('PATCH', `/deliveries/${deliveryId}/status`, T.d2, { status: 'PICKING_UP' });
  await api('PATCH', `/deliveries/${deliveryId}/status`, T.d2, { status: 'IN_TRANSIT' });
  check('commande récupérée → « en livraison »', (await prisma.marketOrder.findUnique({ where: { id: o1.id } })).status === 'DELIVERING');
  const lateQuit = await api('PATCH', `/deliveries/${deliveryId}/status`, T.d2, { status: 'CANCELLED' });
  check('commande récupérée : le livreur ne peut plus se désister', lateQuit.status === 409, msg(lateQuit));
  const lateCancel = await api('PATCH', `/market/orders/${o1.id}/status`, T.m, { status: 'CANCELLED' });
  check('… ni le restaurant annuler', lateCancel.status === 409, msg(lateCancel));
  await api('PATCH', `/deliveries/${deliveryId}/status`, T.d2, { status: 'DELIVERED' });
  check('livrée → commande « livrée »', (await prisma.marketOrder.findUnique({ where: { id: o1.id } })).status === 'DELIVERED');

  const mBefore = await balance(merchantUser.id);
  const dBefore = await balance(d2.id);
  const conf = await api('POST', `/market/orders/${o1.id}/confirm-reception`, T.c);
  check('le client confirme la réception (une seule fois)', conf.status === 200, msg(conf));
  check('… restaurant payé : produits − 15 %', (await balance(merchantUser.id)) === mBefore + net(total), `${net(total)} XAF`);
  check('… livreur payé : frais de livraison − 15 %', (await balance(d2.id)) === dBefore + net(fee), `${net(fee)} XAF`);
  check('… le 1er livreur (désisté) n\'a rien reçu', (await balance(d1.id)) === 0);
  check('… le client a payé exactement une fois (produits + livraison)', (await balance(customer.id)) === cBefore - total - fee);
  const again = await api('POST', `/market/orders/${o1.id}/confirm-reception`, T.c);
  check('2e confirmation : personne n\'est payé deux fois', again.status === 200 && (await balance(merchantUser.id)) === mBefore + net(total) && (await balance(d2.id)) === dBefore + net(fee));

  console.log('\n=== Le restaurant annule après l\'acceptation du livreur ===');
  const cB2 = await balance(customer.id);
  const o2 = await order('WALLET');
  const r2 = await api('POST', `/market/orders/${o2.id}/request-courier`, T.m);
  await api('PATCH', `/deliveries/${r2.body.data.deliveryId}/accept`, T.d1);
  let notified = false;
  D1.s.on('delivery_status_update', (e) => { if (e.deliveryId === r2.body.data.deliveryId && e.status === 'CANCELLED') notified = true; });
  const cancel2 = await api('PATCH', `/market/orders/${o2.id}/status`, T.m, { status: 'CANCELLED' });
  await sleep(500);
  check('annulation de la commande : OK', cancel2.status === 200, msg(cancel2));
  check('… client remboursé intégralement (produits + livraison)', (await balance(customer.id)) === cB2);
  check('… livraison annulée et livreur prévenu', (await prisma.delivery.findUnique({ where: { id: r2.body.data.deliveryId } })).status === 'CANCELLED' && notified);
  check('… le livreur n\'est pas payé', (await balance(d1.id)) === 0);

  console.log('\n=== Retrait de la demande / nouvelle demande ===');
  const o3 = await order('WALLET');
  const r3 = await api('POST', `/market/orders/${o3.id}/request-courier`, T.m);
  const c3 = await api('POST', `/market/orders/${o3.id}/cancel-courier`, T.m);
  check('le restaurant retire sa demande (aucun livreur encore)', c3.status === 200 && (await prisma.delivery.findUnique({ where: { id: r3.body.data.deliveryId } })).status === 'CANCELLED');
  check('… un livreur ne peut plus l\'accepter', (await api('PATCH', `/deliveries/${r3.body.data.deliveryId}/accept`, T.d1)).status === 400);
  const r3b = await api('POST', `/market/orders/${o3.id}/request-courier`, T.m);
  check('… et peut en redemander un', r3b.status === 200 && r3b.body.data.deliveryId === r3.body.data.deliveryId);

  console.log('\n=== Deux livreurs acceptent en même temps ===');
  const [a1, a2] = await Promise.all([
    api('PATCH', `/deliveries/${r3b.body.data.deliveryId}/accept`, T.d1),
    api('PATCH', `/deliveries/${r3b.body.data.deliveryId}/accept`, T.d2),
  ]);
  const winners = [a1, a2].filter((r) => r.status === 200).length;
  const [m3] = await escrows('MARKET', o3.id);
  const d3 = (await escrows('DELIVERY', r3b.body.data.deliveryId)).filter((e) => e.status === 'HELD');
  check('un seul livreur obtient la commande, argent cohérent',
    winners === 1 && d3.length === 1 && m3.amount + d3[0].amount === o3.totalAmount + o3.deliveryFee,
    `gagnants ${winners}, resto ${m3.amount} + livreur ${d3[0]?.amount}`);

  D1.s.disconnect(); D2.s.disconnect();
  console.log(fails === 0 ? '\nTOUS LES CONTROLES PASSENT' : `\n${fails} controle(s) en echec`);
  await prisma.$disconnect();
  process.exit(fails ? 1 : 0);
})().catch(async (e) => { console.error('Erreur:', e.stack || e.message); await prisma.$disconnect(); process.exit(1); });
