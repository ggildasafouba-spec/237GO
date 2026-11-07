import React, { useEffect, useState, useCallback } from 'react';
import api from '../config/api';
import { formatPhone } from '../utils/phone';

interface Withdrawal {
  id: string;
  amount: number;
  paymentMethod: string;
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
  description?: string | null;
  metadata?: { phone?: string; rejectReason?: string | null; operatorRef?: string } | null;
  createdAt: string;
  wallet: {
    balance: number;
    user: { id: string; firstName: string; lastName: string; phone: string };
  };
}

const METHOD_LABELS: Record<string, string> = {
  ORANGE_MONEY: '🟠 Orange Money',
  MTN_MOMO: '🟡 MTN MoMo',
  EXPRESS_UNION: 'Express Union',
};

const FILTERS = [
  { value: 'PENDING', label: 'À payer' },
  { value: 'COMPLETED', label: 'Payés' },
  { value: 'CANCELLED', label: 'Refusés' },
  { value: 'ALL', label: 'Tous' },
];

/**
 * Demandes de retrait.
 * Aucun versement automatique n'est branché : l'admin envoie l'argent par Orange Money / MTN
 * au numéro indiqué, puis clique sur "Marquer payé". "Refuser" recrédite le portefeuille.
 */
export default function Withdrawals() {
  const [items, setItems] = useState<Withdrawal[]>([]);
  const [filter, setFilter] = useState('PENDING');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [actioningId, setActioningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const res = await api.get('/admin/withdrawals', { params: { status: filter } });
      setItems(res.data.data || []);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erreur de chargement');
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const complete = async (w: Withdrawal) => {
    const phone = w.metadata?.phone || w.wallet.user.phone;
    if (!window.confirm(
      `Avez-vous bien envoyé ${w.amount.toLocaleString()} XAF au ${formatPhone(phone)} ` +
      `(${METHOD_LABELS[w.paymentMethod] || w.paymentMethod}) ?`
    )) return;
    const operatorRef = window.prompt('Référence de la transaction Orange / MTN (optionnel) :') || undefined;

    setActioningId(w.id);
    try {
      await api.post(`/admin/withdrawals/${w.id}/complete`, { operatorRef });
      await load();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Erreur');
    } finally {
      setActioningId(null);
    }
  };

  const reject = async (w: Withdrawal) => {
    const reason = window.prompt('Motif du refus (le montant sera recrédité au portefeuille) :');
    if (reason === null) return;

    setActioningId(w.id);
    try {
      await api.post(`/admin/withdrawals/${w.id}/reject`, { reason });
      await load();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Erreur');
    } finally {
      setActioningId(null);
    }
  };

  const statusBadge = (s: Withdrawal['status']) => {
    switch (s) {
      case 'PENDING': return { bg: '#FFF8E1', color: '#F57C00', label: '⏳ À payer' };
      case 'COMPLETED': return { bg: '#E8F5E9', color: '#388E3C', label: '✅ Payé' };
      case 'CANCELLED': return { bg: '#FFEBEE', color: '#D32F2F', label: '↩️ Refusé' };
      default: return { bg: '#f5f5f5', color: '#757575', label: s };
    }
  };

  const pendingTotal = items
    .filter((w) => w.status === 'PENDING')
    .reduce((sum, w) => sum + w.amount, 0);

  return (
    <div>
      <div style={styles.header}>
        <h1 style={styles.title}>Retraits</h1>
        <p style={styles.subtitle}>
          Envoyez l'argent par Orange Money / MTN au numéro indiqué, puis marquez la demande comme payée.
        </p>
      </div>

      <div style={styles.filterRow}>
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            style={{ ...styles.filterBtn, ...(filter === f.value ? styles.filterBtnActive : {}) }}
          >
            {f.label}
          </button>
        ))}
        <button onClick={load} style={styles.refreshBtn}>🔄 Actualiser</button>
      </div>

      {filter === 'PENDING' && items.length > 0 && (
        <div style={styles.totalBox}>
          {items.length} demande(s) à payer · total <strong>{pendingTotal.toLocaleString()} XAF</strong>
        </div>
      )}

      {error && <div style={styles.error}>{error}</div>}

      {isLoading ? (
        <div style={styles.empty}>Chargement...</div>
      ) : items.length === 0 ? (
        <div style={styles.empty}>Aucune demande dans cette catégorie</div>
      ) : (
        <div className="admin-table-scroll">
          <div style={styles.table}>
            <div style={styles.tableHeader}>
              <span style={styles.cell}>Utilisateur</span>
              <span style={styles.cell}>Envoyer à</span>
              <span style={styles.cell}>Montant</span>
              <span style={styles.cell}>Date</span>
              <span style={styles.cell}>Statut</span>
              <span style={{ ...styles.cell, flex: 1.4 }}>Actions</span>
            </div>
            {items.map((w) => {
              const badge = statusBadge(w.status);
              const phone = w.metadata?.phone || w.wallet.user.phone;
              return (
                <div key={w.id} style={styles.tableRow}>
                  <span style={styles.cell}>{w.wallet.user.firstName} {w.wallet.user.lastName}</span>
                  <span style={{ ...styles.cell, flexDirection: 'column', alignItems: 'flex-start' }}>
                    <strong>{formatPhone(phone)}</strong>
                    <span style={{ fontSize: 12, color: '#757575' }}>{METHOD_LABELS[w.paymentMethod] || w.paymentMethod}</span>
                  </span>
                  <span style={{ ...styles.cell, fontWeight: 700, color: '#D32F2F' }}>
                    {w.amount.toLocaleString()} XAF
                  </span>
                  <span style={{ ...styles.cell, fontSize: 12, color: '#757575' }}>
                    {new Date(w.createdAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span style={styles.cell}>
                    <span style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, backgroundColor: badge.bg, color: badge.color }}>
                      {badge.label}
                    </span>
                  </span>
                  <span style={{ ...styles.cell, flex: 1.4, gap: 8, flexWrap: 'wrap' }}>
                    {w.status === 'PENDING' ? (
                      <>
                        <button onClick={() => complete(w)} disabled={actioningId === w.id} style={styles.payBtn}>
                          Marquer payé
                        </button>
                        <button onClick={() => reject(w)} disabled={actioningId === w.id} style={styles.rejectBtn}>
                          Refuser
                        </button>
                      </>
                    ) : (
                      <span style={{ fontSize: 12, color: '#999' }}>
                        {w.metadata?.rejectReason || w.metadata?.operatorRef || 'Traité'}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: { marginBottom: 24 },
  title: { fontSize: 28, fontWeight: 700 },
  subtitle: { color: '#757575', marginTop: 4 },
  filterRow: { display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' },
  filterBtn: { padding: '8px 16px', borderRadius: 8, backgroundColor: '#fff', border: '1px solid #e0e0e0', fontSize: 14, cursor: 'pointer' },
  filterBtnActive: { backgroundColor: '#1DB954', color: '#fff', borderColor: '#1DB954', fontWeight: 700 },
  refreshBtn: { marginLeft: 'auto', padding: '8px 16px', borderRadius: 8, backgroundColor: '#fff', border: '1px solid #e0e0e0', fontSize: 14, cursor: 'pointer' },
  totalBox: { backgroundColor: '#FFF8E1', color: '#5B4A00', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14 },
  error: { backgroundColor: '#FFEBEE', color: '#D32F2F', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14 },
  empty: { backgroundColor: '#fff', padding: 48, borderRadius: 12, textAlign: 'center', color: '#999' },
  table: { backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  tableHeader: { display: 'flex', padding: '14px 20px', backgroundColor: '#f9f9f9', borderBottom: '1px solid #e0e0e0', fontWeight: 700, fontSize: 12, color: '#757575' },
  tableRow: { display: 'flex', padding: '14px 20px', borderBottom: '1px solid #f5f5f5', alignItems: 'center', fontSize: 14 },
  cell: { flex: 1, display: 'flex', alignItems: 'center' },
  payBtn: { padding: '6px 12px', borderRadius: 6, backgroundColor: '#388E3C', color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  rejectBtn: { padding: '6px 12px', borderRadius: 6, backgroundColor: '#D32F2F', color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
};
