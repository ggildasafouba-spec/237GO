import { Router, Request, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { triggerSos, createTripShare, publicTrip, escapeHtml } from '../lib/safety';

const router = Router();

/**
 * Alerte SOS (HTTP). Plus fiable que le socket seul : l'app reçoit une vraie réponse,
 * même si la connexion temps réel était coupée au moment de l'urgence.
 */
router.post('/sos', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await triggerSos(req.app.get('io'), req.user!.id, req.body || {});
    if ('error' in result) return res.status(result.status).json({ success: false, message: result.error });
    console.log(`🚨 SOS de ${req.user!.id} (alerte ${result.alertId}${result.repeated ? ', répétée' : ''})`);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Erreur SOS:', (error as Error).message);
    res.status(500).json({ success: false, message: 'Échec de l\'alerte. Appelez le 117 directement.' });
  }
});

/** Lien de suivi de la course en cours, à partager par WhatsApp/SMS. */
router.post('/rides/:id/share', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await createTripShare(req.params.id, req.user!.id);
    if ('error' in result) return res.status(result.status).json({ success: false, message: result.error });
    res.json({ success: true, data: result });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

/** Données publiques d'un trajet partagé (sans connexion, jeton signé valable 12 h). */
router.get('/track/:token', async (req: Request, res: Response) => {
  try {
    const trip = await publicTrip(req.params.token);
    if (!trip) return res.status(404).json({ success: false, message: 'Lien de suivi invalide ou expiré' });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: trip });
  } catch {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

export { router as safetyRouter };

// ========== PAGE WEB PUBLIQUE /track/:token ==========

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Recherche d\'un chauffeur…',
  ACCEPTED: 'Chauffeur en route vers le point de départ',
  DRIVER_ARRIVING: 'Chauffeur arrivé au point de départ',
  IN_PROGRESS: 'Course en cours',
  COMPLETED: 'Course terminée — arrivé(e) à destination',
  CANCELLED: 'Course annulée',
};

/**
 * Page lisible sur n'importe quel téléphone, sans application ni JavaScript :
 * elle se recharge toute seule toutes les 20 s pendant la course.
 */
export async function trackPage(req: Request, res: Response) {
  // CSP propre à cette page : pas de script, seulement la carte OpenStreetMap intégrée
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-src https://www.openstreetmap.org; base-uri 'none'; form-action 'none'"
  );
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');

  let trip: Awaited<ReturnType<typeof publicTrip>> = null;
  try {
    trip = await publicTrip(req.params.token);
  } catch {
    trip = null;
  }

  const shell = (title: string, body: string, refresh = false) => `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
${refresh ? '<meta http-equiv="refresh" content="20">' : ''}
<title>${escapeHtml(title)} — 237GO</title>
<style>
body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#F4F7F5;color:#141A17}
header{background:#0B6E4F;color:#fff;padding:16px 20px;font-weight:800;font-size:18px}
main{max-width:560px;margin:0 auto;padding:16px}
.card{background:#fff;border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.status{font-size:18px;font-weight:700}
.muted{color:#5f6b66;font-size:14px}
iframe{width:100%;height:300px;border:0;border-radius:12px}
a.btn{display:block;text-align:center;background:#0B6E4F;color:#fff;text-decoration:none;padding:12px;border-radius:10px;font-weight:700;margin-top:8px}
.row{margin:6px 0}
</style></head>
<body><header>237GO · Suivi de trajet</header><main>${body}</main></body></html>`;

  if (!trip) {
    res.status(404).send(shell('Lien expiré', `<div class="card"><div class="status">Lien invalide ou expiré</div>
      <p class="muted">Ce lien de suivi n'est plus valable (il dure 12 heures). Demandez un nouveau lien à la personne.</p></div>`));
    return;
  }

  const pos = trip.driverPosition;
  const map = pos
    ? (() => {
        const d = 0.01;
        const bbox = [pos.lng - d, pos.lat - d, pos.lng + d, pos.lat + d].map((n) => n.toFixed(5)).join(',');
        return `<div class="card"><iframe title="Position du véhicule" src="https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&amp;layer=mapnik&amp;marker=${pos.lat.toFixed(5)},${pos.lng.toFixed(5)}"></iframe>
          <p class="muted">Position du véhicule, mise à jour le ${escapeHtml(new Date(pos.updatedAt).toLocaleTimeString('fr-FR', { timeZone: 'Africa/Douala', hour: '2-digit', minute: '2-digit' }))} (heure du Cameroun)</p>
          <a class="btn" href="https://maps.google.com/?q=${pos.lat},${pos.lng}">Ouvrir dans Google Maps</a></div>`;
      })()
    : '';

  const driver = trip.driver
    ? `<div class="card"><div class="row"><b>Chauffeur :</b> ${escapeHtml(trip.driver.name)}</div>
        ${trip.driver.vehicle ? `<div class="row"><b>Véhicule :</b> ${escapeHtml(trip.driver.vehicle)}</div>` : ''}
        ${trip.driver.plate ? `<div class="row"><b>Plaque :</b> ${escapeHtml(trip.driver.plate)}</div>` : ''}</div>`
    : '';

  const body = `
    <div class="card"><div class="status">${escapeHtml(STATUS_LABELS[trip.status] || trip.status)}</div>
      <p class="muted">${escapeHtml(trip.passengerFirstName)} partage son trajet avec vous.${trip.active ? ' Cette page se met à jour toute seule.' : ''}</p></div>
    ${map}
    ${driver}
    <div class="card"><div class="row"><b>Départ :</b> ${escapeHtml(trip.pickup.address)}</div>
      <div class="row"><b>Arrivée :</b> ${escapeHtml(trip.dropoff.address)}</div></div>
    <p class="muted">En cas de danger, appelez la police : <a href="tel:117">117</a>.</p>`;

  res.send(shell('Suivi de trajet', body, trip.active));
}
