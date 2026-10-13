import React, { useEffect, useState, useCallback } from 'react';
import api from '../config/api';

interface Vehicle {
  id: string;
  type: string;
  brand: string;
  model: string;
  year: number;
  plate: string;
  color?: string | null;
  pricePerDay: number;
  pricePerHour?: number | null;
  withDriver: boolean;
  locationAddress: string;
  verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
  isAvailable: boolean;
  rejectionReason?: string | null;
  vehiclePhoto?: string | null;
  registrationPhoto?: string | null;
  insurancePhoto?: string | null;
  ownerIdPhoto?: string | null;
  owner: { firstName: string; lastName: string; phone: string };
}

const TYPE_LABELS: Record<string, string> = {
  MOTO: '🏍️ Moto',
  CAR_ECONOMY: '🚗 Éco',
  CAR_COMFORT: '🚙 Confort',
  CAR_VIP: '✨ VIP',
  TRUCK: '🚚 Camion',
};

export default function Vehicles() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [filter, setFilter] = useState('PENDING');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [actioningId, setActioningId] = useState<string | null>(null);

  const loadVehicles = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      // Les en attente ont un endpoint dédié ; sinon on filtre côté liste
      const url = filter === 'PENDING' ? '/admin/vehicles/pending' : `/admin/vehicles?status=${filter}`;
      const res = await api.get(url);
      const data = Array.isArray(res.data.data) ? res.data.data : res.data.data?.vehicles || [];
      setVehicles(data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erreur de chargement');
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadVehicles();
  }, [loadVehicles]);

  const verifyVehicle = async (id: string, status: 'VERIFIED' | 'REJECTED') => {
    let reason: string | null = null;
    if (status === 'REJECTED') {
      reason = window.prompt('Motif du rejet (optionnel) :') || null;
    } else {
      if (!window.confirm('Confirmer l’approbation de ce véhicule ?')) return;
    }
    setActioningId(id);
    try {
      await api.patch(`/admin/vehicles/${id}/verify`, { status, reason });
      await loadVehicles();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Erreur');
    } finally {
      setActioningId(null);
    }
  };

  const filters = [
    { value: 'PENDING', label: '⏳ En attente' },
    { value: 'VERIFIED', label: '✅ Vérifiés' },
    { value: 'REJECTED', label: '❌ Rejetés' },
  ];

  return (
    <div>
      <div style={styles.header}>
        <h1 style={styles.title}>Locations (GO Rent)</h1>
        <p style={styles.subtitle}>Validation des véhicules mis en location par les propriétaires</p>
      </div>

      <div style={styles.filters}>
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            style={{ ...styles.filterBtn, ...(filter === f.value ? styles.filterActive : {}) }}
          >
            {f.label}
          </button>
        ))}
        <button onClick={loadVehicles} style={styles.refreshBtn}>🔄 Actualiser</button>
      </div>

      {error && <div style={styles.errorBox}>{error}</div>}

      {isLoading ? (
        <div style={styles.empty}>Chargement...</div>
      ) : vehicles.length === 0 ? (
        <div style={styles.empty}>Aucun véhicule dans cette catégorie</div>
      ) : (
        <div style={styles.grid}>
          {vehicles.map((v) => (
            <div key={v.id} style={styles.card}>
              <div style={styles.cardTop}>
                <h3 style={styles.vehicleName}>{TYPE_LABELS[v.type] || v.type} · {v.brand} {v.model}</h3>
                <span style={styles.year}>{v.year}</span>
              </div>

              <div style={styles.cardDetails}>
                <div style={styles.detail}><span style={styles.detailLabel}>Propriétaire</span><span>{v.owner.firstName} {v.owner.lastName}</span></div>
                <div style={styles.detail}><span style={styles.detailLabel}>Téléphone</span><span>+237 {v.owner.phone}</span></div>
                <div style={styles.detail}><span style={styles.detailLabel}>Plaque</span><span>{v.plate}</span></div>
                <div style={styles.detail}><span style={styles.detailLabel}>Prix / jour</span><span>{v.pricePerDay.toLocaleString()} XAF</span></div>
                <div style={styles.detail}><span style={styles.detailLabel}>Avec chauffeur</span><span>{v.withDriver ? 'Oui' : 'Non'}</span></div>
                <div style={styles.detail}><span style={styles.detailLabel}>Lieu</span><span>{v.locationAddress}</span></div>
              </div>

              {v.rejectionReason && (
                <div style={styles.warnBox}>Motif de rejet : {v.rejectionReason}</div>
              )}

              {/* Documents */}
              {(v.vehiclePhoto || v.registrationPhoto || v.insurancePhoto || v.ownerIdPhoto) && (
                <div style={styles.docsRow}>
                  {([
                    ['Véhicule', v.vehiclePhoto],
                    ['Carte grise', v.registrationPhoto],
                    ['Assurance', v.insurancePhoto],
                    ['Pièce ID', v.ownerIdPhoto],
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

              <div style={styles.cardActions}>
                {v.verificationStatus === 'PENDING' ? (
                  <>
                    <button style={styles.approveBtn} disabled={actioningId === v.id} onClick={() => verifyVehicle(v.id, 'VERIFIED')}>✅ Approuver</button>
                    <button style={styles.rejectBtn} disabled={actioningId === v.id} onClick={() => verifyVehicle(v.id, 'REJECTED')}>❌ Rejeter</button>
                  </>
                ) : (
                  <span style={styles.statusTag}>
                    {v.verificationStatus === 'VERIFIED' ? '✅ Vérifié' : '❌ Rejeté'}
                  </span>
                )}
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
  filters: { display: 'flex', gap: 8, marginBottom: 24, alignItems: 'center' },
  filterBtn: { padding: '8px 16px', backgroundColor: '#f5f5f5', borderRadius: 6, fontSize: 13, fontWeight: 600, color: '#757575', cursor: 'pointer', border: 'none' },
  filterActive: { backgroundColor: '#1DB954', color: '#fff' },
  refreshBtn: { marginLeft: 'auto', padding: '8px 16px', borderRadius: 6, backgroundColor: '#fff', border: '1px solid #e0e0e0', fontSize: 13, cursor: 'pointer' },
  errorBox: { backgroundColor: '#FFEBEE', color: '#D32F2F', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14 },
  empty: { backgroundColor: '#fff', padding: 48, borderRadius: 12, textAlign: 'center', color: '#999' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 20 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  cardTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  vehicleName: { fontSize: 16, fontWeight: 700 },
  year: { fontSize: 13, color: '#757575', fontWeight: 600 },
  cardDetails: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 },
  detail: { display: 'flex', justifyContent: 'space-between', fontSize: 13 },
  detailLabel: { color: '#757575' },
  warnBox: { backgroundColor: '#FFF3E0', color: '#E65100', padding: 8, borderRadius: 6, fontSize: 12, marginBottom: 12 },
  docsRow: { display: 'flex', gap: 8, marginBottom: 12, overflowX: 'auto', paddingBottom: 4 },
  docThumb: { display: 'flex', flexDirection: 'column', alignItems: 'center', textDecoration: 'none', color: '#757575' },
  docImg: { width: 70, height: 50, objectFit: 'cover', borderRadius: 6, border: '1px solid #e0e0e0' },
  docCaption: { fontSize: 10, marginTop: 2 },
  cardActions: { display: 'flex', gap: 8 },
  approveBtn: { flex: 1, padding: 10, backgroundColor: '#E8F5E9', color: '#388E3C', borderRadius: 6, fontWeight: 700, fontSize: 13, border: 'none', cursor: 'pointer' },
  rejectBtn: { flex: 1, padding: 10, backgroundColor: '#FFEBEE', color: '#D32F2F', borderRadius: 6, fontWeight: 700, fontSize: 13, border: 'none', cursor: 'pointer' },
  statusTag: { flex: 1, padding: 10, backgroundColor: '#f5f5f5', color: '#212121', borderRadius: 6, fontWeight: 600, fontSize: 13, textAlign: 'center' },
};
