import React, { useEffect, useState, useCallback } from 'react';
import api from '../config/api';

interface Party {
  firstName: string;
  lastName: string;
  phone: string;
}

interface Escrow {
  id: string;
  serviceType: 'RIDE' | 'DELIVERY' | 'CARPOOL' | 'RENTAL' | 'MARKET';
  serviceId: string;
  amount: number;
  commission: number;
  status: 'HELD' | 'RELEASED' | 'REFUNDED' | 'DISPUTED';
  clientConfirmed: boolean;
  providerConfirmed: boolean;
  disputeReason?: string | null;
  payer: Party;
  payee: Party;
  createdAt: string;
}

const SERVICE_LABELS: Record<string, string> = {
  RIDE: '🚗 Course',
  DELIVERY: '📦 Livraison',
  CARPOOL: '🚐 Covoiturage',
  RENTAL: '🔑 Location',
  MARKET: '🛒 Commande',
};

export default function Disputes() {
  const [escrows, setEscrows] = useState<Escrow[]>([]);
  const [filter, setFilter] = useState<string>('DISPUTED');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [actioningId, setActioningId] = useState<string | null>(null);

  const loadEscrows = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const url = filter === 'DISPUTED' ? '/admin/escrows/disputes' : `/admin/escrows?status=${filter}`;
      const res = await api.get(url);
      // L'endpoint disputes renvoie un tableau, l'autre renvoie { escrows, total }
      const data = Array.isArray(res.data.data) ? res.data.data : res.data.data.escrows;
      setEscrows(data || []);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erreur de chargement');
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadEscrows();
  }, [loadEscrows]);

  const handleAction = async (id: string, action: 'release' | 'refund') => {
    const label = action === 'release' ? 'libérer les fonds au prestataire' : 'rembourser le client';
    if (!window.confirm(`Confirmer : ${label} ?`)) return;

    setActioningId(id);
    try {
      await api.post(`/admin/escrows/${id}/${action}`);
      await loadEscrows();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Erreur');
    } finally {
      setActioningId(null);
    }
  };

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'HELD': return { bg: '#FFF8E1', color: '#F57C00', label: '🔒 Bloqué' };
      case 'RELEASED': return { bg: '#E8F5E9', color: '#388E3C', label: '✅ Versé' };
      case 'REFUNDED': return { bg: '#E3F2FD', color: '#1976D2', label: '↩️ Remboursé' };
      case 'DISPUTED': return { bg: '#FFEBEE', color: '#D32F2F', label: '⚠️ Litige' };
      default: return { bg: '#f5f5f5', color: '#757575', label: status };
    }
  };

  const filters = [
    { value: 'DISPUTED', label: 'Litiges' },
    { value: 'HELD', label: 'En séquestre' },
    { value: 'RELEASED', label: 'Versés' },
    { value: 'REFUNDED', label: 'Remboursés' },
  ];

  return (
    <div>
      <div style={styles.header}>
        <h1 style={styles.title}>Litiges & Séquestres</h1>
        <p style={styles.subtitle}>Gestion des paiements en escrow et résolution des litiges</p>
      </div>

      <div style={styles.filterRow}>
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            style={{
              ...styles.filterBtn,
              ...(filter === f.value ? styles.filterBtnActive : {}),
            }}
          >
            {f.label}
          </button>
        ))}
        <button onClick={loadEscrows} style={styles.refreshBtn}>🔄 Actualiser</button>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {isLoading ? (
        <div style={styles.empty}>Chargement...</div>
      ) : escrows.length === 0 ? (
        <div style={styles.empty}>Aucun élément dans cette catégorie</div>
      ) : (
        <div style={styles.table}>
          <div style={styles.tableHeader}>
            <span style={styles.cell}>Service</span>
            <span style={styles.cell}>Client</span>
            <span style={styles.cell}>Prestataire</span>
            <span style={styles.cell}>Montant</span>
            <span style={{ ...styles.cell, flex: 1.3 }}>Validations</span>
            <span style={styles.cell}>Statut</span>
            <span style={{ ...styles.cell, flex: 1.5 }}>Actions</span>
          </div>
          {escrows.map((e) => {
            const status = getStatusStyle(e.status);
            const canAct = e.status === 'HELD' || e.status === 'DISPUTED';
            return (
              <div key={e.id} style={styles.tableRow}>
                <span style={{ ...styles.cell, fontSize: 13 }}>{SERVICE_LABELS[e.serviceType] || e.serviceType}</span>
                <span style={styles.cell}>{e.payer.firstName} {e.payer.lastName}</span>
                <span style={styles.cell}>{e.payee.firstName} {e.payee.lastName}</span>
                <span style={{ ...styles.cell, fontWeight: 700, color: '#1DB954' }}>
                  {e.amount.toLocaleString()} F
                </span>
                <span style={{ ...styles.cell, flex: 1.3, fontSize: 12 }}>
                  <span style={{ color: e.clientConfirmed ? '#388E3C' : '#bbb' }}>
                    {e.clientConfirmed ? '✓' : '○'} Client
                  </span>
                  &nbsp;&nbsp;
                  <span style={{ color: e.providerConfirmed ? '#388E3C' : '#bbb' }}>
                    {e.providerConfirmed ? '✓' : '○'} Presta.
                  </span>
                </span>
                <span style={styles.cell}>
                  <span style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, backgroundColor: status.bg, color: status.color }}>
                    {status.label}
                  </span>
                </span>
                <span style={{ ...styles.cell, flex: 1.5, gap: 8 }}>
                  {canAct ? (
                    <>
                      <button
                        onClick={() => handleAction(e.id, 'release')}
                        disabled={actioningId === e.id}
                        style={styles.releaseBtn}
                        title="Verser au prestataire"
                      >
                        Libérer
                      </button>
                      <button
                        onClick={() => handleAction(e.id, 'refund')}
                        disabled={actioningId === e.id}
                        style={styles.refundBtn}
                        title="Rembourser le client"
                      >
                        Rembourser
                      </button>
                    </>
                  ) : (
                    <span style={{ fontSize: 12, color: '#999' }}>Traité</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Détail du motif de litige */}
      {filter === 'DISPUTED' && escrows.some((e) => e.disputeReason) && (
        <div style={styles.disputeDetails}>
          <h3 style={{ marginBottom: 12 }}>Motifs des litiges</h3>
          {escrows.filter((e) => e.disputeReason).map((e) => (
            <div key={e.id} style={styles.disputeItem}>
              <strong>{SERVICE_LABELS[e.serviceType]} — {e.payer.firstName} {e.payer.lastName} :</strong> {e.disputeReason}
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
  filterRow: { display: 'flex', gap: 8, marginBottom: 24, alignItems: 'center' },
  filterBtn: { padding: '8px 16px', borderRadius: 8, backgroundColor: '#fff', border: '1px solid #e0e0e0', fontSize: 14, cursor: 'pointer' },
  filterBtnActive: { backgroundColor: '#1DB954', color: '#fff', borderColor: '#1DB954', fontWeight: 700 },
  refreshBtn: { marginLeft: 'auto', padding: '8px 16px', borderRadius: 8, backgroundColor: '#fff', border: '1px solid #e0e0e0', fontSize: 14, cursor: 'pointer' },
  error: { backgroundColor: '#FFEBEE', color: '#D32F2F', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14 },
  empty: { backgroundColor: '#fff', padding: 48, borderRadius: 12, textAlign: 'center', color: '#999' },
  table: { backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  tableHeader: { display: 'flex', padding: '14px 20px', backgroundColor: '#f9f9f9', borderBottom: '1px solid #e0e0e0', fontWeight: 700, fontSize: 12, color: '#757575' },
  tableRow: { display: 'flex', padding: '14px 20px', borderBottom: '1px solid #f5f5f5', alignItems: 'center', fontSize: 14 },
  cell: { flex: 1, display: 'flex', alignItems: 'center' },
  releaseBtn: { padding: '6px 12px', borderRadius: 6, backgroundColor: '#388E3C', color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  refundBtn: { padding: '6px 12px', borderRadius: 6, backgroundColor: '#D32F2F', color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  disputeDetails: { backgroundColor: '#fff', borderRadius: 12, padding: 20, marginTop: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  disputeItem: { padding: '10px 0', borderBottom: '1px solid #f5f5f5', fontSize: 14 },
};
