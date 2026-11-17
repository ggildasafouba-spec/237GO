/* Vérifie : acceptation obligatoire des CGU à l'inscription, et suppression de compte.
 * LOCAL UNIQUEMENT.
 * Usage : DATABASE_URL=...localhost:55433/go237load JWT_SECRET=... MAIL_CAPTURE_FILE=... UPLOAD_PATH=... node scripts/account-deletion-check.js
 */
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const API = process.env.API_URL || 'http://localhost:3099';
const url = process.env.DATABASE_URL || '';
if (!/localhost:55433\/go237load/.test(url) || !/localhost/.test(API)) {
  console.error('REFUS: test local uniquement');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });
const SECRET = process.env.JWT_SECRET;
const MAIL_FILE = process.env.MAIL_CAPTURE_FILE;
const PRIVATE_DIR = path.join(path.dirname(process.env.UPLOAD_PATH), 'private-docs');

let fails = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'OK   ' : 'ECHEC'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails++;
};
const phone = () => `6${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const token = (id) => jwt.sign({ userId: id }, SECRET, { expiresIn: '1h' });
const api = async (method, p, t, body) => {
  const r = await fetch(API + '/api' + p, {
    method,
    headers: { ...(t ? { Authorization: `Bearer ${t}` } : {}), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await r.json(); } catch { /* vide */ }
  return { status: r.status, body: json };
};
const msg = (r) => `HTTP ${r.status} ${r.body?.message || ''}`;
const mails = () => (MAIL_FILE && fs.existsSync(MAIL_FILE) ? fs.readFileSync(MAIL_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const PWD = 'Sangmelima-2026!';

const register = (body) => api('POST', '/auth/register', null, body);

(async () => {
  console.log('\n=== 1. ACCEPTATION DES CGU ===');
  const p1 = phone();
  let r = await register({ phone: p1, firstName: 'Awa', lastName: 'Test', password: PWD });
  check('inscription sans case CGU : refusée (400)', r.status === 400 && /conditions d'utilisation/.test(r.body?.message || ''), msg(r));
  r = await register({ phone: p1, firstName: 'Awa', lastName: 'Test', password: PWD, acceptTerms: false });
  check('inscription avec case décochée : refusée', r.status === 400, msg(r));
  r = await register({ phone: p1, firstName: 'Awa', lastName: 'Test', password: PWD, acceptTerms: true });
  check('inscription avec case cochée : acceptée', r.status === 201, msg(r));
  const u1 = await prisma.user.findUnique({ where: { phone: p1 } });
  check('date et version des CGU enregistrées', !!u1?.termsAcceptedAt && u1?.termsVersion === '2026-11');

  console.log('\n=== 2. SUPPRESSION BLOQUÉE ===');
  // Compte complet : chauffeur avec documents, solde, contact d'urgence
  const email = `del${Date.now()}@test.local`;
  const p2 = phone();
  r = await register({ phone: p2, firstName: 'Paul', lastName: 'Mbarga', password: PWD, email, acceptTerms: true });
  const user = r.body.data.user;
  let T = r.body.data.token;
  await prisma.driverProfile.create({
    data: {
      userId: user.id, licenseNumber: 'LIC-123', licenseExpiry: new Date('2030-01-01'), cniNumber: 'CNI-456',
      vehicleType: 'MOTO', vehiclePlate: 'LT-999-AA', verificationStatus: 'VERIFIED', isOnline: true, currentLat: 3.85, currentLng: 11.5,
      cniPhoto: `${API}/api/files/private/${user.id}--${randomUUID()}.jpg`,
    },
  });
  fs.mkdirSync(PRIVATE_DIR, { recursive: true });
  const docFile = path.join(PRIVATE_DIR, `${user.id}--${randomUUID()}.jpg`);
  fs.writeFileSync(docFile, 'fake');
  const otherDoc = path.join(PRIVATE_DIR, `${randomUUID()}--${randomUUID()}.jpg`);
  fs.writeFileSync(otherDoc, 'other');
  await prisma.emergencyContact.create({ data: { userId: user.id, name: 'Maman', phone: '699990111' } });
  await prisma.wallet.update({ where: { userId: user.id }, data: { balance: 3000 } });

  r = await api('POST', '/auth/delete-account', T, { password: 'mauvais-mdp' });
  check('mauvais mot de passe : refusé', r.status === 400 && /incorrect/.test(r.body?.message || ''), msg(r));

  r = await api('GET', '/auth/delete-account/check', T);
  check('solde de 3 000 F : suppression bloquée', r.body?.data?.canDelete === false && r.body.data.blockers.some((b) => b.code === 'BALANCE'), JSON.stringify(r.body?.data?.blockers));
  r = await api('POST', '/auth/delete-account', T, { password: PWD });
  check('solde à retirer : 409, compte intact', r.status === 409 && !!(await prisma.user.findUnique({ where: { id: user.id } })).isActive, msg(r));

  // Course en cours
  await prisma.wallet.update({ where: { userId: user.id }, data: { balance: 0 } });
  const passenger = await prisma.user.create({ data: { phone: phone(), firstName: 'Cli', lastName: 'Ent', role: 'PASSENGER', wallet: { create: {} } } });
  const ride = await prisma.ride.create({
    data: {
      passengerId: passenger.id, driverId: user.id, status: 'IN_PROGRESS', vehicleType: 'MOTO',
      pickupLat: 3.84, pickupLng: 11.5, pickupAddress: 'A', dropoffLat: 3.86, dropoffLng: 11.52, dropoffAddress: 'B',
      estimatedPrice: 1500, paymentMethod: 'WALLET',
    },
  });
  const escrow = await prisma.escrow.create({
    data: { serviceType: 'RIDE', serviceId: ride.id, amount: 1500, commission: 225, payerId: passenger.id, payeeId: user.id, paymentMethod: 'WALLET', status: 'HELD' },
  });
  r = await api('GET', '/auth/delete-account/check', T);
  const codes = (r.body?.data?.blockers || []).map((b) => b.code);
  check('course en cours + paiement bloqué : suppression bloquée', codes.includes('RIDE') && codes.includes('ESCROW'), codes.join(','));

  // Retrait en attente
  await prisma.ride.update({ where: { id: ride.id }, data: { status: 'COMPLETED' } });
  await prisma.escrow.update({ where: { id: escrow.id }, data: { status: 'RELEASED' } });
  const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
  const wd = await prisma.transaction.create({ data: { walletId: wallet.id, type: 'WITHDRAWAL', amount: 2000, paymentMethod: 'ORANGE_MONEY', status: 'PENDING' } });
  r = await api('GET', '/auth/delete-account/check', T);
  check('retrait en attente : suppression bloquée', (r.body?.data?.blockers || []).some((b) => b.code === 'WITHDRAWAL'));
  await prisma.transaction.update({ where: { id: wd.id }, data: { status: 'COMPLETED' } });

  // Petit solde
  await prisma.wallet.update({ where: { userId: user.id }, data: { balance: 300 } });
  r = await api('GET', '/auth/delete-account/check', T);
  check('solde de 300 F : suppression possible, renonciation demandée', r.body?.data?.canDelete === true && r.body?.data?.smallBalance === 300, JSON.stringify(r.body?.data));
  r = await api('POST', '/auth/delete-account', T, { password: PWD });
  check('300 F sans renonciation cochée : refusé (409)', r.status === 409 && r.body?.data?.smallBalance === 300, msg(r));

  console.log('\n=== 3. SUPPRESSION ===');
  const mailsBefore = mails().length;
  r = await api('POST', '/auth/delete-account', T, { password: PWD, forfeitBalance: true });
  check('suppression acceptée', r.status === 200, msg(r));
  const after = await prisma.user.findUnique({ where: { id: user.id }, include: { driverProfile: true, emergencyContacts: true, wallet: true } });
  check('nom, téléphone, email effacés', after.firstName === 'Compte' && after.lastName === 'supprimé' && after.email === null && after.phone.startsWith('supprime-'), `${after.firstName} ${after.lastName} ${after.phone}`);
  check('mot de passe effacé, compte désactivé, date de suppression', after.passwordHash === null && after.isActive === false && !!after.deletedAt);
  check('contacts d\'urgence supprimés', after.emergencyContacts.length === 0);
  check('profil chauffeur : documents et numéros effacés, hors ligne', after.driverProfile.cniPhoto === null && after.driverProfile.licenseNumber === 'supprimé' && !after.driverProfile.isOnline && after.driverProfile.currentLat === null);
  check('fichier du document d\'identité supprimé du disque', !fs.existsSync(docFile));
  check('documents des autres comptes intacts', fs.existsSync(otherDoc));
  check('solde abandonné tracé, portefeuille à 0', after.wallet.balance === 0 &&
    (await prisma.transaction.count({ where: { walletId: after.wallet.id, description: { contains: 'Solde abandonné' } } })) === 1);
  check('historique conservé (course toujours liée)', !!(await prisma.ride.findUnique({ where: { id: ride.id } })));
  const newMails = mails().slice(mailsBefore);
  check('email de confirmation envoyé', newMails.some((m) => m.to === email && /supprimé/.test(m.subject)));

  r = await api('GET', '/auth/me', T);
  check('ancien jeton refusé (401)', r.status === 401, msg(r));
  r = await api('POST', '/auth/login', null, { phone: p2, password: PWD });
  check('connexion avec l\'ancien numéro impossible', r.status === 401 || r.status === 400, msg(r));
  r = await register({ phone: p2, firstName: 'Paul', lastName: 'Nouveau', password: PWD, acceptTerms: true });
  check('le numéro est libre : nouveau compte possible', r.status === 201, msg(r));

  console.log('\n=== 4. ADMIN ===');
  const admin = await prisma.user.create({ data: { phone: phone(), firstName: 'Ad', lastName: 'Min', role: 'ADMIN', passwordHash: require('bcryptjs').hashSync(PWD, 4), wallet: { create: {} } } });
  r = await api('POST', '/auth/delete-account', token(admin.id), { password: PWD });
  check('compte admin : suppression refusée', r.status === 409 && (await prisma.user.findUnique({ where: { id: admin.id } })).isActive, msg(r));

  fs.rmSync(otherDoc, { force: true });
  await prisma.$disconnect();
  console.log(`\n${fails === 0 ? 'TOUT EST OK' : fails + ' ECHEC(S)'}`);
  process.exit(fails ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
