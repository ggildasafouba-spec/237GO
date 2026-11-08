/**
 * Lance l'API (dist/server.js) avec le profileur CPU de V8, pendant PROFILE_SECONDS,
 * puis écrit le profil dans PROFILE_OUT et s'arrête. Outil de mesure local uniquement.
 */
const inspector = require('inspector');
const fs = require('fs');
const path = require('path');

const seconds = Number(process.env.PROFILE_SECONDS || 60);
const out = process.env.PROFILE_OUT || path.join(__dirname, 'server.cpuprofile');

const session = new inspector.Session();
session.connect();
session.post('Profiler.enable', () => {
  session.post('Profiler.setSamplingInterval', { interval: 500 }, () => {
    session.post('Profiler.start', () => {
      require(path.join(__dirname, '..', 'dist', 'server.js'));
      setTimeout(() => {
        session.post('Profiler.stop', (err, { profile }) => {
          if (!err) fs.writeFileSync(out, JSON.stringify(profile));
          console.log(err ? `Profil: erreur ${err}` : `PROFIL_ECRIT ${out}`);
          process.exit(0);
        });
      }, seconds * 1000);
    });
  });
});
