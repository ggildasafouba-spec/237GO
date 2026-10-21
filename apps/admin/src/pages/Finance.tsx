import React, { useEffect, useState, useCallback } from 'react';
import api from '../config/api';

interface Transaction {
  id: string;
  type: string;
  amount: number;
  user: string;
  method: string;
  date: string;
  status: string;
}

interface FinanceData {
  totalRevenue: number;
  commission: number;
  walletDeposits: number;
  walletWithdrawals: number;
  recentTransactions: Transaction[];
}

export default function Finance() {
  const [period, setPeriod] = useState('month');
  const [data, setData] = useState<FinanceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const loadFinance = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const res = await api.get('/admin/finance/summary', { params: { period } });
      setData(res.data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erreur de chargement');
    } finally {
      setIsLoading(false);
    }
  }, [period]);

  useEffect(() => {
    loadFinance();
  }, [loadFinance]);

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'DEPOSIT': return { label: '↓ Recharge', color: '#388E3C' };
      case 'WITHDRAWAL': return { label: '↑ Retrait', color: '#D32F2F' };
      case 'PAYMENT': return { label: '💳 Paiement', color: '#1976D2' };
      case 'REFUND': return { label: '↩️ Remboursement', color: '#F57C00' };
      case 'BONUS': return { label: '🎁 Bonus', color: '#7B1FA2' };
      default: return { label: type, color: '#757575' };
    }
  };

  const fmt = (n: number) => (n / 1000000).toFixed(2) + 'M XAF';

  const [resetting, setResetting] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [resetResult, setResetResult] = useState<string>('');

  const openResetModal = () => {
    setResetConfirmText('');
    setResetResult('');
    setShowResetModal(true);
  };

  const handleResetTestData = async () => {
    if (resetConfirmText !== 'RESET') return;
    setResetting(true);
    setResetResult('');
    try {
      const res = await api.post('/admin/reset-test-data', { confirm: 'RESET' });
      setResetResult('✅ ' + (res.data?.message || 'Données réinitialisées.'));
      await loadFinance();
      setResetConfirmText('');
    } catch (err: any) {
      setResetResult('❌ ' + (err.response?.data?.message || err.message || 'Échec de la réinitialisation'));
    } finally {
      setResetting(false);
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
          <button type="button" onClick={openResetModal} disabled={resetting} style={styles.resetBtn}>
            {resetting ? 'Réinitialisation…' : '🗑️ Réinitialiser les données de test'}
          </button>
        </div>
      </div>

      {showResetModal && (
        <div style={styles.modalOverlay} onClick={() => !resetting && setShowResetModal(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.modalTitle}>⚠️ Réinitialiser les données de test</h2>
            <p style={styles.modalText}>
              Cette action va <strong>supprimer définitivement</strong> toutes les transactions, escrows,
              courses, livraisons, covoiturages, locations, commandes et avis, puis remettre tous les
              soldes de portefeuille et points de fidélité à 0.
            </p>
            <p style={styles.modalText}>
              Les comptes <strong>utilisateurs, chauffeurs, marchands et véhicules sont conservés</strong>.
            </p>
            <p style={{ ...styles.modalText, color: '#D32F2F', fontWeight: 700 }}>
              Cette action est irréversible.
            </p>
            <p style={styles.modalText}>Pour confirmer, tapez <strong>RESET</strong> ci-dessous :</p>
            <input
              autoFocus
              value={resetConfirmText}
              onChange={(e) => setResetConfirmText(e.target.value)}
              placeholder="RESET"
              style={styles.modalInput}
              disabled={resetting}
            />
            {resetResult && <div style={styles.modalResult}>{resetResult}</div>}
            <div style={styles.modalActions}>
              <button
                type="button"
                onClick={() => setShowResetModal(false)}
                disabled={resetting}
                style={styles.modalCancel}
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleResetTestData}
                disabled={resetting || resetConfirmText !== 'RESET'}
                style={{
                  ...styles.modalConfirm,
                  opacity: resetting || resetConfirmText !== 'RESET' ? 0.5 : 1,
                  cursor: resetting || resetConfirmText !== 'RESET' ? 'not-allowed' : 'pointer',
                }}
              >
                {resetting ? 'Réinitialisation…' : 'Confirmer la suppression'}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <div style={styles.errorBox}>{error}</div>}

      {isLoading || !data ? (
        <div style={styles.empty}>Chargement...</div>
      ) : (
        <>
          <div style={styles.grid}>
            <div style={{ ...styles.card, borderTop: '4px solid #1DB954' }}>
              <p style={styles.cardLabel}>Revenus courses</p>
              <p style={styles.cardValue}>{fmt(data.totalRevenue)}</p>
            </div>
            <div style={{ ...styles.card, borderTop: '4px solid #FFB300' }}>
              <p style={styles.cardLabel}>Commissions 237GO (15%)</p>
              <p style={styles.cardValue}>{fmt(data.commission)}</p>
            </div>
            <div style={{ ...styles.card, borderTop: '4px solid #1976D2' }}>
              <p style={styles.cardLabel}>Dépôts portefeuilles</p>
              <p style={styles.cardValue}>{fmt(data.walletDeposits)}</p>
            </div>
            <div style={{ ...styles.card, borderTop: '4px solid #D32F2F' }}>
              <p style={styles.cardLabel}>Retraits</p>
              <p style={styles.cardValue}>{fmt(data.walletWithdrawals)}</p>
            </div>
          </div>

          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Transactions récentes</h2>
            <div className="admin-table-scroll">
            <div style={styles.table}>
              {data.recentTransactions.length === 0 ? (
                <div style={styles.empty}>Aucune transaction</div>
              ) : (
                data.recentTransactions.map((tx) => {
                  const typeInfo = getTypeLabel(tx.type);
                  return (
                    <div key={tx.id} style={styles.txRow}>
                      <span style={{ ...styles.txType, color: typeInfo.color }}>{typeInfo.label}</span>
                      <span style={styles.txUser}>{tx.user}</span>
                      <span style={styles.txMethod}>{tx.method}</span>
                      <span style={{ ...styles.txAmount, color: tx.type === 'WITHDRAWAL' ? '#D32F2F' : '#388E3C' }}>
                        {tx.type === 'WITHDRAWAL' ? '-' : '+'}{tx.amount.toLocaleString()} XAF
                      </span>
                      <span style={styles.txDate}>{new Date(tx.date).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                      <span style={{ ...styles.txStatus, color: tx.status === 'COMPLETED' ? '#388E3C' : '#F57C00' }}>
                        {tx.status === 'COMPLETED' ? '✓' : '⏳'}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  title: { fontSize: 28, fontWeight: 700 },
  periodBtns: { display: 'flex', gap: 8 },
  periodBtn: { padding: '8px 16px', backgroundColor: '#f5f5f5', borderRadius: 6, fontSize: 13, fontWeight: 600, color: '#757575', cursor: 'pointer' },
  periodActive: { backgroundColor: '#1DB954', color: '#fff' },
  resetBtn: { padding: '8px 16px', backgroundColor: '#FFEBEE', color: '#D32F2F', border: '1px solid #F5C6CB', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  modalOverlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 },
  modal: { backgroundColor: '#fff', borderRadius: 12, padding: 24, maxWidth: 480, width: '100%', boxShadow: '0 10px 40px rgba(0,0,0,0.25)' },
  modalTitle: { fontSize: 20, fontWeight: 800, color: '#D32F2F', marginBottom: 16 },
  modalText: { fontSize: 14, color: '#424242', lineHeight: 1.5, marginBottom: 12 },
  modalInput: { width: '100%', padding: '10px 12px', fontSize: 15, border: '2px solid #D32F2F', borderRadius: 8, marginTop: 4, marginBottom: 12, boxSizing: 'border-box', color: '#212121' },
  modalResult: { padding: 12, borderRadius: 8, backgroundColor: '#f5f5f5', fontSize: 14, marginBottom: 12, wordBreak: 'break-word' },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 },
  modalCancel: { padding: '10px 18px', backgroundColor: '#f5f5f5', color: '#424242', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  modalConfirm: { padding: '10px 18px', backgroundColor: '#D32F2F', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700 },
  errorBox: { backgroundColor: '#FFEBEE', color: '#D32F2F', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14 },
  empty: { backgroundColor: '#fff', padding: 48, borderRadius: 12, textAlign: 'center', color: '#999' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16, marginBottom: 32 },
  card: { backgroundColor: '#fff', padding: 24, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  cardLabel: { fontSize: 13, color: '#757575', marginBottom: 8 },
  cardValue: { fontSize: 22, fontWeight: 800, color: '#212121' },
  section: { marginTop: 32 },
  sectionTitle: { fontSize: 20, fontWeight: 700, marginBottom: 16 },
  table: { backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  txRow: { display: 'flex', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid #f5f5f5', fontSize: 14, gap: 16 },
  txType: { width: 140, fontWeight: 700, fontSize: 13 },
  txUser: { flex: 1, fontWeight: 500 },
  txMethod: { width: 130, fontSize: 12, color: '#757575' },
  txAmount: { width: 130, fontWeight: 700, textAlign: 'right' },
  txDate: { width: 120, fontSize: 12, color: '#757575' },
  txStatus: { width: 30, fontWeight: 700, textAlign: 'center' },
};
