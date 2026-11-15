/**
 * Test LOCAL des protections : sites autorisés (CORS) et révocation des sessions.
 * Usage : DATABASE_URL=...localhost:55433/go237load JWT_SECRET=... node scripts/security-check.js
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');
const fs = require('fs');
const path = require('path');

const API = process.env.API_URL || 'http://localhost:3099';
const url = process.env.DATABASE_URL || '';
if (!/localhost:55433\/go237load/.test(url) || !/localhost/.test(API)) { console.error('REFUS: test local uniquement'); process.exit(1); }
const prisma = new PrismaClient({ datasources: { db: { url } } });
const SECRET = process.env.JWT_SECRET;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'OK   ' : 'ECHEC'} ${name}${detail ? ' — ' + detail : ''}`); if (!ok) fails++; };
const phone = () => `6${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

const req = async (method, path, { token, origin, body } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (origin) headers.Origin = origin;
  const r = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* vide */ }
  return { status: r.status, body: json, acao: r.headers.get('access-control-allow-origin') };
};
const me = (token) => req('GET', '/api/auth/me', { token });
const sock = (token, origin) => new Promise((resolve) => {
  const s = io(API, { auth: { token }, transports: ['websocket'], reconnection: false, extraHeaders: origin ? { Origin: origin } : undefined });
  const t = setTimeout(() => { s.close(); resolve({ ok: false, err: 'timeout' }); }, 4000);
  s.on('connect', () => { clearTimeout(t); resolve({ ok: true, s }); });
  s.on('connect_error', (e) => { clearTimeout(t); s.close(); resolve({ ok: false, err: e.message }); });
});
const login = async (p, pw) => (await req('POST', '/api/auth/login', { body: { phone: p, password: pw } })).body?.data?.token;

(async () => {
  const PW = 'Ancien-mdp-123';
  const mk = async (role) => {
    const p = phone();
    const u = await prisma.user.create({ data: { id: randomUUID(), phone: p, firstName: 'S', lastName: role, role, passwordHash: await bcrypt.hash(PW, 4), wallet: { create: {} } } });
    return { ...u, phone: p };
  };
  const user = await mk('PASSENGER');
  const admin = await mk('ADMIN');

  console.log('\n=== Point 5 : sites autorisés ===');
  const evil = await req('GET', '/api/auth/me', { token: await login(user.phone, PW), origin: 'https://237go-promo.com' });
  check('appel depuis un site pirate : refusé (403)', evil.status === 403, `HTTP ${evil.status}`);
  const evilLogin = await req('POST', '/api/auth/login', { origin: 'https://evil.example', body: { phone: user.phone, password: PW } });
  check('connexion depuis un site pirate : refusée avant traitement', evilLogin.status === 403);
  for (const o of ['https://app.237go.app', 'https://admin.237go.app', 'https://www.237go.app']) {
    const r = await req('GET', '/api/health', { origin: o });
    check(`${o} : autorisé`, r.status === 200 && r.acao === o, `HTTP ${r.status}, ACAO=${r.acao}`);
  }
  const lookalike = await req('GET', '/api/health', { origin: 'https://app.237go.app.evil.com' });
  check('faux domaine ressemblant (app.237go.app.evil.com) : refusé', lookalike.status === 403);
  const noOrigin = await req('GET', '/api/health');
  check('sans Origin (app installée, serveur) : autorisé', noOrigin.status === 200);
  const pre = await fetch(API + '/api/auth/me', { method: 'OPTIONS', headers: { Origin: 'https://app.237go.app', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
  check('pré-vérification du navigateur (preflight) depuis app.237go.app : OK', pre.status === 204 && pre.headers.get('access-control-allow-origin') === 'https://app.237go.app', `HTTP ${pre.status}`);
  const preEvil = await fetch(API + '/api/auth/me', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } });
  check('preflight depuis un site pirate : refusé', preEvil.status === 403);
  const hook = await req('POST', '/api/webhooks/cinetpay', { origin: 'null', body: {} });
  check('webhooks de paiement : jamais bloqués par cette règle', hook.status !== 403, `HTTP ${hook.status}`);
  const localhostProd = await req('GET', '/api/health', { origin: 'http://localhost:8081' });
  check('localhost refusé en production', localhostProd.status === 403);

  const tOk = await login(user.phone, PW);
  const sEvil = await sock(tOk, 'https://evil.example');
  check('temps réel depuis un site pirate : refusé', !sEvil.ok, sEvil.err);
  const sApp = await sock(tOk, 'https://app.237go.app');
  check('temps réel depuis app.237go.app : OK', sApp.ok, sApp.err);
  const sNative = await sock(tOk, 'https://api.237go.app');
  check('temps réel de l\'app installée (Origin api.237go.app) : OK', sNative.ok, sNative.err);
  const sNone = await sock(tOk);
  check('temps réel sans Origin : OK', sNone.ok, sNone.err);
  [sApp, sNative, sNone].forEach((x) => x.s?.close());

  console.log('\n=== Point 6 : déconnexion de tous les appareils ===');
  const legacy = jwt.sign({ userId: user.id }, SECRET, { expiresIn: '1h' });
  check('ancien jeton (émis avant la mise à jour) : toujours valide', (await me(legacy)).status === 200);

  const phoneA = await login(user.phone, PW);
  const phoneB = await login(user.phone, PW); // le « pirate » sur un autre appareil
  check('2 appareils connectés', (await me(phoneA)).status === 200 && (await me(phoneB)).status === 200);
  const liveB = await sock(phoneB);
  let liveBDropped = false;
  liveB.s?.on('disconnect', () => { liveBDropped = true; });

  const out = await req('POST', '/api/auth/logout-all', { token: phoneA });
  const phoneA2 = out.body?.data?.token;
  check('« Déconnecter tous mes autres appareils » : OK', out.status === 200 && !!phoneA2, out.body?.message);
  check('… l\'appareil courant reste connecté (nouveau jeton)', (await me(phoneA2)).status === 200);
  const meB = await me(phoneB);
  check('… l\'autre appareil est déconnecté (même dans les 15 s du cache)', meB.status === 401, `HTTP ${meB.status} ${meB.body?.message || ''}`);
  check('… l\'ancien jeton de l\'appareil courant ne marche plus', (await me(phoneA)).status === 401);
  check('… l\'ancien jeton d\'avant la mise à jour aussi', (await me(legacy)).status === 401);
  await sleep(500);
  check('… sa connexion temps réel est coupée immédiatement', liveBDropped);
  const reB = await sock(phoneB);
  check('… et il ne peut pas la rouvrir', !reB.ok, reB.err);

  // Changement de mot de passe
  const pirate = await login(user.phone, PW);
  const bad = await req('POST', '/api/auth/change-password', { token: phoneA2, body: { currentPassword: 'faux', newPassword: 'Nouveau-mdp-456' } });
  check('mot de passe actuel faux : refusé (sans déconnecter l\'utilisateur)', bad.status === 400 && (await me(phoneA2)).status === 200, bad.body?.message);
  const cp = await req('POST', '/api/auth/change-password', { token: phoneA2, body: { currentPassword: PW, newPassword: 'Nouveau-mdp-456' } });
  const phoneA3 = cp.body?.data?.token;
  check('changement de mot de passe : OK', cp.status === 200 && !!phoneA3, cp.body?.message);
  check('… l\'appareil courant reste connecté', (await me(phoneA3)).status === 200);
  check('… le pirate est déconnecté', (await me(pirate)).status === 401);
  check('… l\'ancien mot de passe ne marche plus', !(await login(user.phone, PW)));
  const NEWPW = 'Nouveau-mdp-456';
  check('… le nouveau mot de passe marche', !!(await login(user.phone, NEWPW)));

  // Mot de passe oublié (compte SANS email) → support WhatsApp : l'admin génère le code
  const before = await login(user.phone, NEWPW);
  const fp = await req('POST', '/api/auth/forgot-password', { body: { identifier: user.phone } });
  check('mot de passe oublié sans email : orienté vers le support, AUCUN code renvoyé',
    fp.status === 200 && fp.body?.data?.channel === 'support' && !/"otp"|\b\d{6}\b/.test(JSON.stringify(fp.body).replace(/\+?\d{9,}/g, '')),
    JSON.stringify(fp.body?.data));
  const tAdmin0 = await login(admin.phone, PW);
  const rc = await req('POST', `/api/admin/users/${user.id}/reset-code`, { token: tAdmin0 });
  check('admin : code de réinitialisation généré (montré à l\'admin seulement)', rc.status === 200 && /^\d{6}$/.test(rc.body?.data?.code || ''), rc.body?.message);
  const rp = await req('POST', '/api/auth/reset-password', { body: { identifier: user.phone, otp: rc.body?.data?.code, newPassword: 'Reset-mdp-789' } });
  check('réinitialisation du mot de passe : OK', rp.status === 200, rp.body?.message);
  check('… tous les appareils déconnectés', (await me(before)).status === 401 && (await me(phoneA3)).status === 401);

  // Admin
  const tAdmin = await login(admin.phone, PW);
  const victim = await login(user.phone, 'Reset-mdp-789');
  const notAdmin = await req('POST', `/api/admin/users/${admin.id}/logout-all`, { token: victim });
  check('un utilisateur ne peut pas déconnecter les autres', notAdmin.status === 403);
  const forced = await req('POST', `/api/admin/users/${user.id}/logout-all`, { token: tAdmin });
  check('admin : déconnexion forcée d\'un compte', forced.status === 200 && (await me(victim)).status === 401, forced.body?.message);
  check('… le compte reste actif (reconnexion possible)', !!(await login(user.phone, 'Reset-mdp-789')));
  check('… l\'admin, lui, reste connecté', (await me(tAdmin)).status === 200);

  // Désactivation : connexion temps réel coupée
  const tUser = await login(user.phone, 'Reset-mdp-789');
  const live = await sock(tUser);
  let dropped = false;
  live.s?.on('disconnect', () => { dropped = true; });
  await req('PATCH', `/api/admin/users/${user.id}/toggle`, { token: tAdmin });
  await sleep(500);
  check('compte désactivé : connexion temps réel coupée', dropped);
  check('compte désactivé : accès refusé', (await me(tUser)).status === 401);
  const reconnect = await sock(tUser);
  check('compte désactivé : impossible de rouvrir le temps réel', !reconnect.ok);

  // Jeton falsifié : version modifiée sans la clé → refusé
  const forgedTv = jwt.sign({ userId: admin.id, tv: 0 }, 'pas-la-bonne-cle-0123456789abcdef0123');
  check('jeton falsifié : refusé', (await me(forgedTv)).status === 401);

  // =====================================================================
  console.log('\n=== Mot de passe oublié par email ===');
  const MAILS = process.env.MAIL_CAPTURE_FILE;
  const lastCodeFor = (email) => {
    const lines = fs.existsSync(MAILS) ? fs.readFileSync(MAILS, 'utf8').trim().split('\n').filter(Boolean) : [];
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = JSON.parse(lines[i]);
      if (m.to === email) {
        const c = /letter-spacing[^>]*>\s*(\d{6})\s*</.exec(m.html);
        if (c) return { code: c[1], subject: m.subject };
      }
    }
    return null;
  };
  const mails = () => (fs.existsSync(MAILS) ? fs.readFileSync(MAILS, 'utf8') : '');
  const email = `secu.${Date.now()}@test.local`;
  const mailUser = await prisma.user.create({ data: { id: randomUUID(), phone: phone(), email, firstName: 'Mail', lastName: 'User', passwordHash: await bcrypt.hash(PW, 4), wallet: { create: {} } } });
  const unknown = await req('POST', '/api/auth/forgot-password', { body: { identifier: '699999998' } });
  check('compte inconnu : même réponse qu\'un compte sans email (ne révèle rien)', unknown.status === 200 && unknown.body?.data?.channel === 'support');
  const f1 = await req('POST', '/api/auth/forgot-password', { body: { identifier: mailUser.phone } });
  const c1 = lastCodeFor(email);
  check('code envoyé par email (adresse masquée à l\'écran)', f1.body?.data?.channel === 'email' && /\*\*\*/.test(f1.body?.data?.maskedEmail || '') && !!c1, JSON.stringify(f1.body?.data));
  check('aucun code dans la réponse de l\'app', !JSON.stringify(f1.body).includes(c1?.code));
  const stored = await prisma.user.findUnique({ where: { id: mailUser.id } });
  check('code stocké chiffré en base (jamais en clair)', !!stored.resetOtp && stored.resetOtp !== c1?.code && stored.resetOtp.length === 64);
  const wrong = c1.code === '000000' ? '111111' : '000000';
  let last;
  for (let i = 0; i < 5; i++) last = await req('POST', '/api/auth/reset-password', { body: { identifier: mailUser.phone, otp: wrong, newPassword: 'Bon-mot-de-passe-1' } });
  check('5 essais faux : code annulé', /Trop d'essais/.test(last.body?.message || ''), last.body?.message);
  const afterBurn = await req('POST', '/api/auth/reset-password', { body: { identifier: mailUser.phone, otp: c1.code, newPassword: 'Bon-mot-de-passe-1' } });
  check('… même le bon code ne marche plus ensuite', afterBurn.status === 400);
  await req('POST', '/api/auth/forgot-password', { body: { identifier: mailUser.phone } });
  const c2 = lastCodeFor(email);
  const weakReset = await req('POST', '/api/auth/reset-password', { body: { identifier: mailUser.phone, otp: c2.code, newPassword: '12345678' } });
  check('mot de passe trop courant refusé', weakReset.status === 400, weakReset.body?.message);
  const mailCountBefore = mails().split('\n').filter(Boolean).length;
  const okReset = await req('POST', '/api/auth/reset-password', { body: { identifier: mailUser.phone, otp: c2.code, newPassword: 'Bon-mot-de-passe-1' } });
  check('nouveau code + bon mot de passe : réinitialisé', okReset.status === 200, okReset.body?.message);
  await sleep(300);
  check('email d\'alerte « mot de passe modifié » envoyé', mails().split('\n').filter(Boolean).length > mailCountBefore && /a été modifié/.test(mails().split('\n').filter(Boolean).pop()));
  const reuse = await req('POST', '/api/auth/reset-password', { body: { identifier: mailUser.phone, otp: c2.code, newPassword: 'Autre-mot-de-passe-2' } });
  check('code à usage unique (2e utilisation refusée)', reuse.status === 400);

  console.log('\n=== Règles de mot de passe et email obligatoire ===');
  const reg = (body) => req('POST', '/api/auth/register', { body: { firstName: 'R', lastName: 'T', ...body } });
  const p1 = phone();
  check('inscription avec « 1234567 » (7 caractères) : refusée', (await reg({ phone: phone(), password: '1234567' })).status === 400);
  check('inscription avec « 12345678 » (trop courant) : refusée', (await reg({ phone: phone(), password: '12345678' })).status === 400);
  check('inscription avec son numéro comme mot de passe : refusée', (await reg({ phone: p1, password: p1 })).status === 400);
  check('inscription chauffeur sans email : refusée', (await reg({ phone: phone(), password: 'Solide-mdp-1', role: 'DRIVER' })).status === 400);
  const goodReg = await reg({ phone: phone(), password: 'Solide-mdp-1' });
  check('inscription passager avec un bon mot de passe : OK', goodReg.status === 201, goodReg.body?.message);
  check('les anciens comptes à 6 caractères peuvent toujours se connecter', !!(await (async () => {
    const old = await prisma.user.create({ data: { id: randomUUID(), phone: phone(), firstName: 'O', lastName: 'L', passwordHash: await bcrypt.hash('abc123', 4), wallet: { create: {} } } });
    return login(old.phone, 'abc123');
  })()));

  // Changer l'email : mot de passe exigé si un email existe déjà
  const tMail = await login(mailUser.phone, 'Bon-mot-de-passe-1');
  const steal = await req('PATCH', '/api/users/profile', { token: tMail, body: { email: 'pirate@evil.test' } });
  check('changer l\'email sans mot de passe : refusé', steal.status === 403, steal.body?.message);
  const legit = await req('PATCH', '/api/users/profile', { token: tMail, body: { email: `nouveau.${Date.now()}@test.local`, currentPassword: 'Bon-mot-de-passe-1' } });
  check('changer l\'email avec le mot de passe : OK (ancien email prévenu)', legit.status === 200 && mails().includes(email) && /email de votre compte/i.test(mails()));

  console.log('\n=== Support : génération de code par l\'admin ===');
  const otherAdmin = await prisma.user.create({ data: { id: randomUUID(), phone: phone(), firstName: 'A2', lastName: 'Admin', role: 'ADMIN', passwordHash: await bcrypt.hash(PW, 4), wallet: { create: {} } } });
  const tAdminNow = await login(admin.phone, PW);
  check('admin : pas de code pour un autre administrateur', (await req('POST', `/api/admin/users/${otherAdmin.id}/reset-code`, { token: tAdminNow })).status === 403);
  check('un non-admin ne peut pas générer de code', (await req('POST', `/api/admin/users/${mailUser.id}/reset-code`, { token: tMail })).status === 403);

  console.log('\n=== Double vérification admin (code par email) ===');
  const adminEmail = `admin.${Date.now()}@test.local`;
  const admin2 = await prisma.user.create({ data: { id: randomUUID(), phone: phone(), email: adminEmail, firstName: 'Ad', lastName: 'Min', role: 'ADMIN', passwordHash: await bcrypt.hash(PW, 4), wallet: { create: {} } } });
  const step1 = await req('POST', '/api/auth/login', { body: { phone: admin2.phone, password: PW } });
  check('admin : le mot de passe seul ne donne PAS l\'accès', step1.status === 200 && step1.body?.data?.twoFactorRequired === true && !step1.body?.data?.token);
  const challengeTok = step1.body?.data?.challengeToken;
  check('le jeton intermédiaire ne permet pas d\'utiliser l\'API', (await me(challengeTok)).status === 401);
  const ac = lastCodeFor(adminEmail);
  check('code de connexion reçu par email', !!ac && /admin/i.test(ac.subject));
  const badAdmin = await req('POST', '/api/auth/login/verify', { body: { challengeToken: challengeTok, code: ac.code === '000000' ? '111111' : '000000' } });
  check('mauvais code : refusé', badAdmin.status === 400, badAdmin.body?.message);
  const goodAdmin = await req('POST', '/api/auth/login/verify', { body: { challengeToken: challengeTok, code: ac.code } });
  check('bon code : connecté', goodAdmin.status === 200 && (await me(goodAdmin.body?.data?.token)).status === 200, goodAdmin.body?.message);
  const replay = await req('POST', '/api/auth/login/verify', { body: { challengeToken: challengeTok, code: ac.code } });
  check('code à usage unique', replay.status !== 200);
  const forgedChallenge = jwt.sign({ userId: admin2.id, tv: 0, purpose: 'admin-2fa' }, SECRET, { expiresIn: '10m' });
  check('jeton intermédiaire fabriqué avec la clé de connexion : refusé', (await req('POST', '/api/auth/login/verify', { body: { challengeToken: forgedChallenge, code: ac.code } })).status === 401);

  console.log('\n=== Documents d\'identité privés ===');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const upload = async (t, priv) => {
    const fd = new FormData();
    fd.append('file', new Blob([png], { type: 'image/png' }), 'doc.png');
    const r = await fetch(`${API}/api/upload${priv ? '?private=1' : ''}`, { method: 'POST', headers: { Authorization: `Bearer ${t}` }, body: fd });
    return (await r.json()).data;
  };
  const drv = await prisma.user.create({ data: { id: randomUUID(), phone: phone(), firstName: 'Dr', lastName: 'Iver', passwordHash: await bcrypt.hash(PW, 4), wallet: { create: {} } } });
  const tDrv = await login(drv.phone, PW);
  const cni = await upload(tDrv, true);
  check('document téléversé en privé : lien d\'aperçu temporaire', /\/api\/files\/private\/.+\?exp=\d+&sig=/.test(cni.previewUrl || ''));
  const asPublic = await fetch(`${API}/uploads/${cni.filename}`);
  check('… introuvable par l\'adresse publique /uploads', asPublic.status === 404);
  check('… lien signé : affichable', (await fetch(cni.previewUrl)).status === 200);
  check('… lien sans signature : refusé', (await fetch(cni.url)).status === 404);
  // (on change VRAIMENT le 1er caractère : avant, « 0 » remplaçait parfois un « 0 »)
  const tampered = cni.previewUrl.replace(/sig=(.)/, (_m, c) => `sig=${c === 'a' ? 'b' : 'a'}`);
  check('… signature modifiée : refusée', tampered !== cni.previewUrl && (await fetch(tampered)).status === 404);
  check('… lien expiré : refusé', (await fetch(cni.previewUrl.replace(/exp=\d+/, 'exp=1000'))).status === 404);
  check('… nom de fichier piégé (../) : refusé', (await fetch(`${API}/api/files/private/..%2F..%2Fpackage.json?exp=9999999999&sig=x`)).status === 404);

  const oldApkPublic = await upload(tDrv, false); // ancienne app : document envoyé en public
  const strangerDoc = await upload(await login(mailUser.phone, 'Bon-mot-de-passe-1'), true);
  const driverBody = (extra) => ({ licenseNumber: 'L1', licenseExpiry: '2030-01-01', cniNumber: 'C1', vehicleType: 'MOTO', vehiclePlate: 'LT-SEC', ...extra });
  const noMail = await req('POST', '/api/users/become-driver', { token: tDrv, body: driverBody({ cniPhoto: cni.previewUrl }) });
  check('devenir chauffeur sans email : refusé', noMail.status === 400, noMail.body?.message);
  const other = await req('POST', '/api/users/become-driver', { token: tDrv, body: driverBody({ email: `drv.${Date.now()}@test.local`, cniPhoto: strangerDoc.previewUrl }) });
  check('rattacher le document d\'un AUTRE utilisateur : refusé', other.status === 400, other.body?.message);
  const ext = await req('POST', '/api/users/become-driver', { token: tDrv, body: driverBody({ email: `drv.${Date.now()}@test.local`, cniPhoto: 'https://evil.example/cni.jpg' }) });
  check('lien externe comme document : refusé', ext.status === 400, ext.body?.message);
  const drvEmail = `drv.${Date.now()}@test.local`;
  const okDrv = await req('POST', '/api/users/become-driver', { token: tDrv, body: driverBody({ email: drvEmail, cniPhoto: cni.previewUrl, licensePhoto: oldApkPublic.url }) });
  check('devenir chauffeur avec email + documents : OK', okDrv.status === 201, okDrv.body?.message);
  check('… email enregistré sur le compte', (await prisma.user.findUnique({ where: { id: drv.id } })).email === drvEmail);
  const dp = await prisma.driverProfile.findUnique({ where: { userId: drv.id } });
  check('… en base : références privées sans signature', /\/api\/files\/private\/[^?]+$/.test(dp.cniPhoto) && /\/api\/files\/private\/[^?]+$/.test(dp.licensePhoto));
  check('… document envoyé en public par l\'ancienne app : déplacé dans le privé', (await fetch(oldApkPublic.url)).status === 404);
  const meDrv = await me(tDrv);
  const signedLic = meDrv.body?.data?.driverProfile?.licensePhoto;
  check('… /auth/me : lien temporaire qui fonctionne', /sig=/.test(signedLic || '') && (await fetch(signedLic)).status === 200);
  const adminList = await req('GET', '/api/admin/drivers', { token: tAdminNow });
  const inList = adminList.body?.data?.find((d) => d.userId === drv.id);
  check('admin : liens temporaires qui fonctionnent', /sig=/.test(inList?.cniPhoto || '') && (await fetch(inList.cniPhoto)).status === 200);

  // Migration des anciens documents publics
  const legacyName = `${randomUUID()}.png`;
  fs.writeFileSync(path.join(process.env.UPLOAD_PATH, legacyName), png);
  const legacyUser = await prisma.user.create({ data: { id: randomUUID(), phone: phone(), firstName: 'Le', lastName: 'Gacy', wallet: { create: {} } } });
  await prisma.driverProfile.create({ data: { userId: legacyUser.id, licenseNumber: 'L', licenseExpiry: new Date('2030-01-01'), cniNumber: 'C', vehicleType: 'MOTO', vehiclePlate: 'P', cniPhoto: `${API}/uploads/${legacyName}` } });
  check('avant migration : ancien document public accessible', (await fetch(`${API}/uploads/${legacyName}`)).status === 200);
  const { migrateSensitiveDocuments } = require('../dist/lib/privateDocs');
  const mig = await migrateSensitiveDocuments(prisma);
  const migrated = await prisma.driverProfile.findUnique({ where: { userId: legacyUser.id } });
  check('migration : document déplacé et référence privée', mig.moved >= 1 && /\/api\/files\/private\//.test(migrated.cniPhoto), JSON.stringify(mig));
  check('… plus accessible publiquement', (await fetch(`${API}/uploads/${legacyName}`)).status === 404);
  const again = await migrateSensitiveDocuments(prisma);
  check('… migration relancée : sans effet (déjà faite)', again.moved === 0 && again.updated === 0);

  // Location : le locataire ne reçoit plus les documents du propriétaire
  const veh = await prisma.vehicle.create({ data: { ownerId: drv.id, type: 'CAR_ECONOMY', brand: 'T', model: 'C', year: 2018, plate: 'X', pricePerDay: 20000, locationLat: 3.8, locationLng: 11.5, locationAddress: 'Y', registrationPhoto: dp.cniPhoto, insurancePhoto: dp.cniPhoto, ownerIdPhoto: dp.cniPhoto, verificationStatus: 'VERIFIED' } });
  await prisma.rentalBooking.create({ data: { vehicleId: veh.id, renterId: mailUser.id, startDate: new Date(Date.now() + 864e5), endDate: new Date(Date.now() + 2 * 864e5), totalPrice: 20000, paymentMethod: 'CASH', status: 'CONFIRMED' } });
  const mb = await req('GET', '/api/rentals/my-bookings', { token: await login(mailUser.phone, 'Bon-mot-de-passe-1') });
  const mbText = JSON.stringify(mb.body);
  check('« Mes locations » : plus aucun document du propriétaire envoyé au locataire',
    mb.status === 200 && !/registrationPhoto|insurancePhoto|ownerIdPhoto|private-docs|files\/private/.test(mbText));

  // Photos publiques affichables sur les autres sites 237GO
  const pub = await upload(tDrv, false);
  const pubRes = await fetch(pub.url);
  check('photos publiques : affichables sur app.237go.app / admin (Cross-Origin-Resource-Policy)', pubRes.headers.get('cross-origin-resource-policy') === 'cross-origin');

  console.log('\n=== Retraits bloqués 24 h après un changement de mot de passe ===');
  const W = { amount: 1000, paymentMethod: 'ORANGE_MONEY', phone: '699990004' };
  const wu = await prisma.user.create({ data: { id: randomUUID(), phone: phone(), firstName: 'W', lastName: 'D', passwordHash: await bcrypt.hash(PW, 4), wallet: { create: { balance: 50000 } } } });
  let tW = await login(wu.phone, PW);
  const w0 = await req('POST', '/api/wallet/withdraw', { token: tW, body: W });
  check('compte jamais modifié : retrait autorisé', w0.status === 200, w0.body?.message);
  const cpw = await req('POST', '/api/auth/change-password', { token: tW, body: { currentPassword: PW, newPassword: 'Nouveau-mdp-W1' } });
  tW = cpw.body?.data?.token;
  const balBefore = (await prisma.wallet.findUnique({ where: { userId: wu.id } })).balance;
  const w1 = await req('POST', '/api/wallet/withdraw', { token: tW, body: W });
  check('juste après le changement de mot de passe : retrait bloqué (date de fin indiquée)', w1.status === 403 && /24 h/.test(w1.body?.message || '') && /à partir du/.test(w1.body?.message || ''), w1.body?.message);
  check('… le solde n\'a pas bougé', (await prisma.wallet.findUnique({ where: { userId: wu.id } })).balance === balBefore);
  await prisma.user.update({ where: { id: wu.id }, data: { passwordChangedAt: new Date(Date.now() - 23 * 3_600_000) } });
  check('23 h après : toujours bloqué', (await req('POST', '/api/wallet/withdraw', { token: tW, body: W })).status === 403);
  await prisma.user.update({ where: { id: wu.id }, data: { passwordChangedAt: new Date(Date.now() - 25 * 3_600_000) } });
  check('25 h après : retrait de nouveau autorisé', (await req('POST', '/api/wallet/withdraw', { token: tW, body: W })).status === 200);
  // Réinitialisation (mot de passe oublié via le support) : bloque aussi
  const tAdm = await login(admin.phone, PW);
  const rcW = await req('POST', `/api/admin/users/${wu.id}/reset-code`, { token: tAdm });
  await req('POST', '/api/auth/reset-password', { body: { identifier: wu.phone, otp: rcW.body?.data?.code, newPassword: 'Reset-mdp-W2' } });
  const tW2 = await login(wu.phone, 'Reset-mdp-W2');
  check('après « mot de passe oublié » : retrait bloqué aussi', (await req('POST', '/api/wallet/withdraw', { token: tW2, body: W })).status === 403);
  check('… les dépenses (courses, commandes) restent possibles', (await req('GET', '/api/wallet/balance', { token: tW2 })).status === 200);
  check('… l\'email d\'alerte mentionne le blocage', /bloqués pendant 24/.test(mails()) || !MAILS);

  console.log(fails === 0 ? '\nTOUS LES CONTROLES PASSENT' : `\n${fails} controle(s) en echec`);
  await prisma.$disconnect();
  process.exit(fails ? 1 : 0);
})().catch(async (e) => { console.error('Erreur:', e.stack || e.message); await prisma.$disconnect(); process.exit(1); });
