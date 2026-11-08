// Vérifie que la nouvelle clé préparée reste compatible avec les jetons déjà émis.
process.env.JWT_SECRET = 'compat-check-secret-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = 'test';
const jwt = require('jsonwebtoken');
const { JWT_KEY, JWT_VERIFY_OPTIONS, JWT_SIGN_OPTIONS } = require('../dist/lib/jwtSecret');

let fails = 0;
const check = (name, ok) => { console.log(`${ok ? 'OK ' : 'ECHEC'} ${name}`); if (!ok) fails++; };

// 1) Jeton émis par l'ANCIEN code (clé en texte) -> vérifié par le NOUVEAU code
const oldToken = jwt.sign({ userId: 'u1' }, process.env.JWT_SECRET, { expiresIn: '7d' });
try { check('ancien jeton accepté par le nouveau code', jwt.verify(oldToken, JWT_KEY, JWT_VERIFY_OPTIONS).userId === 'u1'); }
catch (e) { check('ancien jeton accepté par le nouveau code: ' + e.message, false); }

// 2) Jeton émis par le NOUVEAU code -> vérifié par l'ANCIEN code (retour arrière possible)
const newToken = jwt.sign({ userId: 'u2' }, JWT_KEY, { ...JWT_SIGN_OPTIONS, expiresIn: '7d' });
try { check('nouveau jeton accepté par l\'ancien code', jwt.verify(newToken, process.env.JWT_SECRET).userId === 'u2'); }
catch (e) { check('nouveau jeton accepté par l\'ancien code: ' + e.message, false); }

// 3) Jeton signé avec une AUTRE clé -> refusé
const forged = jwt.sign({ userId: 'admin' }, 'une-autre-cle-pirate-0123456789abcdef');
try { jwt.verify(forged, JWT_KEY, JWT_VERIFY_OPTIONS); check('jeton forgé refusé', false); }
catch { check('jeton forgé refusé', true); }

// 4) Jeton non signé (alg "none") -> refusé
const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
const payload = Buffer.from(JSON.stringify({ userId: 'admin' })).toString('base64url');
try { jwt.verify(`${header}.${payload}.`, JWT_KEY, JWT_VERIFY_OPTIONS); check('jeton "alg:none" refusé', false); }
catch { check('jeton "alg:none" refusé', true); }

// 5) Jeton HS512 (algorithme non autorisé) -> refusé
const hs512 = jwt.sign({ userId: 'u3' }, process.env.JWT_SECRET, { algorithm: 'HS512' });
try { jwt.verify(hs512, JWT_KEY, JWT_VERIFY_OPTIONS); check('algorithme HS512 refusé', false); }
catch { check('algorithme HS512 refusé', true); }

// 6) Vitesse : 20 000 vérifications, ancienne méthode vs nouvelle
const N = 20000;
let t = performance.now();
for (let i = 0; i < N; i++) jwt.verify(oldToken, process.env.JWT_SECRET);
const oldMs = performance.now() - t;
t = performance.now();
for (let i = 0; i < N; i++) jwt.verify(oldToken, JWT_KEY, JWT_VERIFY_OPTIONS);
const newMs = performance.now() - t;
console.log(`Vitesse: ancienne ${(oldMs / N * 1000).toFixed(1)} µs/vérif, nouvelle ${(newMs / N * 1000).toFixed(1)} µs/vérif (x${(oldMs / newMs).toFixed(1)} plus rapide)`);

console.log(fails === 0 ? 'TOUS LES CONTROLES PASSENT' : `${fails} controle(s) en echec`);
process.exit(fails ? 1 : 0);
