/**
 * Test de bout en bout des services 237GO sur l'API LOCALE (jamais la production) :
 * livraison, Market, location, covoiturage, retraits.
 * Vérifie le parcours complet ET les mouvements d'argent (séquestre, commission 15 %).
 *
 * Usage : DATABASE_URL=...localhost:55433/go237load JWT_SECRET=... node scripts/services-flow-check.js
 */
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');

const API = process.env.API_URL || 'http://localhost:3099';
const url = process.env.DATABASE_URL || '';
if (!/localhost:55433\/go237load/.test(url) || !/localhost/.test(API)) {
  console.error('REFUS: test local uniquement');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });
const SECRET = process.env.JWT_SECRET;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const COMMISSION = 0.15;

let fails = 0;
const warnings = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'OK   ' : 'ECHEC'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails++;
};
const warn = (name, detail) => { console.log(`NOTE  ${name} — ${detail}`); warnings.push(name); };

const phone = () => `6${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const token = (id) => jwt.sign({ userId: id }, SECRET, { expiresIn: '1h' });
const api = async (method, path, t, body) => {
  const r = await fetch(API + '/api' + path, {
    method,
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await r.json(); } catch { /* corps vide */ }
  return { status: r.status, body: json };
};
const balance = async (userId) => (await prisma.wallet.findUnique({ where: { userId } })).balance;
const escrowOf = (serviceType, serviceId) =>
  prisma.escrow.findFirst({ where: { serviceType, serviceId }, orderBy: { createdAt: 'desc' } });
const net = (amount) => amount - Math.round(amount * COMMISSION);
const msg = (r) => `HTTP ${r.status} ${r.body?.message || JSON.stringify(r.body?.errors || '').slice(0, 120)}`;

const mkUser = (role, walletBalance) => {
  const id = randomUUID();
  return prisma.user.create({
    data: {
      id, phone: phone(), firstName: 'Test', lastName: role, role,
      wallet: { create: { balance: walletBalance } },
      loyaltyPoints: { create: {} },
    },
  });
};

const POS = { lat: 3.8480, lng: 11.5021 }; // Yaoundé centre
const DOC = 'https://example.com/doc.jpg';

(async () => {
  // ---------- Comptes ----------
  const client = await mkUser('PASSENGER', 200000);
  const client2 = await mkUser('PASSENGER', 200000);
  const driver = await mkUser('DRIVER', 5000);
  const poorDriver = await mkUser('DRIVER', 0);
  const merchantUser = await mkUser('MERCHANT', 0);
  const owner = await mkUser('PASSENGER', 0);
  const admin = await mkUser('ADMIN', 0);
  const profile = (userId) => ({
    userId, licenseNumber: 'L', licenseExpiry: new Date('2030-01-01'), cniNumber: 'C',
    vehicleType: 'MOTO', vehiclePlate: 'LT-' + userId.slice(0, 4), verificationStatus: 'VERIFIED',
  });
  await prisma.driverProfile.create({ data: profile(driver.id) });
  await prisma.driverProfile.create({ data: profile(poorDriver.id) });
  const T = {
    client: token(client.id), client2: token(client2.id), driver: token(driver.id),
    poorDriver: token(poorDriver.id), merchant: token(merchantUser.id), owner: token(owner.id), admin: token(admin.id),
  };

  // =====================================================================
  console.log('\n=== 1. LIVRAISON ===');
  const sDriver = await new Promise((resolve, reject) => {
    const s = io(API, { auth: { token: T.driver }, transports: ['websocket'], reconnection: false });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
  const deliveryRequests = [];
  sDriver.on('new_delivery_request', (d) => deliveryRequests.push(d));
  const onlineOk = new Promise((r) => { sDriver.once('driver:online_ok', r); setTimeout(() => r(null), 4000); });
  sDriver.emit('driver:online', POS);
  check('livreur en ligne', !!(await onlineOk));

  const deliveryBody = (paymentMethod) => ({
    pickupLat: POS.lat, pickupLng: POS.lng, pickupAddress: 'Poste centrale', pickupContact: '699990001',
    dropoffLat: 3.8667, dropoffLng: 11.5167, dropoffAddress: 'Bastos', dropoffContact: '699990002',
    packageType: 'SMALL_PACKAGE', paymentMethod,
  });

  const cBefore = await balance(client.id);
  const dCreate = await api('POST', '/deliveries', T.client, deliveryBody('WALLET'));
  const delivery = dCreate.body?.data;
  check('livraison créée', dCreate.status === 201 && !!delivery?.id, msg(dCreate));
  await sleep(800);
  check('le livreur reçoit la demande en temps réel', deliveryRequests.some((d) => d.deliveryId === delivery?.id));

  const dAccept = await api('PATCH', `/deliveries/${delivery.id}/accept`, T.driver);
  check('livreur accepte', dAccept.status === 200, msg(dAccept));
  const price = delivery.estimatedPrice;
  check('client débité du prix (séquestre)', (await balance(client.id)) === cBefore - price, `${price} XAF`);

  const dAgain = await api('PATCH', `/deliveries/${delivery.id}/accept`, T.poorDriver);
  check('un 2e livreur ne peut pas reprendre la livraison', dAgain.status >= 400, msg(dAgain));

  for (const st of ['PICKING_UP', 'IN_TRANSIT', 'DELIVERED']) {
    const r = await api('PATCH', `/deliveries/${delivery.id}/status`, T.driver, { status: st });
    check(`statut ${st}`, r.status === 200, msg(r));
  }
  const drvBefore = await balance(driver.id);
  const dConfirm = await api('POST', `/deliveries/${delivery.id}/confirm-reception`, T.client);
  check('expéditeur confirme la réception', dConfirm.status === 200, msg(dConfirm));
  check('séquestre libéré', (await escrowOf('DELIVERY', delivery.id))?.status === 'RELEASED');
  check('livreur payé (prix − 15 %)', (await balance(driver.id)) === drvBefore + net(price), `${net(price)} XAF`);

  // Espèces : un livreur sans solde pour la commission ne peut pas accepter
  const dCash = await api('POST', '/deliveries', T.client, deliveryBody('CASH'));
  const dCashAccept = await api('PATCH', `/deliveries/${dCash.body.data.id}/accept`, T.poorDriver);
  check('espèces : livreur sans solde de commission refusé', dCashAccept.status === 402, msg(dCashAccept));

  // Annulation par le livreur après acceptation (WALLET) : remboursement
  const dCancel = await api('POST', '/deliveries', T.client, deliveryBody('WALLET'));
  const cBeforeCancel = await balance(client.id);
  await api('PATCH', `/deliveries/${dCancel.body.data.id}/accept`, T.driver);
  const rCancel = await api('PATCH', `/deliveries/${dCancel.body.data.id}/status`, T.driver, { status: 'CANCELLED' });
  check('livreur annule', rCancel.status === 200, msg(rCancel));
  check('expéditeur remboursé intégralement', (await balance(client.id)) === cBeforeCancel);

  // Annulation par l'EXPÉDITEUR d'une livraison en attente
  const dPending = await api('POST', '/deliveries', T.client, deliveryBody('WALLET'));
  const senderCancel = await api('PATCH', `/deliveries/${dPending.body.data.id}/cancel`, T.client);
  if (senderCancel.status !== 200) {
    warn('expéditeur : annulation d\'une livraison en attente', `aucune route (${senderCancel.status}) : la livraison reste en attente si personne n'accepte`);
  } else {
    check('expéditeur annule une livraison en attente', true);
  }
  sDriver.disconnect();

  // =====================================================================
  console.log('\n=== 2. MARKET ===');
  const merchant = await prisma.merchantProfile.create({
    data: {
      userId: merchantUser.id, shopName: 'Chez Test', shopAddress: 'Mvog-Mbi', shopLat: POS.lat, shopLng: POS.lng,
      category: 'restaurant', verificationStatus: 'VERIFIED', ownerIdPhoto: DOC, shopPhoto: DOC,
    },
  });
  const pCreate = await api('POST', '/market/products', T.merchant, { name: 'Ndolé', price: 2500, category: 'Plats' });
  check('marchand ajoute un produit', pCreate.status === 201, msg(pCreate));
  const product = pCreate.body?.data;
  const orderItems = [{ productId: product.id, quantity: 2 }];
  const dropoff = { deliveryLat: 3.8667, deliveryLng: 11.5167 };

  const quote = await api('POST', '/market/orders/quote', T.client, { merchantId: merchant.id, items: orderItems, ...dropoff });
  check('devis', quote.status === 200, msg(quote));
  const grandTotal = quote.body?.data?.grandTotal;

  const cBeforeOrder = await balance(client.id);
  const oCreate = await api('POST', '/market/orders', T.client, {
    merchantId: merchant.id, items: orderItems, deliveryAddress: 'Bastos', ...dropoff, paymentMethod: 'WALLET',
  });
  const order = oCreate.body?.data;
  check('commande passée', oCreate.status === 201, msg(oCreate));
  check('montant débité = devis', (await balance(client.id)) === cBeforeOrder - grandTotal, `${grandTotal} XAF`);

  for (const st of ['CONFIRMED', 'PREPARING', 'READY', 'DELIVERING', 'DELIVERED']) {
    const r = await api('PATCH', `/market/orders/${order.id}/status`, T.merchant, { status: st });
    check(`commande ${st}`, r.status === 200, msg(r));
  }
  const mBefore = await balance(merchantUser.id);
  const oConfirm = await api('POST', `/market/orders/${order.id}/confirm-reception`, T.client);
  check('client confirme la réception', oConfirm.status === 200, msg(oConfirm));
  check('marchand payé (total − 15 %)', (await balance(merchantUser.id)) === mBefore + net(grandTotal), `${net(grandTotal)} XAF`);
  const mPaid = await balance(merchantUser.id);
  const oConfirmAgain = await api('POST', `/market/orders/${order.id}/confirm-reception`, T.client);
  check('2e confirmation (double appui) : pas d\'erreur', oConfirmAgain.status === 200, msg(oConfirmAgain));
  check('2e confirmation : marchand PAS payé deux fois', (await balance(merchantUser.id)) === mPaid);
  const [dbl1, dbl2] = await Promise.all([
    api('POST', `/market/orders/${order.id}/confirm-reception`, T.client),
    api('POST', `/market/orders/${order.id}/confirm-reception`, T.client),
  ]);
  check('confirmations simultanées : toujours un seul paiement', dbl1.status === 200 && dbl2.status === 200 && (await balance(merchantUser.id)) === mPaid);
  const stranger = await api('POST', `/market/orders/${order.id}/confirm-reception`, T.client2);
  check('un inconnu ne peut pas confirmer la commande d\'un autre', stranger.status === 404, msg(stranger));

  const relivrer = await api('PATCH', `/market/orders/${order.id}/status`, T.merchant, { status: 'CANCELLED' });
  check('commande livrée : ne peut plus être annulée', relivrer.status === 409, msg(relivrer));

  // Annulation par le marchand : remboursement
  const cBeforeO2 = await balance(client.id);
  const o2 = await api('POST', '/market/orders', T.client, {
    merchantId: merchant.id, items: orderItems, deliveryAddress: 'Bastos', ...dropoff, paymentMethod: 'WALLET',
  });
  await api('PATCH', `/market/orders/${o2.body.data.id}/status`, T.merchant, { status: 'CANCELLED' });
  check('marchand annule : client remboursé', (await balance(client.id)) === cBeforeO2);

  // Solde insuffisant : pas de commande fantôme
  const broke = await mkUser('PASSENGER', 100);
  const oBroke = await api('POST', '/market/orders', token(broke.id), {
    merchantId: merchant.id, items: orderItems, deliveryAddress: 'Bastos', ...dropoff, paymentMethod: 'WALLET',
  });
  const ghost = await prisma.marketOrder.count({ where: { customerId: broke.id } });
  check('solde insuffisant : commande refusée et non créée', oBroke.status === 400 && ghost === 0, msg(oBroke));

  // Boutique fermée
  await prisma.merchantProfile.update({ where: { id: merchant.id }, data: { isOpen: false } });
  const cBeforeClosed = await balance(client.id);
  const oClosed = await api('POST', '/market/orders', T.client, {
    merchantId: merchant.id, items: orderItems, deliveryAddress: 'Bastos', ...dropoff, paymentMethod: 'WALLET',
  });
  check('boutique fermée : commande refusée', oClosed.status === 409, msg(oClosed));
  check('boutique fermée : client non débité', (await balance(client.id)) === cBeforeClosed);
  const qClosed = await api('POST', '/market/orders/quote', T.client, { merchantId: merchant.id, items: orderItems, ...dropoff });
  check('boutique fermée : devis refusé (pas de paiement direct)', qClosed.status === 409, msg(qClosed));
  await prisma.merchantProfile.update({ where: { id: merchant.id }, data: { isOpen: true } });

  // Boutique non vérifiée
  await prisma.merchantProfile.update({ where: { id: merchant.id }, data: { verificationStatus: 'PENDING' } });
  const oUnverified = await api('POST', '/market/orders', T.client, {
    merchantId: merchant.id, items: orderItems, deliveryAddress: 'Bastos', ...dropoff, paymentMethod: 'WALLET',
  });
  check('boutique non vérifiée : commande refusée', oUnverified.status === 403, msg(oUnverified));
  await prisma.merchantProfile.update({ where: { id: merchant.id }, data: { verificationStatus: 'VERIFIED' } });

  // =====================================================================
  console.log('\n=== 3. LOCATION ===');
  const vCreate = await api('POST', '/rentals/vehicles', T.owner, {
    type: 'CAR_ECONOMY', brand: 'Toyota', model: 'Corolla', year: 2018, plate: 'CE-TEST-01', pricePerDay: 25000,
    locationLat: POS.lat, locationLng: POS.lng, locationAddress: 'Yaoundé',
    vehiclePhoto: DOC, registrationPhoto: DOC, insurancePhoto: DOC, ownerIdPhoto: DOC,
    localContactName: 'Paul', localContactPhone: '699990003',
  });
  const vehicle = vCreate.body?.data;
  check('propriétaire publie un véhicule (en attente de vérification)', vCreate.status === 201 && vehicle?.verificationStatus === 'PENDING', msg(vCreate));

  const dates = { startDate: '2027-03-01T08:00:00.000Z', endDate: '2027-03-04T08:00:00.000Z', withDriver: true };
  const bUnverified = await api('POST', `/rentals/vehicles/${vehicle.id}/book`, T.client, { ...dates, paymentMethod: 'WALLET' });
  check('véhicule non vérifié : réservation refusée', bUnverified.status === 403, msg(bUnverified));

  await prisma.vehicle.update({ where: { id: vehicle.id }, data: { verificationStatus: 'VERIFIED' } });
  const rQuote = await api('POST', `/rentals/vehicles/${vehicle.id}/quote`, T.client, dates);
  const rentalTotal = rQuote.body?.data?.totalPrice;
  check('devis location (3 jours + chauffeur)', rQuote.status === 200 && rentalTotal === 3 * 25000 + 3 * 10000, `${rentalTotal} XAF`);

  const cBeforeRent = await balance(client.id);
  const book = await api('POST', `/rentals/vehicles/${vehicle.id}/book`, T.client, { ...dates, paymentMethod: 'WALLET' });
  const booking = book.body?.data;
  check('réservation', book.status === 201, msg(book));
  check('montant débité = devis', (await balance(client.id)) === cBeforeRent - rentalTotal);

  const overlap = await api('POST', `/rentals/vehicles/${vehicle.id}/book`, T.client2, {
    startDate: '2027-03-02T08:00:00.000Z', endDate: '2027-03-05T08:00:00.000Z', paymentMethod: 'WALLET',
  });
  check('dates qui se chevauchent : 2e réservation refusée', overlap.status === 409, msg(overlap));

  const oBefore = await balance(owner.id);
  const c1 = await api('POST', `/rentals/bookings/${booking.id}/confirm-completion`, T.owner);
  check('propriétaire confirme la fin', c1.status === 200, msg(c1));
  const c2 = await api('POST', `/rentals/bookings/${booking.id}/confirm-return`, T.client);
  check('locataire confirme le retour', c2.status === 200, msg(c2));
  check('propriétaire payé (total − 15 %)', (await balance(owner.id)) === oBefore + net(rentalTotal), `${net(rentalTotal)} XAF`);
  const bookingAfter = await prisma.rentalBooking.findUnique({ where: { id: booking.id } });
  check('réservation passée en COMPLETED et payée', bookingAfter.status === 'COMPLETED' && bookingAfter.isPaid === true, bookingAfter.status);
  // Une location terminée ne bloque plus les dates du véhicule
  const rebook = await api('POST', `/rentals/vehicles/${vehicle.id}/book`, T.client2, { ...dates, paymentMethod: 'WALLET' });
  check('dates libérées après la fin de location', rebook.status === 201, msg(rebook));

  const renterCancel = await api('PATCH', `/rentals/bookings/${booking.id}/cancel`, T.client);
  if (renterCancel.status === 404) {
    warn('location : annulation', 'aucune route d\'annulation : le locataire ne peut pas annuler ni être remboursé sans litige');
  }

  // =====================================================================
  console.log('\n=== 4. COVOITURAGE ===');
  const trip = await api('POST', '/carpools', T.driver, {
    departureLat: POS.lat, departureLng: POS.lng, departureCity: 'Yaoundé', departureAddress: 'Mvan',
    arrivalLat: 4.0511, arrivalLng: 9.7679, arrivalCity: 'Douala', arrivalAddress: 'Akwa',
    departureTime: '2027-03-10T06:00:00.000Z', availableSeats: 3, pricePerSeat: 5000,
  });
  const carpool = trip.body?.data;
  check('chauffeur publie un trajet', trip.status === 201, msg(trip));

  const cBeforeSeat = await balance(client.id);
  const seat = await api('POST', `/carpools/${carpool.id}/book`, T.client, { seats: 2, paymentMethod: 'WALLET' });
  check('passager réserve 2 places', seat.status === 201, msg(seat));
  check('passager débité 2 × 5 000', (await balance(client.id)) === cBeforeSeat - 10000);
  const tooMany = await api('POST', `/carpools/${carpool.id}/book`, T.client2, { seats: 2, paymentMethod: 'WALLET' });
  check('plus de places que disponibles : refusé', tooMany.status === 409, msg(tooMany));
  const seat2 = await api('POST', `/carpools/${carpool.id}/book`, T.client2, { seats: 1, paymentMethod: 'WALLET' });
  check('2e passager prend la dernière place', seat2.status === 201, msg(seat2));
  check('trajet marqué complet', (await prisma.carpool.findUnique({ where: { id: carpool.id } })).status === 'FULL');

  const drvBeforeTrip = await balance(driver.id);
  const done = await api('POST', `/carpools/${carpool.id}/confirm-completion`, T.driver);
  check('chauffeur confirme la fin du trajet', done.status === 200, msg(done));
  const a1 = await api('POST', `/carpools/${carpool.id}/confirm-arrival`, T.client);
  const a2 = await api('POST', `/carpools/${carpool.id}/confirm-arrival`, T.client2);
  check('les 2 passagers confirment l\'arrivée', a1.status === 200 && a2.status === 200, `${msg(a1)} / ${msg(a2)}`);
  check('chauffeur payé pour les 3 places (− 15 %)', (await balance(driver.id)) === drvBeforeTrip + net(10000) + net(5000));

  const tripCancel = await api('PATCH', `/carpools/${carpool.id}/cancel`, T.driver);
  if (tripCancel.status === 404) {
    warn('covoiturage : annulation', 'aucune route d\'annulation (chauffeur ou passager) : argent bloqué si le trajet n\'a pas lieu, sauf litige');
  }

  // =====================================================================
  console.log('\n=== 5. RETRAITS ===');
  const wBefore = await balance(driver.id);
  const w1 = await api('POST', '/wallet/withdraw', T.driver, { amount: 1000, paymentMethod: 'ORANGE_MONEY', phone: '699990004' });
  check('demande de retrait', w1.status === 200, msg(w1));
  check('solde débité immédiatement', (await balance(driver.id)) === wBefore - 1000);

  const list = await api('GET', '/admin/withdrawals?status=PENDING', T.admin);
  const tx1 = list.body?.data?.find((t) => t.wallet?.user?.id === driver.id && t.amount === 1000);
  check('admin voit la demande', !!tx1, msg(list));

  const rej = await api('POST', `/admin/withdrawals/${tx1.id}/reject`, T.admin, { reason: 'test' });
  check('admin refuse', rej.status === 200, msg(rej));
  check('refus : solde recrédité', (await balance(driver.id)) === wBefore);
  const rej2 = await api('POST', `/admin/withdrawals/${tx1.id}/reject`, T.admin, { reason: 'test' });
  check('double refus impossible (pas de double crédit)', rej2.status === 409 && (await balance(driver.id)) === wBefore, msg(rej2));

  await api('POST', '/wallet/withdraw', T.driver, { amount: 1500, paymentMethod: 'MTN_MOMO', phone: '699990004' });
  const list2 = await api('GET', '/admin/withdrawals?status=PENDING', T.admin);
  const tx2 = list2.body?.data?.find((t) => t.wallet?.user?.id === driver.id && t.amount === 1500);
  const comp = await api('POST', `/admin/withdrawals/${tx2.id}/complete`, T.admin, { operatorRef: 'OM-123' });
  check('admin marque payé', comp.status === 200, msg(comp));
  check('payé : solde reste débité', (await balance(driver.id)) === wBefore - 1500);

  const tooBig = await api('POST', '/wallet/withdraw', T.driver, { amount: 10_000_000, paymentMethod: 'ORANGE_MONEY', phone: '699990004' });
  check('retrait supérieur au solde : refusé', tooBig.status === 400, msg(tooBig));
  const notAdmin = await api('GET', '/admin/withdrawals', T.driver);
  check('un non-admin ne voit pas les retraits', notAdmin.status === 403, msg(notAdmin));

  // =====================================================================
  console.log(`\n${fails === 0 ? 'TOUS LES CONTROLES PASSENT' : `${fails} controle(s) en echec`}` +
    (warnings.length ? ` — ${warnings.length} point(s) à améliorer (NOTE)` : ''));
  await prisma.$disconnect();
  process.exit(fails ? 1 : 0);
})().catch(async (e) => {
  console.error('Erreur:', e.stack || e.message);
  await prisma.$disconnect();
  process.exit(1);
});
