// Génère les PNG de la nouvelle icône 237GO (v2) à partir des SVG.
//  - app-icon-v2-1024.png      : icône de l'app (carré plein, sans transparence)
//  - app-adaptive-v2-1024.png  : premier plan adaptatif Android (fond transparent)
//  - play-icon-v2-512.png      : icône de la fiche Play Store (512, sans transparence)
const sharp = require('sharp');

(async () => {
  await sharp('app-icon-v2.svg', { density: 300 }).resize(1024, 1024).removeAlpha().png().toFile('app-icon-v2-1024.png');
  await sharp('app-adaptive-v2.svg', { density: 300 }).resize(1024, 1024).png().toFile('app-adaptive-v2-1024.png');
  await sharp('app-icon-v2.svg', { density: 300 }).resize(512, 512).removeAlpha().png().toFile('play-icon-v2-512.png');
  // Écran de démarrage (fond transparent, couleur de fond définie dans app.json)
  await sharp('splash-v2.svg', { density: 300 }).resize(1024, 1024).png().toFile('splash-v2-1024.png');
  // Image de présentation Play Store : 1024x500, PNG 24 bits sans transparence
  await sharp('feature-v2.svg', { density: 300 }).resize(1024, 500).flatten({ background: '#062E22' }).removeAlpha().png().toFile('play-feature-v2-1024x500.png');
  for (const f of ['app-icon-v2-1024.png', 'app-adaptive-v2-1024.png', 'play-icon-v2-512.png', 'splash-v2-1024.png', 'play-feature-v2-1024x500.png']) {
    const m = await sharp(f).metadata();
    console.log(f, `${m.width}x${m.height}`, `canaux=${m.channels}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
