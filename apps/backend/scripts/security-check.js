/**
 * Test LOCAL des protections : sites autorisés (CORS) et révocation des sessions.
 * Usage : DATABASE_URL=...localhost:55433/go237load JWT_SECRET=... node scripts/security-check.js
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
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

  // Mot de passe oublié → tout le monde est déconnecté
  const before = await login(user.phone, NEWPW);
  const fp = await req('POST', '/api/auth/forgot-password', { body: { identifier: user.phone } });
  const rp = await req('POST', '/api/auth/reset-password', { body: { identifier: user.phone, otp: fp.body?.otp, newPassword: 'Reset-mdp-789' } });
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

  console.log(fails === 0 ? '\nTOUS LES CONTROLES PASSENT' : `\n${fails} controle(s) en echec`);
  await prisma.$disconnect();
  process.exit(fails ? 1 : 0);
})().catch(async (e) => { console.error('Erreur:', e.stack || e.message); await prisma.$disconnect(); process.exit(1); });
