import React, { useState } from 'react';

export default function Merchants() {
  const [merchants] = useState([
    { id: '1', shopName: 'Mama Ngono - Alimentation', owner: 'Rose Ngono', phone: '691234567', category: 'alimentation', products: 24, orders: 156, isOpen: true },
    { id: '2', shopName: 'Fast Food Makossa', owner: 'Pierre Biya', phone: '677889900', category: 'restaurant', products: 18, orders: 89, isOpen: true },
    { id: '3', shopName: 'Pharmacie du Peuple', owner: 'Dr. Eyinga', phone: '655667788', category: 'pharmacie', products: 45, orders: 210, isOpen: false },
  ]);

  return (
    <div>
      <div style={styles.header}>
        <h1 style={styles.title}>Marchands</h1>
        <p style={styles.subtitle}>{merchants.length} marchands sur GO Market</p>
      </div>

      <div style={styles.grid}>
        {merchants.map((m) => (
          <div key={m.id} style={styles.card}>
            <div style={styles.cardHeader}>
              <h3 style={styles.shopName}>{m.shopName}</h3>
              <span style={{ ...styles.status, backgroundColor: m.isOpen ? '#E8F5E9' : '#FFEBEE', color: m.isOpen ? '#388E3C' : '#D32F2F' }}>
                {m.isOpen ? '🟢 Ouvert' : '🔴 Fermé'}
              </span>
            </div>
            <p style={styles.owner}>{m.owner} • +237 {m.phone}</p>
            <p style={styles.category}>{m.category}</p>
            <div style={styles.stats}>
              <div style={styles.stat}><span style={styles.statValue}>{m.products}</span><span style={styles.statLabel}>Produits</span></div>
              <div style={styles.stat}><span style={styles.statValue}>{m.orders}</span><span style={styles.statLabel}>Commandes</span></div>
            </div>
            <button style={styles.viewBtn}>Voir la boutique →</button>
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
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 20 },
  card: { backgroundColor: '#fff', padding: 24, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  shopName: { fontSize: 16, fontWeight: 700, maxWidth: '70%' },
  status: { padding: '4px 10px', borderRadius: 10, fontSize: 11, fontWeight: 600 },
  owner: { fontSize: 13, color: '#757575', marginBottom: 4 },
  category: { fontSize: 12, color: '#1B5E20', fontWeight: 600, textTransform: 'capitalize', marginBottom: 16 },
  stats: { display: 'flex', gap: 24, marginBottom: 16 },
  stat: { display: 'flex', flexDirection: 'column', alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: 800, color: '#212121' },
  statLabel: { fontSize: 12, color: '#757575' },
  viewBtn: { width: '100%', padding: 10, backgroundColor: '#f5f5f5', borderRadius: 6, fontSize: 13, fontWeight: 600, textAlign: 'center' },
};
