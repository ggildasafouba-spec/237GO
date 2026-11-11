import React, { useEffect, useState, useCallback, useRef } from 'react';
import api from '../config/api';
import { formatPhone } from '../utils/phone';

interface Merchant {
  id: string;
  shopName: string;
  shopAddress: string;
  category: string;
  description?: string | null;
  isOpen: boolean;
  verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
  rejectionReason?: string | null;
  ownerIdPhoto?: string | null;
  shopPhoto?: string | null;
  businessRegPhoto?: string | null;
  user: { firstName: string; lastName: string; phone: string };
  _count: { products: number; orders: number };
}

interface MenuRow {
  line: number;
  name: string;
  price: number | null;
  category: string;
  description: string;
  errors: string[];
  warnings: string[];
  action?: 'create' | 'update';
}
interface MenuPreview {
  rows: MenuRow[];
  validCount: number;
  errorCount: number;
  createCount: number;
  updateCount: number;
}

export default function Merchants() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  // Import de menu pour le compte d'un restaurant
  const [menuTarget, setMenuTarget] = useState<Merchant | null>(null);
  const [menuPreview, setMenuPreview] = useState<MenuPreview | null>(null);
  const [menuBusy, setMenuBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState('PENDING');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [actioningId, setActioningId] = useState<string | null>(null);

  const loadMerchants = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const res = await api.get('/admin/merchants');
      setMerchants(res.data.data || []);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erreur de chargement');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMerchants();
  }, [loadMerchants]);

  const verifyMerchant = async (id: string, status: 'VERIFIED' | 'REJECTED') => {
    let reason: string | null = null;
    if (status === 'REJECTED') {
      reason = window.prompt('Motif du rejet (optionnel) :') || null;
    } else {
      if (!window.confirm('Confirmer l’approbation de ce marchand ?')) return;
    }
    setActioningId(id);
    try {
      await api.patch(`/admin/merchants/${id}/verify`, { status, reason });
      await loadMerchants();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Erreur');
    } finally {
      setActioningId(null);
    }
  };

  // Étape 1 : choisir le fichier → aperçu (rien n'est enregistré)
  const startMenuImport = (m: Merchant) => {
    setMenuTarget(m);
    setMenuPreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const onMenuFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !menuTarget) return;
    setMenuBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      // En-tête multipart explicite : sinon axios convertit le FormData en JSON
      // (en-tête par défaut application/json) et le fichier n'est jamais envoyé.
      const res = await api.post(`/market/menu-import/parse?merchantId=${encodeURIComponent(menuTarget.id)}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setMenuPreview(res.data.data);
    } catch (err: any) {
      alert(err.response?.data?.message || 'Lecture du fichier impossible');
      setMenuTarget(null);
    } finally {
      setMenuBusy(false);
    }
  };

  // Étape 2 : enregistrer les plats valides
  const confirmMenuImport = async () => {
    if (!menuTarget || !menuPreview) return;
    setMenuBusy(true);
    try {
      const items = menuPreview.rows
        .filter((r) => r.errors.length === 0)
        .map((r) => ({ name: r.name, price: r.price, category: r.category, description: r.description }));
      const res = await api.post(`/admin/merchants/${menuTarget.id}/menu-import`, { items });
      alert(res.data.message);
      setMenuPreview(null);
      setMenuTarget(null);
      await loadMerchants();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Import impossible');
    } finally {
      setMenuBusy(false);
    }
  };

  const filtered = merchants.filter((m) => {
    if (filter === 'ALL') return true;
    return m.verificationStatus === filter;
  });

  const filters = [
    { value: 'PENDING', label: '⏳ En attente' },
    { value: 'VERIFIED', label: '✅ Vérifiés' },
    { value: 'REJECTED', label: '❌ Rejetés' },
    { value: 'ALL', label: 'Tous' },
  ];

  const statusTag = (s: string) => {
    if (s === 'VERIFIED') return { bg: '#E8F5E9', color: '#388E3C', label: '✅ Vérifié' };
    if (s === 'REJECTED') return { bg: '#FFEBEE', color: '#D32F2F', label: '❌ Rejeté' };
    return { bg: '#FFF8E1', color: '#F57C00', label: '⏳ En attente' };
  };

  return (
    <div>
      <div style={styles.header}>
        <h1 style={styles.title}>Marchands</h1>
        <p style={styles.subtitle}>Validation des boutiques sur GO Market</p>
      </div>

      <div style={styles.filters}>
        {filters.map((f) => (
          <button key={f.value} onClick={() => setFilter(f.value)} style={{ ...styles.filterBtn, ...(filter === f.value ? styles.filterActive : {}) }}>
            {f.label}
          </button>
        ))}
        <a href="/api/market/menu-template" style={styles.templateLink}>📥 Modèle Excel du menu</a>
        <button onClick={loadMerchants} style={styles.refreshBtn}>🔄 Actualiser</button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.csv"
        style={{ display: 'none' }}
        onChange={onMenuFileChosen}
        aria-label="Fichier du menu"
      />

      {menuPreview && menuTarget && (
        <div style={styles.overlay} role="dialog" aria-modal="true" aria-label="Aperçu du menu">
          <div style={styles.previewBox}>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Menu de {menuTarget.shopName}</h2>
            <p style={{ color: '#555', marginBottom: 12, fontSize: 14 }}>
              {menuPreview.validCount} plat(s) prêt(s) : {menuPreview.createCount} nouveau(x), {menuPreview.updateCount} mis à jour
              {menuPreview.errorCount > 0 && <strong style={{ color: '#D32F2F' }}> · {menuPreview.errorCount} ligne(s) en erreur ignorée(s)</strong>}
            </p>
            <div style={{ maxHeight: 420, overflowY: 'auto', border: '1px solid #eee', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f5f5f5', textAlign: 'left' }}>
                    <th style={styles.th}>Ligne</th><th style={styles.th}>Plat</th><th style={styles.th}>Prix</th>
                    <th style={styles.th}>Catégorie</th><th style={styles.th}>État</th>
                  </tr>
                </thead>
                <tbody>
                  {menuPreview.rows.map((r) => (
                    <tr key={r.line} style={{ background: r.errors.length ? '#FFEBEE' : undefined }}>
                      <td style={styles.td}>{r.line}</td>
                      <td style={styles.td}>
                        <b>{r.name || '(sans nom)'}</b>
                        {r.description && <div style={{ color: '#777' }}>{r.description}</div>}
                      </td>
                      <td style={styles.td}>{r.price !== null ? `${r.price.toLocaleString('fr-FR')} F` : '—'}</td>
                      <td style={styles.td}>{r.category}</td>
                      <td style={styles.td}>
                        {r.errors.length ? (
                          <span style={{ color: '#D32F2F' }}>❌ {r.errors.join(' · ')}</span>
                        ) : (
                          <span>{r.action === 'update' ? '🔄 Mise à jour' : '➕ Nouveau'}</span>
                        )}
                        {r.warnings.map((w) => <div key={w} style={{ color: '#E65100' }}>{w}</div>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button style={styles.refreshBtn} disabled={menuBusy} onClick={() => { setMenuPreview(null); setMenuTarget(null); }}>Annuler</button>
              <button
                style={{ ...styles.approveBtn, flex: 'none', padding: '10px 20px', opacity: menuPreview.validCount === 0 ? 0.5 : 1 }}
                disabled={menuBusy || menuPreview.validCount === 0}
                onClick={confirmMenuImport}
              >
                {menuBusy ? 'Import…' : `✅ Valider l'import (${menuPreview.validCount})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <div style={styles.errorBox}>{error}</div>}

      {isLoading ? (
        <div style={styles.empty}>Chargement...</div>
      ) : filtered.length === 0 ? (
        <div style={styles.empty}>Aucun marchand dans cette catégorie</div>
      ) : (
        <div style={styles.grid}>
          {filtered.map((m) => {
            const st = statusTag(m.verificationStatus);
            return (
              <div key={m.id} style={styles.card}>
                <div style={styles.cardHeader}>
                  <h3 style={styles.shopName}>{m.shopName}</h3>
                  <span style={{ ...styles.status, backgroundColor: st.bg, color: st.color }}>{st.label}</span>
                </div>
                <p style={styles.owner}>{m.user.firstName} {m.user.lastName} • {formatPhone(m.user.phone)}</p>
                <p style={styles.category}>{m.category} · {m.shopAddress}</p>

                {m.rejectionReason && <div style={styles.warnBox}>Motif de rejet : {m.rejectionReason}</div>}

                {/* Documents */}
                {(m.ownerIdPhoto || m.shopPhoto || m.businessRegPhoto) && (
                  <div style={styles.docsRow}>
                    {([
                      ['Pièce ID', m.ownerIdPhoto],
                      ['Boutique', m.shopPhoto],
                      ['Registre comm.', m.businessRegPhoto],
                    ] as [string, string | null | undefined][])
                      .filter(([, url]) => !!url)
                      .map(([caption, url]) => (
                        <a key={caption} href={url as string} target="_blank" rel="noreferrer" style={styles.docThumb}>
                          <img src={url as string} alt={caption} style={styles.docImg} />
                          <span style={styles.docCaption}>{caption}</span>
                        </a>
                      ))}
                  </div>
                )}

                <div style={styles.stats}>
                  <div style={styles.stat}><span style={styles.statValue}>{m._count.products}</span><span style={styles.statLabel}>Produits</span></div>
                  <div style={styles.stat}><span style={styles.statValue}>{m._count.orders}</span><span style={styles.statLabel}>Commandes</span></div>
                </div>

                <button
                  style={styles.menuBtn}
                  disabled={menuBusy}
                  onClick={() => startMenuImport(m)}
                  title="Importer le menu depuis un fichier Excel (.xlsx) ou CSV"
                >
                  {menuBusy && menuTarget?.id === m.id && !menuPreview ? 'Lecture…' : '📋 Importer le menu (Excel)'}
                </button>

                <div style={styles.cardActions}>
                  {m.verificationStatus === 'PENDING' ? (
                    <>
                      <button style={styles.approveBtn} disabled={actioningId === m.id} onClick={() => verifyMerchant(m.id, 'VERIFIED')}>✅ Approuver</button>
                      <button style={styles.rejectBtn} disabled={actioningId === m.id} onClick={() => verifyMerchant(m.id, 'REJECTED')}>❌ Rejeter</button>
                    </>
                  ) : (
                    <span style={styles.statusTagFull}>{st.label}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: { marginBottom: 24 },
  title: { fontSize: 28, fontWeight: 700 },
  subtitle: { color: '#757575', marginTop: 4 },
  filters: { display: 'flex', gap: 8, marginBottom: 24, alignItems: 'center' },
  filterBtn: { padding: '8px 16px', backgroundColor: '#f5f5f5', borderRadius: 6, fontSize: 13, fontWeight: 600, color: '#757575', cursor: 'pointer', border: 'none' },
  filterActive: { backgroundColor: '#1DB954', color: '#fff' },
  refreshBtn: { padding: '8px 16px', borderRadius: 6, backgroundColor: '#fff', border: '1px solid #e0e0e0', fontSize: 13, cursor: 'pointer' },
  errorBox: { backgroundColor: '#FFEBEE', color: '#D32F2F', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14 },
  empty: { backgroundColor: '#fff', padding: 48, borderRadius: 12, textAlign: 'center', color: '#999' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 20 },
  card: { backgroundColor: '#fff', padding: 24, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  shopName: { fontSize: 16, fontWeight: 700, maxWidth: '60%' },
  status: { padding: '4px 10px', borderRadius: 10, fontSize: 11, fontWeight: 600 },
  owner: { fontSize: 13, color: '#757575', marginBottom: 4 },
  category: { fontSize: 12, color: '#1DB954', fontWeight: 600, marginBottom: 12 },
  warnBox: { backgroundColor: '#FFF3E0', color: '#E65100', padding: 8, borderRadius: 6, fontSize: 12, marginBottom: 12 },
  docsRow: { display: 'flex', gap: 8, marginBottom: 12, overflowX: 'auto', paddingBottom: 4 },
  docThumb: { display: 'flex', flexDirection: 'column', alignItems: 'center', textDecoration: 'none', color: '#757575' },
  docImg: { width: 70, height: 50, objectFit: 'cover', borderRadius: 6, border: '1px solid #e0e0e0' },
  docCaption: { fontSize: 10, marginTop: 2 },
  stats: { display: 'flex', gap: 24, marginBottom: 16 },
  stat: { display: 'flex', flexDirection: 'column', alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: 800, color: '#212121' },
  statLabel: { fontSize: 12, color: '#757575' },
  cardActions: { display: 'flex', gap: 8 },
  menuBtn: { width: '100%', padding: 10, marginBottom: 8, backgroundColor: '#fff', color: '#1DB954', border: '1px solid #1DB954', borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  templateLink: { marginLeft: 'auto', padding: '8px 16px', borderRadius: 6, backgroundColor: '#E8F5E9', color: '#388E3C', fontSize: 13, fontWeight: 600, textDecoration: 'none' },
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 },
  previewBox: { backgroundColor: '#fff', borderRadius: 12, padding: 24, width: 'min(900px, 100%)', maxHeight: '90vh', overflow: 'auto' },
  th: { padding: '8px 10px', borderBottom: '1px solid #e0e0e0' },
  td: { padding: '8px 10px', borderBottom: '1px solid #f0f0f0', verticalAlign: 'top' },
  approveBtn: { flex: 1, padding: 10, backgroundColor: '#E8F5E9', color: '#388E3C', borderRadius: 6, fontWeight: 700, fontSize: 13, border: 'none', cursor: 'pointer' },
  rejectBtn: { flex: 1, padding: 10, backgroundColor: '#FFEBEE', color: '#D32F2F', borderRadius: 6, fontWeight: 700, fontSize: 13, border: 'none', cursor: 'pointer' },
  statusTagFull: { flex: 1, padding: 10, backgroundColor: '#f5f5f5', color: '#212121', borderRadius: 6, fontWeight: 600, fontSize: 13, textAlign: 'center' },
};
