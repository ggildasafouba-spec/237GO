/**
 * Résume un profil CPU V8 : temps "propre" (self) par fonction et par module.
 * Usage : node scripts/analyze-profile.js chemin/vers/fichier.cpuprofile
 */
const fs = require('fs');
const profile = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map(); // nodeId -> nombre d'échantillons
for (const id of profile.samples) self.set(id, (self.get(id) || 0) + 1);
const total = profile.samples.length;

function moduleOf(url) {
  if (!url) return '(natif / V8)';
  const m = url.match(/node_modules[\\/]((@[^\\/]+[\\/])?[^\\/]+)/);
  if (m) return m[1].replace(/\\/g, '/');
  if (/dist[\\/]/.test(url)) return 'CODE 237GO: ' + url.split(/dist[\\/]/)[1];
  if (url.startsWith('node:')) return url;
  return url;
}

const fnAgg = new Map();
const modAgg = new Map();
for (const [id, count] of self) {
  const n = byId.get(id);
  const cf = n.callFrame;
  const name = cf.functionName || '(anonyme)';
  if (name === '(idle)' || name === '(program)') {
    modAgg.set(name, (modAgg.get(name) || 0) + count);
    continue;
  }
  const mod = moduleOf(cf.url);
  const key = `${name}  [${mod}:${cf.lineNumber + 1}]`;
  fnAgg.set(key, (fnAgg.get(key) || 0) + count);
  modAgg.set(mod, (modAgg.get(mod) || 0) + count);
}

const pct = (c) => ((c / total) * 100).toFixed(1).padStart(5) + ' %';
console.log(`Échantillons: ${total}`);
console.log('\n=== TEMPS PAR MODULE ===');
[...modAgg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([k, c]) => console.log(pct(c), k));
console.log('\n=== TOP FONCTIONS (temps propre) ===');
[...fnAgg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([k, c]) => console.log(pct(c), k));
