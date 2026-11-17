import React, { useEffect, useRef, useState } from 'react';
import api from '../config/api';

/**
 * Surveillance des alertes SOS, sur TOUTES les pages de l'administration.
 *
 * Avant : les alertes n'apparaissaient que sur le Dashboard, et seulement en rechargeant la page.
 * Maintenant : vérification toutes les 10 s, bandeau rouge en haut de l'écran, son d'alarme,
 * notification du navigateur et titre de l'onglet qui clignote quand un SOS arrive.
 *
 * (Interrogation régulière plutôt que temps réel : l'admin passe par le proxy Vercel /api,
 * qui ne relaie pas les connexions temps réel. 10 s suffisent pour une urgence.)
 */

interface SosAlert {
  id: string;
  lat: number;
  lng: number;
  rideId: string | null;
  createdAt: string;
  updatedAt: string;
  user?: { firstName: string; lastName: string; phone: string };
}

const POLL_MS = 10_000;
const BASE_TITLE = document.title;

function beep(ctx: AudioContext | null) {
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    // Sirène courte : 3 bips alternés
    [0, 0.35, 0.7].forEach((t, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = i % 2 ? 660 : 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.32);
    });
  } catch {
    /* son indisponible */
  }
}

const since = (iso: string) => {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'à l\'instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  return `il y a ${h} h ${min % 60} min`;
};

export default function SosWatcher() {
  const [alerts, setAlerts] = useState<SosAlert[]>([]);
  const [soundOn, setSoundOn] = useState(false);
  const [, tick] = useState(0);
  const seen = useRef<Map<string, string>>(new Map()); // id -> updatedAt déjà signalé
  const first = useRef(true);
  const audio = useRef<AudioContext | null>(null);

  // Le son ne peut démarrer qu'après un clic (règle des navigateurs)
  const enableAlerts = async () => {
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (Ctx && !audio.current) audio.current = new Ctx();
      await audio.current?.resume();
      beep(audio.current);
    } catch { /* pas de son */ }
    if ('Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch { /* refusé */ }
    }
    setSoundOn(true);
  };

  useEffect(() => {
    let stopped = false;

    const poll = async () => {
      try {
        const res = await api.get('/admin/sos-alerts?status=ACTIVE');
        if (stopped) return;
        const list: SosAlert[] = res.data?.data || [];

        // Nouvelle alerte, ou alerte mise à jour (2e appui = nouvelle position)
        const fresh = list.filter((a) => seen.current.get(a.id) !== a.updatedAt);
        list.forEach((a) => seen.current.set(a.id, a.updatedAt));

        if (fresh.length > 0 && !first.current) {
          beep(audio.current);
          if ('Notification' in window && Notification.permission === 'granted') {
            fresh.forEach((a) => {
              const who = a.user ? `${a.user.firstName} ${a.user.lastName}` : 'Un utilisateur';
              try {
                new Notification('🚨 Alerte SOS — 237GO', { body: `${who}${a.user?.phone ? ` (${a.user.phone})` : ''}`, tag: a.id, requireInteraction: true });
              } catch { /* non supporté */ }
            });
          }
        }
        first.current = false;
        setAlerts(list);
      } catch {
        /* réseau : nouvel essai au prochain tour */
      }
    };

    poll();
    const id = setInterval(poll, POLL_MS);
    const clock = setInterval(() => tick((n) => n + 1), 30_000); // « il y a X min »
    return () => { stopped = true; clearInterval(id); clearInterval(clock); };
  }, []);

  // Titre de l'onglet qui clignote tant qu'une alerte est active
  useEffect(() => {
    if (alerts.length === 0) { document.title = BASE_TITLE; return; }
    let on = false;
    const id = setInterval(() => {
      on = !on;
      document.title = on ? `🚨 SOS (${alerts.length}) — 237GO Admin` : BASE_TITLE;
    }, 1000);
    return () => { clearInterval(id); document.title = BASE_TITLE; };
  }, [alerts.length]);

  // Son répété toutes les 30 s tant qu'une alerte n'est pas traitée
  useEffect(() => {
    if (alerts.length === 0 || !soundOn) return;
    const id = setInterval(() => beep(audio.current), 30_000);
    return () => clearInterval(id);
  }, [alerts.length, soundOn]);

  const resolve = async (id: string) => {
    if (!window.confirm('Marquer cette alerte comme traitée ? (la personne a été contactée et est en sécurité)')) return;
    try {
      await api.patch(`/admin/sos-alerts/${id}/resolve`);
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch {
      alert('Impossible de marquer l\'alerte comme traitée.');
    }
  };

  return (
    <>
      {!soundOn && (
        <div style={styles.enableBar}>
          <span>🔔 Activez le son et les notifications pour être prévenu immédiatement d'une alerte SOS.</span>
          <button style={styles.enableBtn} onClick={enableAlerts}>Activer</button>
        </div>
      )}

      {alerts.length > 0 && (
        <div style={styles.banner} role="alert">
          <div style={styles.bannerTitle}>🚨 {alerts.length} alerte{alerts.length > 1 ? 's' : ''} SOS active{alerts.length > 1 ? 's' : ''} — rappelez la personne immédiatement</div>
          {alerts.map((a) => (
            <div key={a.id} style={styles.row}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <strong>{a.user ? `${a.user.firstName} ${a.user.lastName}` : 'Utilisateur'}</strong>
                {a.user?.phone && (
                  <> — <a href={`tel:${a.user.phone.startsWith('+') ? a.user.phone : `+237${a.user.phone}`}`} style={styles.link}>📞 {a.user.phone}</a></>
                )}
                <div style={styles.meta}>
                  Déclenchée {since(a.createdAt)}
                  {a.updatedAt !== a.createdAt ? ` · position mise à jour ${since(a.updatedAt)}` : ''}
                  {a.rideId ? ` · Course #${a.rideId.substring(0, 8)}` : ''}
                </div>
              </div>
              <a href={`https://maps.google.com/?q=${a.lat},${a.lng}`} target="_blank" rel="noreferrer" style={styles.mapBtn}>📍 Position</a>
              <button onClick={() => resolve(a.id)} style={styles.resolveBtn}>✓ Traitée</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  enableBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
    background: '#FFF8E1', border: '1px solid #FCD116', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 14,
  },
  enableBtn: { background: '#141A17', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 700, cursor: 'pointer' },
  banner: {
    position: 'sticky', top: 0, zIndex: 50, background: '#C62828', color: '#fff', borderRadius: 12,
    padding: '14px 16px', marginBottom: 20, boxShadow: '0 6px 20px rgba(198,40,40,0.35)',
  },
  bannerTitle: { fontWeight: 800, fontSize: 16, marginBottom: 8 },
  row: {
    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
    background: 'rgba(255,255,255,0.12)', borderRadius: 8, padding: '10px 12px', marginTop: 8,
  },
  link: { color: '#fff', fontWeight: 700 },
  meta: { fontSize: 12, opacity: 0.85, marginTop: 2 },
  mapBtn: { background: '#fff', color: '#C62828', textDecoration: 'none', borderRadius: 6, padding: '8px 12px', fontWeight: 700, fontSize: 13 },
  resolveBtn: { background: '#1DB954', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 12px', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
};
