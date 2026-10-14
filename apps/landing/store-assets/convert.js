const sharp = require('sharp');

(async () => {
  // Icône Play Store (512)
  await sharp('icon.svg', { density: 300 }).resize(512, 512).png().toFile('icon-512.png');
  console.log('icon-512.png OK');

  // Bannière Store (1024x500) avec slogan bilingue
  await sharp('feature.svg', { density: 300 }).resize(1024, 500).png().toFile('feature-1024x500.png');
  console.log('feature-1024x500.png OK');

  // Icône de l'app (1024)
  await sharp('app-icon.svg', { density: 300 }).resize(1024, 1024).png().toFile('app-icon-1024.png');
  console.log('app-icon-1024.png OK');

  // Adaptive icon Android (1024, logo centré, fond transparent)
  await sharp('app-adaptive.svg', { density: 300 }).resize(1024, 1024).png().toFile('app-adaptive-1024.png');
  console.log('app-adaptive-1024.png OK');

  // Favicon web (48)
  await sharp('app-icon.svg', { density: 300 }).resize(48, 48).png().toFile('app-favicon-48.png');
  console.log('app-favicon-48.png OK');
})().catch((e) => { console.error(e); process.exit(1); });
