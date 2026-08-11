import React, { useState } from 'react';

export default function Finance() {
  const [period, setPeriod] = useState('month');

  const stats = {
    totalRevenue: 25600000,
    commission: 3840000,
    walletDeposits: 18500000,
    walletWithdrawals: 12300000,
    pendingPayments: 450000,
    avgRidePrice: 1850,
    avgDeliveryPrice: 1200,
  };

  const recentTransactions = [
    { id: '1', type: 'DEPOSIT', amount: 10000, user: 'Jean Mballa', method: 'ORANGE_MONEY', date: '2026-08-12 14:30', status: 'COMPLETED' },
    { id: '2', type: 'PAYMENT', amount: 2500, user: 'Marie Ngo', method: 'MTN_MOMO', date: '2026-08-12 14:15', status: 'COMPLETED' },
    { id: '3', type: 'WITHDRAWAL', amount: 50000, user: 'Aimé Fotso', method: 'ORANGE_MONEY', date: '2026-08-12 13:45', status: 'COMPLETED' },
    { id: '4', type: 'DEPOSIT', amount: 5000, user: 'Claude Eto', method: 'MTN_MOMO', date: '2026-08-12 13:20', status: 'PENDING' },
    { id: '5', type: 'PAYMENT', amount: 1500, user: 'Sylvie Boko', method: 'CASH', date: '2026-08-12 12:50', status: 'COMPLETED' },
  ];

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'DEPOSIT': return { label: '↓ Recharge', color: '#388E3C' };
      case 'WITHDRAWAL': return { label: '↑ Retrait', color: '#D32F2F' };
      case 'PAYMENT': return { label: '💳 Paiement', color: '#1976D2' };
      default: return { label: type, color: '#757575' };
    }
  };

  return (
    <div>
      <div style={styles.header}>
        <h1 style={styles.title}>Finance</h1>
        <div style={styles.periodBtns}>
          {['week', 'month', 'year'].map((p) => (
            <button key={p} onClick={() => setPeriod(p)} style={{ ...styles.periodBtn, ...(period === p ? styles.periodActive : {}) }}>
              {p === 'week' ? 'Semaine' : p === 'month' ? 'Mois' : 'Année'}
            </button>
          ))}
        </div>
      </div>

      <div style={styles.grid}>
        <div style={{ ...styles.card, borderTop: '4px solid #1B5E20' }}>
          <p style={styles.cardLabel}>Revenus totaux</p>
          <p style={styles.cardValue}>{(stats.totalRevenue / 1000000).toFixed(1)}M XAF</p>
        </div>
        <div style={{ ...styles.card, borderTop: '4px solid #FFB300' }}>
          <p style={styles.cardLabel}>Commissions 237GO (15%)</p>
          <p style={styles.cardValue}>{(stats.commission / 1000000).toFixed(1)}M XAF</p>
        </div>
        <div style={{ ...styles.card, borderTop: '4px solid #1976D2' }}>
          <p style={styles.cardLabel}>Dépôts portefeuilles</p>
          <p style={styles.cardValue}>{(stats.walletDeposits / 1000000).toFixed(1)}M XAF</p>
        </div>
        <div style={{ ...styles.card, borderTop: '4px solid #D32F2F' }}>
          <p style={styles.cardLabel}>Retraits</p>
          <p style={styles.cardValue}>{(stats.walletWithdrawals / 1000000).toFixed(1)}M XAF</p>
        </div>
        <div style={styles.card}>
          <p style={styles.cardLabel}>Prix moyen course</p>
          <p style={styles.cardValue}>{stats.avgRidePrice.toLocaleString()} XAF</p>
        </div>
        <div style={styles.card}>
          <p style={styles.cardLabel}>Prix moyen livraison</p>
          <p style={styles.cardValue}>{stats.avgDeliveryPrice.toLocaleString()} XAF</p>
        </div>
      </div>

      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Transactions récentes</h2>
        <div style={styles.table}>
          {recentTransactions.map((tx) => {
            const typeInfo = getTypeLabel(tx.type);
            return (
              <div key={tx.id} style={styles.txRow}>
                <span style={{ ...styles.txType, color: typeInfo.color }}>{typeInfo.label}</span>
                <span style={styles.txUser}>{tx.user}</span>
                <span style={styles.txMethod}>{tx.method}</span>
                <span style={{ ...styles.txAmount, color: tx.type === 'WITHDRAWAL' ? '#D32F2F' : '#388E3C' }}>
                  {tx.type === 'WITHDRAWAL' ? '-' : '+'}{tx.amount.toLocaleString()} XAF
                </span>
                <span style={styles.txDate}>{tx.date}</span>
                <span style={{ ...styles.txStatus, color: tx.status === 'COMPLETED' ? '#388E3C' : '#F57C00' }}>
                  {tx.status === 'COMPLETED' ? '✓' : '⏳'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  title: { fontSize: 28, fontWeight: 700 },
  periodBtns: { display: 'flex', gap: 8 },
  periodBtn: { padding: '8px 16px', backgroundColor: '#f5f5f5', borderRadius: 6, fontSize: 13, fontWeight: 600, color: '#757575' },
  periodActive: { backgroundColor: '#1B5E20', color: '#fff' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16, marginBottom: 32 },
  card: { backgroundColor: '#fff', padding: 24, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  cardLabel: { fontSize: 13, color: '#757575', marginBottom: 8 },
  cardValue: { fontSize: 22, fontWeight: 800, color: '#212121' },
  section: { marginTop: 32 },
  sectionTitle: { fontSize: 20, fontWeight: 700, marginBottom: 16 },
  table: { backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  txRow: { display: 'flex', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid #f5f5f5', fontSize: 14, gap: 16 },
  txType: { width: 120, fontWeight: 700, fontSize: 13 },
  txUser: { flex: 1, fontWeight: 500 },
  txMethod: { width: 130, fontSize: 12, color: '#757575' },
  txAmount: { width: 130, fontWeight: 700, textAlign: 'right' },
  txDate: { width: 140, fontSize: 12, color: '#757575' },
  txStatus: { width: 30, fontWeight: 700, textAlign: 'center' },
};
