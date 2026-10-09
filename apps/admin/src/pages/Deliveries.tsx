import React, { useEffect, useState } from 'react';
import api from '../config/api';

interface Party {
  firstName: string;
  lastName: string;
  phone: string;
}

interface Delivery {
  id: string;
  sender: Party;
  driver: Party | null;
  pickupAddress: string;
  dropoffAddress: string;
  packageType: string;
  status: string;
  estimatedPrice: number;
  finalPrice: number | null;
  createdAt: string;
}

export default function Deliveries() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/admin/deliveries', { params: { limit: '100' } })
      .then((res) => setDeliveries(res.data.data.deliveries || []))
      .catch((err) => setError(err.response?.data?.message || 'Erreur de chargement'))
      .finally(() => setIsLoading(false));
  }, []);

  const getStatusBadge = (status: string) => {
    const map: Record<string, { bg: string; color: string; label: string }> = {
      PENDING: { bg: '#FFF8E1', color: '#F57C00', label: '⏳ En attente' },
      ACCEPTED: { bg: '#E1F5FE', color: '#0277BD', label: '👍 Acceptée' },
      PICKING_UP: { bg: '#F3E5F5', color: '#7B1FA2', label: '📍 Récupération' },
      IN_TRANSIT: { bg: '#E3F2FD', color: '#1976D2', label: '🚗 En route' },
      DELIVERED: { bg: '#E8F5E9', color: '#388E3C', label: '✅ Livrée' },
      CANCELLED: { bg: '#FFEBEE', color: '#D32F2F', label: '❌ Annulée' },
    };
    return map[status] || { bg: '#f5f5f5', color: '#757575', label: status };
  };

  const fullName = (p: Party | null) => (p ? `${p.firstName} ${p.lastName}` : '-');

  return (
    <div>
      <div style={styles.header}>
        <h1 style={styles.title}>Livraisons</h1>
        <p style={styles.subtitle}>{deliveries.length} livraison(s)</p>
      </div>

      {error && <div style={styles.errorBox}>{error}</div>}

      <div style={styles.table}>
        <div style={styles.tableHeader}>
          <span style={styles.cell}>Expéditeur</span>
          <span style={styles.cell}>Livreur</span>
          <span style={{ ...styles.cell, flex: 1.5 }}>Trajet</span>
          <span style={styles.cell}>Type</span>
          <span style={styles.cell}>Prix</span>
          <span style={styles.cell}>Statut</span>
        </div>
        {isLoading ? (
          <div style={styles.empty}>Chargement...</div>
        ) : deliveries.length === 0 ? (
          <div style={styles.empty}>Aucune livraison</div>
        ) : (
          deliveries.map((d) => {
            const badge = getStatusBadge(d.status);
            return (
              <div key={d.id} style={styles.tableRow}>
                <span style={styles.cell}>{fullName(d.sender)}</span>
                <span style={styles.cell}>{fullName(d.driver)}</span>
                <span style={{ ...styles.cell, flex: 1.5, fontSize: 13 }}>{d.pickupAddress} → {d.dropoffAddress}</span>
                <span style={{ ...styles.cell, fontSize: 12 }}>{d.packageType}</span>
                <span style={{ ...styles.cell, fontWeight: 700, color: '#1DB954' }}>{(d.finalPrice || d.estimatedPrice).toLocaleString()} F</span>
                <span style={styles.cell}>
                  <span style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, backgroundColor: badge.bg, color: badge.color }}>
                    {badge.label}
                  </span>
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
  table: { backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  tableHeader: { display: 'flex', padding: '14px 20px', backgroundColor: '#f9f9f9', borderBottom: '1px solid #e0e0e0', fontWeight: 700, fontSize: 12, color: '#757575' },
  tableRow: { display: 'flex', padding: '14px 20px', borderBottom: '1px solid #f5f5f5', alignItems: 'center', fontSize: 14 },
  cell: { flex: 1, display: 'flex', alignItems: 'center' },
  empty: { padding: 48, textAlign: 'center', color: '#999' },
};
