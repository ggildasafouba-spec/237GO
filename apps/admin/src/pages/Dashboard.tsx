import React, { useEffect, useState } from 'react';
import api from '../config/api';

interface Stats {
  totalUsers: number;
  totalDrivers: number;
  totalRides: number;
  totalDeliveries: number;
  totalRevenue: number;
  activeRides: number;
  pendingDrivers: number;
  todayRides: number;
}

interface SosAlert {
  id: string;
  lat: number;
  lng: number;
  rideId: string | null;
  createdAt: string;
  user?: { firstName: string; lastName: string; phone: string };
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats>({
    totalUsers: 0, totalDrivers: 0, totalRides: 0,
    totalDeliveries: 0, totalRevenue: 0, activeRides: 0,
    pendingDrivers: 0, todayRides: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [sosAlerts, setSosAlerts] = useState<SosAlert[]>([]);

  useEffect(() => {
    api.get('/admin/stats')
      .then((res) => setStats(res.data.data))
      .catch((err) => setError(err.response?.data?.message || 'Erreur de chargement'))
      .finally(() => setIsLoading(false));

    // Charger les alertes SOS actives
    api.get('/admin/sos-alerts?status=ACTIVE')
      .then((res) => setSosAlerts(res.data.data || []))
      .catch(() => { /* non bloquant */ });
  }, []);

  const resolveSos = async (id: string) => {
    try {
      await api.patch(`/admin/sos-alerts/${id}/resolve`);
      setSosAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch {
      alert("Impossible de marquer l'alerte comme traitée.");
    }
  };

  const cards = [
    { label: 'Utilisateurs', value: stats.totalUsers.toLocaleString(), icon: '👥', color: '#1976D2' },
    { label: 'Chauffeurs actifs', value: stats.totalDrivers.toLocaleString(), icon: '🚗', color: '#388E3C' },
    { label: 'Courses totales', value: stats.totalRides.toLocaleString(), icon: '🛣️', color: '#7B1FA2' },
    { label: 'Livraisons', value: stats.totalDeliveries.toLocaleString(), icon: '📦', color: '#E65100' },
    { label: 'Courses aujourd\'hui', value: stats.todayRides.toLocaleString(), icon: '📈', color: '#00838F' },
    { label: 'Courses en cours', value: stats.activeRides.toLocaleString(), icon: '🔴', color: '#D32F2F' },
    { label: 'Chauffeurs en attente', value: stats.pendingDrivers.toLocaleString(), icon: '⏳', color: '#F57C00' },
    { label: 'Revenus total', value: `${(stats.totalRevenue / 1000000).toFixed(1)}M XAF`, icon: '💰', color: '#1DB954' },
  ];

  return (
    <div>
      <div style={styles.header}>
        <h1 style={styles.title}>Dashboard</h1>
        <p style={styles.subtitle}>Vue d'ensemble de la plateforme 237GO</p>
      </div>

      {error && <div style={styles.errorBox}>{error}</div>}
      {isLoading ? (
        <div style={styles.loading}>Chargement des statistiques...</div>
      ) : (
        <>
          <div style={styles.grid}>
            {cards.map((card) => (
              <div key={card.label} style={styles.card}>
                <div style={styles.cardHeader}>
                  <span style={styles.cardIcon}>{card.icon}</span>
                  <span style={{ ...styles.cardValue, color: card.color }}>{card.value}</span>
                </div>
                <p style={styles.cardLabel}>{card.label}</p>
              </div>
            ))}
          </div>

          {/* Alertes SOS actives (urgences) */}
          {sosAlerts.length > 0 && (
            <div style={styles.section}>
              <h2 style={styles.sectionTitle}>🚨 Alertes SOS actives</h2>
              <div style={styles.alertList}>
                {sosAlerts.map((a) => (
                  <div key={a.id} style={{ ...styles.alert, borderLeftColor: '#D32F2F', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <div>
                      <strong>
                        {a.user ? `${a.user.firstName} ${a.user.lastName}` : 'Utilisateur'}
                        {a.user?.phone ? ` (${a.user.phone})` : ''}
                      </strong>
                      {' — '}
                      <a href={`https://maps.google.com/?q=${a.lat},${a.lng}`} target="_blank" rel="noreferrer" style={{ color: '#1976D2' }}>
                        voir la position
                      </a>
                      {a.rideId ? ` • Course #${a.rideId.substring(0, 8)}` : ''}
                      <div style={{ color: '#757575', fontSize: 12, marginTop: 2 }}>
                        {new Date(a.createdAt).toLocaleString('fr-FR')}
                      </div>
                    </div>
                    <button onClick={() => resolveSos(a.id)} style={styles.resolveBtn}>Marquer traitée</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Alertes */}
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>⚠️ Alertes</h2>
            <div style={styles.alertList}>
              {stats.pendingDrivers > 0 && (
                <div style={{ ...styles.alert, borderLeftColor: '#F57C00' }}>
                  <strong>{stats.pendingDrivers} chauffeur(s)</strong> en attente de vérification
                </div>
              )}
              {stats.activeRides > 40 && (
                <div style={{ ...styles.alert, borderLeftColor: '#D32F2F' }}>
                  <strong>Forte demande !</strong> {stats.activeRides} courses simultanées
                </div>
              )}
              <div style={{ ...styles.alert, borderLeftColor: '#388E3C' }}>
                <strong>Système opérationnel</strong> — Tous les services fonctionnent normalement
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: { marginBottom: 32 },
  title: { fontSize: 28, fontWeight: 700 },
  subtitle: { color: '#757575', marginTop: 4 },
  errorBox: { backgroundColor: '#FFEBEE', color: '#D32F2F', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14 },
  loading: { backgroundColor: '#fff', padding: 48, borderRadius: 12, textAlign: 'center', color: '#999' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 20, marginBottom: 40 },
  card: { backgroundColor: '#fff', padding: 24, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardIcon: { fontSize: 24 },
  cardValue: { fontSize: 24, fontWeight: 800 },
  cardLabel: { color: '#757575', fontSize: 14 },
  section: { marginBottom: 32 },
  sectionTitle: { fontSize: 20, fontWeight: 700, marginBottom: 16 },
  alertList: { display: 'flex', flexDirection: 'column', gap: 12 },
  alert: { backgroundColor: '#fff', padding: 16, borderRadius: 8, borderLeft: '4px solid #ccc', fontSize: 14 },
  resolveBtn: { padding: '8px 14px', backgroundColor: '#1DB954', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' },
};
