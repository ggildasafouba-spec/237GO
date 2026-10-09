import React, { useEffect, useState } from 'react';
import api from '../config/api';

interface Merchant {
  id: string;
  shopName: string;
  category: string;
  isOpen: boolean;
  user: { firstName: string; lastName: string; phone: string };
  _count: { products: number; orders: number };
}

export default function Merchants() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/admin/merchants')
      .then((res) => setMerchants(res.data.data || []))
      .catch((err) => setError(err.response?.data?.message || 'Erreur de chargement'))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div>
      <div style={styles.header}>
        <h1 style={styles.title}>Marchands</h1>
        <p style={styles.subtitle}>{merchants.length} marchand(s) sur GO Market</p>
      </div>

      {error && <div style={styles.errorBox}>{error}</div>}

      {isLoading ? (
        <div style={styles.empty}>Chargement...</div>
      ) : merchants.length === 0 ? (
        <div style={styles.empty}>Aucun marchand</div>
      ) : (
        <div style={styles.grid}>
          {merchants.map((m) => (
            <div key={m.id} style={styles.card}>
              <div style={styles.cardHeader}>
                <h3 style={styles.shopName}>{m.shopName}</h3>
                <span style={{ ...styles.status, backgroundColor: m.isOpen ? '#E8F5E9' : '#FFEBEE', color: m.isOpen ? '#388E3C' : '#D32F2F' }}>
                  {m.isOpen ? '🟢 Ouvert' : '🔴 Fermé'}
                </span>
              </div>
              <p style={styles.owner}>{m.user.firstName} {m.user.lastName} • +237 {m.user.phone}</p>
              <p style={styles.category}>{m.category}</p>
              <div style={styles.stats}>
                <div style={styles.stat}><span style={styles.statValue}>{m._count.products}</span><span style={styles.statLabel}>Produits</span></div>
                <div style={styles.stat}><span style={styles.statValue}>{m._count.orders}</span><span style={styles.statLabel}>Commandes</span></div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: { marginBottom: 24 },
  title: { fontSize: 28, fontWeight: 700 },
  subtitle: { color: '#757575', marginTop: 4 },
  errorBox: { backgroundColor: '#FFEBEE', color: '#D32F2F', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14 },
  empty: { backgroundColor: '#fff', padding: 48, borderRadius: 12, textAlign: 'center', color: '#999' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 20 },
  card: { backgroundColor: '#fff', padding: 24, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  shopName: { fontSize: 16, fontWeight: 700, maxWidth: '70%' },
  status: { padding: '4px 10px', borderRadius: 10, fontSize: 11, fontWeight: 600 },
  owner: { fontSize: 13, color: '#757575', marginBottom: 4 },
  category: { fontSize: 12, color: '#1DB954', fontWeight: 600, textTransform: 'capitalize', marginBottom: 16 },
  stats: { display: 'flex', gap: 24 },
  stat: { display: 'flex', flexDirection: 'column', alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: 800, color: '#212121' },
  statLabel: { fontSize: 12, color: '#757575' },
};
