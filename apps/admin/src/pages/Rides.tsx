import React, { useEffect, useState } from 'react';
import api from '../config/api';

interface Party {
  firstName: string;
  lastName: string;
  phone: string;
}

interface Ride {
  id: string;
  passenger: Party;
  driver: Party | null;
  pickupAddress: string;
  dropoffAddress: string;
  status: string;
  estimatedPrice: number;
  finalPrice: number | null;
  vehicleType: string;
  createdAt: string;
}

export default function Rides() {
  const [rides, setRides] = useState<Ride[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/admin/rides', { params: { limit: '100' } })
      .then((res) => setRides(res.data.data.rides || []))
      .catch((err) => setError(err.response?.data?.message || 'Erreur de chargement'))
      .finally(() => setIsLoading(false));
  }, []);

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'COMPLETED': return { bg: '#E8F5E9', color: '#388E3C', label: '✅ Terminée' };
      case 'IN_PROGRESS': return { bg: '#E3F2FD', color: '#1976D2', label: '🚗 En cours' };
      case 'ACCEPTED': return { bg: '#E1F5FE', color: '#0277BD', label: '👍 Acceptée' };
      case 'DRIVER_ARRIVING': return { bg: '#F3E5F5', color: '#7B1FA2', label: '📍 Arrive' };
      case 'PENDING': return { bg: '#FFF8E1', color: '#F57C00', label: '⏳ En attente' };
      case 'CANCELLED': return { bg: '#FFEBEE', color: '#D32F2F', label: '❌ Annulée' };
      default: return { bg: '#f5f5f5', color: '#757575', label: status };
    }
  };

  const fullName = (p: Party | null) => (p ? `${p.firstName} ${p.lastName}` : '-');
  const countBy = (s: string) => rides.filter((r) => r.status === s).length;

  return (
    <div>
      <div style={styles.header}>
        <h1 style={styles.title}>Courses</h1>
        <p style={styles.subtitle}>Suivi des courses</p>
      </div>

      {error && <div style={styles.errorBox}>{error}</div>}

      <div style={styles.statsRow}>
        <div style={{ ...styles.stat, borderLeftColor: '#F57C00' }}>
          <span style={styles.statValue}>{countBy('PENDING')}</span>
          <span style={styles.statLabel}>En attente</span>
        </div>
        <div style={{ ...styles.stat, borderLeftColor: '#1976D2' }}>
          <span style={styles.statValue}>{countBy('IN_PROGRESS')}</span>
          <span style={styles.statLabel}>En cours</span>
        </div>
        <div style={{ ...styles.stat, borderLeftColor: '#388E3C' }}>
          <span style={styles.statValue}>{countBy('COMPLETED')}</span>
          <span style={styles.statLabel}>Terminées</span>
        </div>
        <div style={{ ...styles.stat, borderLeftColor: '#D32F2F' }}>
          <span style={styles.statValue}>{countBy('CANCELLED')}</span>
          <span style={styles.statLabel}>Annulées</span>
        </div>
      </div>

      <div style={styles.table}>
        <div style={styles.tableHeader}>
          <span style={{ ...styles.cell, flex: 0.5 }}>ID</span>
          <span style={styles.cell}>Passager</span>
          <span style={styles.cell}>Chauffeur</span>
          <span style={{ ...styles.cell, flex: 1.5 }}>Trajet</span>
          <span style={styles.cell}>Type</span>
          <span style={styles.cell}>Prix</span>
          <span style={styles.cell}>Statut</span>
          <span style={styles.cell}>Heure</span>
        </div>
        {isLoading ? (
          <div style={styles.empty}>Chargement...</div>
        ) : rides.length === 0 ? (
          <div style={styles.empty}>Aucune course</div>
        ) : (
          rides.map((ride) => {
            const status = getStatusStyle(ride.status);
            return (
              <div key={ride.id} style={styles.tableRow}>
                <span style={{ ...styles.cell, flex: 0.5, fontSize: 12, color: '#757575' }}>
                  #{ride.id.substring(0, 6)}
                </span>
                <span style={styles.cell}>{fullName(ride.passenger)}</span>
                <span style={styles.cell}>{fullName(ride.driver)}</span>
                <span style={{ ...styles.cell, flex: 1.5, fontSize: 13 }}>
                  {ride.pickupAddress} → {ride.dropoffAddress}
                </span>
                <span style={{ ...styles.cell, fontSize: 12 }}>{ride.vehicleType}</span>
                <span style={{ ...styles.cell, fontWeight: 700, color: '#1DB954' }}>
                  {(ride.finalPrice || ride.estimatedPrice).toLocaleString()} F
                </span>
                <span style={styles.cell}>
                  <span style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, backgroundColor: status.bg, color: status.color }}>
                    {status.label}
                  </span>
                </span>
                <span style={{ ...styles.cell, fontSize: 12, color: '#757575' }}>
                  {new Date(ride.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: { marginBottom: 24 },
  title: { fontSize: 28, fontWeight: 700 },
  subtitle: { color: '#757575', marginTop: 4 },
  errorBox: { backgroundColor: '#FFEBEE', color: '#D32F2F', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14 },
  statsRow: { display: 'flex', gap: 16, marginBottom: 24 },
  stat: { flex: 1, backgroundColor: '#fff', padding: 20, borderRadius: 10, borderLeft: '4px solid #ccc', textAlign: 'center' },
  statValue: { display: 'block', fontSize: 28, fontWeight: 800, color: '#212121' },
  statLabel: { fontSize: 13, color: '#757575' },
  table: { backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  tableHeader: { display: 'flex', padding: '14px 20px', backgroundColor: '#f9f9f9', borderBottom: '1px solid #e0e0e0', fontWeight: 700, fontSize: 12, color: '#757575' },
  tableRow: { display: 'flex', padding: '14px 20px', borderBottom: '1px solid #f5f5f5', alignItems: 'center', fontSize: 14 },
  cell: { flex: 1, display: 'flex', alignItems: 'center' },
  empty: { padding: 48, textAlign: 'center', color: '#999' },
};
