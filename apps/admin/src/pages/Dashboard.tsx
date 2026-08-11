import React, { useEffect, useState } from 'react';
import axios from 'axios';

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

export default function Dashboard() {
  const [stats, setStats] = useState<Stats>({
    totalUsers: 0, totalDrivers: 0, totalRides: 0,
    totalDeliveries: 0, totalRevenue: 0, activeRides: 0,
    pendingDrivers: 0, todayRides: 0,
  });

  useEffect(() => {
    // TODO: Endpoint admin stats
    // Données simulées pour le dashboard
    setStats({
      totalUsers: 12450,
      totalDrivers: 834,
      totalRides: 45230,
      totalDeliveries: 8920,
      totalRevenue: 25600000,
      activeRides: 47,
      pendingDrivers: 12,
      todayRides: 328,
    });
  }, []);

  const cards = [
    { label: 'Utilisateurs', value: stats.totalUsers.toLocaleString(), icon: '👥', color: '#1976D2' },
    { label: 'Chauffeurs actifs', value: stats.totalDrivers.toLocaleString(), icon: '🚗', color: '#388E3C' },
    { label: 'Courses totales', value: stats.totalRides.toLocaleString(), icon: '🛣️', color: '#7B1FA2' },
    { label: 'Livraisons', value: stats.totalDeliveries.toLocaleString(), icon: '📦', color: '#E65100' },
    { label: 'Courses aujourd\'hui', value: stats.todayRides.toLocaleString(), icon: '📈', color: '#00838F' },
    { label: 'Courses en cours', value: stats.activeRides.toLocaleString(), icon: '🔴', color: '#D32F2F' },
    { label: 'Chauffeurs en attente', value: stats.pendingDrivers.toLocaleString(), icon: '⏳', color: '#F57C00' },
    { label: 'Revenus total', value: `${(stats.totalRevenue / 1000000).toFixed(1)}M XAF`, icon: '💰', color: '#1B5E20' },
  ];

  return (
    <div>
      <div style={styles.header}>
        <h1 style={styles.title}>Dashboard</h1>
        <p style={styles.subtitle}>Vue d'ensemble de la plateforme 237GO</p>
      </div>

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

      {/* Alertes */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>⚠️ Alertes</h2>
        <div style={styles.alertList}>
          {stats.pendingDrivers > 0 && (
            <div style={{ ...styles.alert, borderLeftColor: '#F57C00' }}>
              <strong>{stats.pendingDrivers} chauffeurs</strong> en attente de vérification
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
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: { marginBottom: 32 },
  title: { fontSize: 28, fontWeight: 700 },
  subtitle: { color: '#757575', marginTop: 4 },
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
};
