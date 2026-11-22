/**
 * L'app est bloquée en mode vertical (app.json : "orientation": "portrait").
 * Android en déduit l'exigence « android.hardware.screen.portrait » OBLIGATOIRE, et Google Play
 * masque alors l'app sur certains appareils (tablettes posées à l'horizontale, Chromebooks,
 * Android XR). On la déclare FACULTATIVE : l'app reste verticale, mais s'installe partout.
 */
const { withAndroidManifest } = require('expo/config-plugins');

const FEATURE = 'android.hardware.screen.portrait';

module.exports = function withOptionalPortrait(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest['uses-feature'] = (manifest['uses-feature'] || []).filter(
      (f) => f?.$?.['android:name'] !== FEATURE
    );
    manifest['uses-feature'].push({ $: { 'android:name': FEATURE, 'android:required': 'false' } });
    return cfg;
  });
};
