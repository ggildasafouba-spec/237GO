import React, { useState } from 'react';

export default function Deliveries() {
  const [deliveries] = useState([
    { id: 'd1', sender: 'Jean Mballa', driver: 'Paul Tchamba', pickup: 'Akwa', dropoff: 'Bonabéri', packageType: 'SMALL_PACKAGE', status: 'IN_TRANSIT', price: 1200, createdAt: '2026-08-12T10:00:00' },
    { id: 'd2', sender: 'Marie Ngo', driver: '-', pickup: 'Deido', dropoff: 'Makepe', packageType: 'FOOD', status: 'PENDING', price: 800, createdAt: '2026-08-12T11:30:00' },
    { id: 'd3', sender: 'Claude Eto', driver: 'Aimé Fotso', pickup: 'Bonamoussadi', dropoff: 'Ndokoti', packageType: 'DOCUMENT', status: 'DELIVERED', price: 600, createdAt: '2026-08-12T09:15:00' },
  ]);

  const getStatusBadge = (status: string) => {
    const map: Record<string, { bg: string; color: string; label: string }> = {
      PENDING: { bg: '#FFF8E1', color: '#F57C00', label: '⏳ En attente' },
      IN_TRANSIT: { bg: '#E3F2FD', color: '#1976D2', label: '🚗 En route' },
      DELIVERED: { bg: '#E8F5E9', color: '#388E3C', label: '✅ Livrée' },
      CANCELLED: { bg: '#FFEBEE', color: '#D32F2F', label: '❌ Annulée' },
    };
    return map[status] || { bg: '#f5f5f5', color: '#757575', label: status };
  };

  return (
    <div>
      <div style={styles.header}>
        <h1 style={styles.title}>Livraisons</h1>
        <p style={styles.subtitle}>{deliveries.length} livraisons</p>
      </div>

      <div style={styles.table}>
        <div style={styles.tableHeader}>
          <span style={styles.cell}>Expéditeur</span>
          <span style={styles.cell}>Livreur</span>
          <span style={{ ...styles.cell, flex: 1.5 }}>Trajet</span>
          <span style={styles.cell}>Type</span>
          <span style={styles.cell}>Prix</span>
          <span style={styles.cell}>Statut</span>
        </div>
        {deliveries.map((d) => {
          const badge = getStatusBadge(d.status);
          return (
            <div key={d.id} style={styles.tableRow}>
              <span style={styles.cell}>{d.sender}</span>
              <span style={styles.cell}>{d.driver}</span>
              <span style={{ ...styles.cell, flex: 1.5, fontSize: 13 }}>{d.pickup} → {d.dropoff}</span>
              <span style={{ ...styles.cell, fontSize: 12 }}>{d.packageType}</span>
              <span style={{ ...styles.cell, fontWeight: 700, color: '#1B5E20' }}>{d.price.toLocaleString()} F</span>
              <span style={styles.cell}>
                <span style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, backgroundColor: badge.bg, color: badge.color }}>
                  {badge.label}
                </span>
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
  table: { backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  tableHeader: { display: 'flex', padding: '14px 20px', backgroundColor: '#f9f9f9', borderBottom: '1px solid #e0e0e0', fontWeight: 700, fontSize: 12, color: '#757575' },
  tableRow: { display: 'flex', padding: '14px 20px', borderBottom: '1px solid #f5f5f5', alignItems: 'center', fontSize: 14 },
  cell: { flex: 1, display: 'flex', alignItems: 'center' },
};
