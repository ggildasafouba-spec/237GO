// Visuels conformes Google Play :
//  - icône 512×512, carré plein (Google arrondit lui-même les coins), sans transparence ;
//  - image d'en-tête 1024×500, PNG 24 bits sans transparence (exigé par Google).
const sharp = require('sharp');
const fs = require('fs');

(async () => {
  const iconSvg = fs.readFileSync('icon.svg', 'utf8').replace('rx="112" ', '');
  await sharp(Buffer.from(iconSvg), { density: 300 })
    .resize(512, 512).flatten({ background: '#1DB954' }).removeAlpha().png().toFile('play-icon-512.png');
  await sharp('feature.svg', { density: 300 })
    .resize(1024, 500).flatten({ background: '#0B3D22' }).removeAlpha().png().toFile('play-feature-1024x500.png');
  for (const f of ['play-icon-512.png', 'play-feature-1024x500.png']) {
    const m = await sharp(f).metadata();
    console.log(f, `${m.width}x${m.height}`, `canaux=${m.channels}`, `${(fs.statSync(f).size / 1024).toFixed(0)} Ko`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
