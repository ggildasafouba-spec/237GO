import React, { useState } from 'react';

interface Ride {
  id: string;
  passengerName: string;
  driverName: string;
  pickup: string;
  dropoff: string;
  status: string;
  price: number;
  vehicleType: string;
  createdAt: string;
}

export default function Rides() {
  const [rides] = useState<Ride[]>([
    { id: 'r1', passengerName: 'Jean Mballa', driverName: 'Aimé Fotso', pickup: 'Bonabéri', dropoff: 'Akwa', status: 'COMPLETED', price: 1500, vehicleType: 'MOTO', createdAt: '2026-08-12T10:30:00' },
    { id: 'r2', passengerName: 'Marie Ngo', driverName: 'Paul Tchamba', pickup: 'Deido', dropoff: 'Bonamoussadi', status: 'IN_PROGRESS', price: 2500, vehicleType: 'CAR_ECONOMY', createdAt: '2026-08-12T11:00:00' },
    { id: 'r3', passengerName: 'Claude Eto', driverName: '-', pickup: 'Makepe', dropoff: 'PK14', status: 'PENDING', price: 3000, vehicleType: 'CAR_COMFORT', createdAt: '2026-08-12T11:15:00' },
    { id: 'r4', passengerName: 'Sylvie Boko', driverName: 'Aimé Fotso', pickup: 'Logbessou', dropoff: 'Village', status: 'CANCELLED', price: 1000, vehicleType: 'MOTO', createdAt: '2026-08-12T09:45:00' },
  ]);

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'COMPLETED': return { bg: '#E8F5E9', color: '#388E3C', label: '✅ Terminée' };
      case 'IN_PROGRESS': return { bg: '#E3F2FD', color: '#1976D2', label: '🚗 En cours' };
      case 'PENDING': return { bg: '#FFF8E1', color: '#F57C00', label: '⏳ En attente' };
      case 'CANCELLED': return { bg: '#FFEBEE', color: '#D32F2F', label: '❌ Annulée' };
      default: return { bg: '#f5f5f5', color: '#757575', label: status };
    }
  };

  return (
    <div>
      <div style={styles.header}>
        <h1 style={styles.title}>Courses</h1>
        <p style={styles.subtitle}>Suivi des courses en temps réel</p>
      </div>

      <div style={styles.statsRow}>
        <div style={{ ...styles.stat, borderLeftColor: '#F57C00' }}>
          <span style={styles.statValue}>{rides.filter((r) => r.status === 'PENDING').length}</span>
          <span style={styles.statLabel}>En attente</span>
        </div>
        <div style={{ ...styles.stat, borderLeftColor: '#1976D2' }}>
          <span style={styles.statValue}>{rides.filter((r) => r.status === 'IN_PROGRESS').length}</span>
          <span style={styles.statLabel}>En cours</span>
        </div>
        <div style={{ ...styles.stat, borderLeftColor: '#388E3C' }}>
          <span style={styles.statValue}>{rides.filter((r) => r.status === 'COMPLETED').length}</span>
          <span style={styles.statLabel}>Terminées</span>
        </div>
        <div style={{ ...styles.stat, borderLeftColor: '#D32F2F' }}>
          <span style={styles.statValue}>{rides.filter((r) => r.status === 'CANCELLED').length}</span>
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
        {rides.map((ride) => {
          const status = getStatusStyle(ride.status);
          return (
            <div key={ride.id} style={styles.tableRow}>
              <span style={{ ...styles.cell, flex: 0.5, fontSize: 12, color: '#757575' }}>
                #{ride.id.substring(0, 6)}
              </span>
              <span style={styles.cell}>{ride.passengerName}</span>
              <span style={styles.cell}>{ride.driverName}</span>
              <span style={{ ...styles.cell, flex: 1.5, fontSize: 13 }}>
                {ride.pickup} → {ride.dropoff}
              </span>
              <span style={{ ...styles.cell, fontSize: 12 }}>{ride.vehicleType}</span>
              <span style={{ ...styles.cell, fontWeight: 700, color: '#1B5E20' }}>
                {ride.price.toLocaleString()} F
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
        })}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: { marginBottom: 24 },
  title: { fontSize: 28, fontWeight: 700 },
  subtitle: { color: '#757575', marginTop: 4 },
  statsRow: { display: 'flex', gap: 16, marginBottom: 24 },
  stat: { flex: 1, backgroundColor: '#fff', padding: 20, borderRadius: 10, borderLeft: '4px solid #ccc', textAlign: 'center' },
  statValue: { display: 'block', fontSize: 28, fontWeight: 800, color: '#212121' },
  statLabel: { fontSize: 13, color: '#757575' },
  table: { backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  tableHeader: { display: 'flex', padding: '14px 20px', backgroundColor: '#f9f9f9', borderBottom: '1px solid #e0e0e0', fontWeight: 700, fontSize: 12, color: '#757575' },
  tableRow: { display: 'flex', padding: '14px 20px', borderBottom: '1px solid #f5f5f5', alignItems: 'center', fontSize: 14 },
  cell: { flex: 1, display: 'flex', alignItems: 'center' },
};
