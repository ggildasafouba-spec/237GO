import React, { useState } from 'react';

interface Driver {
  id: string;
  name: string;
  phone: string;
  vehicleType: string;
  plate: string;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED';
  isOnline: boolean;
  totalTrips: number;
  rating: number;
  earnings: number;
}

export default function Drivers() {
  const [drivers] = useState<Driver[]>([
    { id: '1', name: 'Aimé Fotso', phone: '698765432', vehicleType: 'MOTO', plate: 'LT 1234 A', status: 'VERIFIED', isOnline: true, totalTrips: 234, rating: 4.8, earnings: 450000 },
    { id: '2', name: 'Paul Tchamba', phone: '677112233', vehicleType: 'CAR_ECONOMY', plate: 'CE 5678 B', status: 'VERIFIED', isOnline: true, totalTrips: 156, rating: 4.5, earnings: 680000 },
    { id: '3', name: 'Serge Nana', phone: '655443322', vehicleType: 'CAR_VIP', plate: 'LT 9012 C', status: 'PENDING', isOnline: false, totalTrips: 0, rating: 0, earnings: 0 },
    { id: '4', name: 'Eric Kamga', phone: '691223344', vehicleType: 'CAR_COMFORT', plate: 'CE 3456 D', status: 'VERIFIED', isOnline: false, totalTrips: 89, rating: 4.2, earnings: 320000 },
  ]);

  const [filter, setFilter] = useState('ALL');

  const filtered = drivers.filter((d) => {
    if (filter === 'ONLINE') return d.isOnline;
    if (filter === 'PENDING') return d.status === 'PENDING';
    if (filter === 'VERIFIED') return d.status === 'VERIFIED';
    return true;
  });

  return (
    <div>
      <div style={styles.header}>
        <h1 style={styles.title}>Chauffeurs</h1>
        <p style={styles.subtitle}>
          {drivers.filter((d) => d.isOnline).length} en ligne sur {drivers.length} chauffeurs
        </p>
      </div>

      <div style={styles.filters}>
        {['ALL', 'ONLINE', 'VERIFIED', 'PENDING'].map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={{ ...styles.filterBtn, ...(filter === f ? styles.filterActive : {}) }}>
            {f === 'ALL' ? 'Tous' : f === 'ONLINE' ? '🟢 En ligne' : f === 'PENDING' ? '⏳ En attente' : '✅ Vérifiés'}
          </button>
        ))}
      </div>

      <div style={styles.grid}>
        {filtered.map((driver) => (
          <div key={driver.id} style={styles.card}>
            <div style={styles.cardTop}>
              <div style={styles.avatar}>{driver.name[0]}</div>
              <div>
                <h3 style={styles.driverName}>{driver.name}</h3>
                <p style={styles.driverPhone}>+237 {driver.phone}</p>
              </div>
              <span style={{ ...styles.onlineDot, backgroundColor: driver.isOnline ? '#388E3C' : '#BDBDBD' }} />
            </div>
            <div style={styles.cardDetails}>
              <div style={styles.detail}><span style={styles.detailLabel}>Véhicule</span><span>{driver.vehicleType} • {driver.plate}</span></div>
              <div style={styles.detail}><span style={styles.detailLabel}>Courses</span><span>{driver.totalTrips}</span></div>
              <div style={styles.detail}><span style={styles.detailLabel}>Note</span><span>⭐ {driver.rating > 0 ? driver.rating.toFixed(1) : 'N/A'}</span></div>
              <div style={styles.detail}><span style={styles.detailLabel}>Gains</span><span style={{ fontWeight: 700, color: '#1B5E20' }}>{driver.earnings.toLocaleString()} XAF</span></div>
            </div>
            <div style={styles.cardActions}>
              {driver.status === 'PENDING' ? (
                <>
                  <button style={styles.approveBtn}>✅ Approuver</button>
                  <button style={styles.rejectBtn}>❌ Rejeter</button>
                </>
              ) : (
                <button style={styles.viewBtn}>Voir le profil →</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: { marginBottom: 24 },
  title: { fontSize: 28, fontWeight: 700 },
  subtitle: { color: '#757575', marginTop: 4 },
  filters: { display: 'flex', gap: 8, marginBottom: 24 },
  filterBtn: { padding: '8px 16px', backgroundColor: '#f5f5f5', borderRadius: 6, fontSize: 13, fontWeight: 600, color: '#757575' },
  filterActive: { backgroundColor: '#1B5E20', color: '#fff' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  cardTop: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, position: 'relative' },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#1B5E20', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 18 },
  driverName: { fontSize: 16, fontWeight: 700 },
  driverPhone: { fontSize: 13, color: '#757575' },
  onlineDot: { position: 'absolute', right: 0, top: 0, width: 12, height: 12, borderRadius: 6, border: '2px solid #fff' },
  cardDetails: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 },
  detail: { display: 'flex', justifyContent: 'space-between', fontSize: 13 },
  detailLabel: { color: '#757575' },
  cardActions: { display: 'flex', gap: 8 },
  approveBtn: { flex: 1, padding: 10, backgroundColor: '#E8F5E9', color: '#388E3C', borderRadius: 6, fontWeight: 700, fontSize: 13 },
  rejectBtn: { flex: 1, padding: 10, backgroundColor: '#FFEBEE', color: '#D32F2F', borderRadius: 6, fontWeight: 700, fontSize: 13 },
  viewBtn: { flex: 1, padding: 10, backgroundColor: '#f5f5f5', color: '#212121', borderRadius: 6, fontWeight: 600, fontSize: 13, textAlign: 'center' },
};
