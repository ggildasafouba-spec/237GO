import React, { useEffect, useState, useCallback } from 'react';
import api from '../config/api';
import { formatPhone } from '../utils/phone';

interface DriverProfile {
  id: string;
  vehicleType: string;
  vehiclePlate: string;
  vehicleBrand?: string | null;
  vehicleModel?: string | null;
  vehicleYear?: number | null;
  hasAirConditioning?: boolean;
  verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
  isOnline: boolean;
  totalTrips: number;
  averageRating: number;
  licenseNumber: string;
  cniNumber: string;
  licensePhoto?: string | null;
  cniPhoto?: string | null;
  vehiclePhoto?: string | null;
  registrationPhoto?: string | null;
  insurancePhoto?: string | null;
  inspectionPhoto?: string | null;
  user: { firstName: string; lastName: string; phone: string };
}

// Critères attendus par catégorie (miroir du backend) pour aider l'admin à valider
const CATEGORY_RULES: Record<string, { label: string; minYear: number | null; ac: boolean }> = {
  MOTO: { label: 'Moto', minYear: null, ac: false },
  CAR_ECONOMY: { label: 'Éco', minYear: 2008, ac: false },
  CAR_COMFORT: { label: 'Confort', minYear: 2014, ac: true },
  CAR_VIP: { label: 'VIP', minYear: 2018, ac: true },
  TRUCK: { label: 'Camion', minYear: 2005, ac: false },
};

export default function Drivers() {
  const [drivers, setDrivers] = useState<DriverProfile[]>([]);
  const [filter, setFilter] = useState('ALL');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const loadDrivers = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const params: Record<string, string> = {};
      if (filter === 'VERIFIED') params.status = 'VERIFIED';
      if (filter === 'PENDING') params.status = 'PENDING';
      if (filter === 'ONLINE') params.online = 'true';

      const res = await api.get('/admin/drivers', { params });
      setDrivers(res.data.data || []);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erreur de chargement');
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadDrivers();
  }, [loadDrivers]);

  const verifyDriver = async (id: string, status: 'VERIFIED' | 'REJECTED') => {
    const label = status === 'VERIFIED' ? 'approuver' : 'rejeter';
    if (!window.confirm(`Confirmer : ${label} ce chauffeur ?`)) return;
    try {
      await api.patch(`/admin/drivers/${id}/verify`, { status });
      await loadDrivers();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Erreur');
    }
  };

  // Analyse IA des documents (permis / CNI)
  const [aiResults, setAiResults] = useState<Record<string, any>>({});
  const [aiLoadingId, setAiLoadingId] = useState<string | null>(null);

  const analyzeWithAI = async (id: string) => {
    setAiLoadingId(id);
    try {
      const res = await api.post(`/admin/drivers/${id}/ai-verify`, {}, { timeout: 90000 });
      setAiResults((prev) => ({ ...prev, [id]: res.data.data }));
    } catch (err: any) {
      alert(err.response?.data?.message || "L'analyse IA a échoué");
    } finally {
      setAiLoadingId(null);
    }
  };

  const onlineCount = drivers.filter((d) => d.isOnline).length;

  return (
    <div>
      <div style={styles.header}>
        <h1 style={styles.title}>Chauffeurs</h1>
        <p style={styles.subtitle}>
          {onlineCount} en ligne sur {drivers.length} chauffeur(s)
        </p>
      </div>

      <div style={styles.filters}>
        {['ALL', 'ONLINE', 'VERIFIED', 'PENDING'].map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={{ ...styles.filterBtn, ...(filter === f ? styles.filterActive : {}) }}>
            {f === 'ALL' ? 'Tous' : f === 'ONLINE' ? '🟢 En ligne' : f === 'PENDING' ? '⏳ En attente' : '✅ Vérifiés'}
          </button>
        ))}
      </div>

      {error && <div style={styles.errorBox}>{error}</div>}

      {isLoading ? (
        <div style={styles.empty}>Chargement...</div>
      ) : drivers.length === 0 ? (
        <div style={styles.empty}>Aucun chauffeur dans cette catégorie</div>
      ) : (
        <div style={styles.grid}>
          {drivers.map((driver) => {
            const name = `${driver.user.firstName} ${driver.user.lastName}`;
            return (
              <div key={driver.id} style={styles.card}>
                <div style={styles.cardTop}>
                  <div style={styles.avatar}>{driver.user.firstName[0]}</div>
                  <div>
                    <h3 style={styles.driverName}>{name}</h3>
                    <p style={styles.driverPhone}>{formatPhone(driver.user.phone)}</p>
                  </div>
                  <span style={{ ...styles.onlineDot, backgroundColor: driver.isOnline ? '#388E3C' : '#BDBDBD' }} />
                </div>
                {(() => {
                  const rule = CATEGORY_RULES[driver.vehicleType];
                  const yearOk = !rule?.minYear || (driver.vehicleYear != null && driver.vehicleYear >= rule.minYear);
                  const acOk = !rule?.ac || !!driver.hasAirConditioning;
                  return (
                    <>
                      <div style={styles.cardDetails}>
                        <div style={styles.detail}><span style={styles.detailLabel}>Catégorie</span><span>{rule?.label || driver.vehicleType} • {driver.vehiclePlate}</span></div>
                        <div style={styles.detail}><span style={styles.detailLabel}>Véhicule</span><span>{[driver.vehicleBrand, driver.vehicleModel].filter(Boolean).join(' ') || '—'}</span></div>
                        <div style={styles.detail}>
                          <span style={styles.detailLabel}>Année</span>
                          <span style={{ color: yearOk ? '#388E3C' : '#D32F2F', fontWeight: 600 }}>
                            {driver.vehicleYear || '—'}{rule?.minYear ? ` (min ${rule.minYear})` : ''} {yearOk ? '✓' : '✗'}
                          </span>
                        </div>
                        <div style={styles.detail}>
                          <span style={styles.detailLabel}>Climatisation</span>
                          <span style={{ color: acOk ? '#388E3C' : '#D32F2F', fontWeight: 600 }}>
                            {driver.hasAirConditioning ? 'Oui' : 'Non'}{rule?.ac ? ' (requise)' : ''} {acOk ? '✓' : '✗'}
                          </span>
                        </div>
                        <div style={styles.detail}><span style={styles.detailLabel}>Permis</span><span>{driver.licenseNumber}</span></div>
                        <div style={styles.detail}><span style={styles.detailLabel}>CNI</span><span>{driver.cniNumber}</span></div>
                        <div style={styles.detail}><span style={styles.detailLabel}>Courses</span><span>{driver.totalTrips}</span></div>
                        <div style={styles.detail}><span style={styles.detailLabel}>Note</span><span>⭐ {driver.averageRating > 0 ? driver.averageRating.toFixed(1) : 'N/A'}</span></div>
                      </div>
                      {driver.verificationStatus === 'PENDING' && (!yearOk || !acOk) && (
                        <div style={styles.warnBox}>
                          ⚠️ Le véhicule ne respecte pas tous les critères de la catégorie {rule?.label}.
                        </div>
                      )}
                    </>
                  );
                })()}

                {/* Documents téléversés */}
                {(driver.licensePhoto || driver.cniPhoto || driver.vehiclePhoto || driver.registrationPhoto || driver.insurancePhoto || driver.inspectionPhoto) && (
                  <div style={styles.docsRow}>
                    {([
                      ['Permis', driver.licensePhoto],
                      ['CNI', driver.cniPhoto],
                      ['Véhicule', driver.vehiclePhoto],
                      ['Carte grise', driver.registrationPhoto],
                      ['Assurance', driver.insurancePhoto],
                      ['Visite tech.', driver.inspectionPhoto],
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
                {/* Analyse IA des documents */}
                {(driver.licensePhoto || driver.cniPhoto) && (
                  <div style={{ marginBottom: 12 }}>
                    <button
                      style={styles.aiBtn}
                      onClick={() => analyzeWithAI(driver.id)}
                      disabled={aiLoadingId === driver.id}
                    >
                      {aiLoadingId === driver.id ? '🤖 Analyse en cours…' : '🤖 Analyser les documents avec l\'IA'}
                    </button>
                    {aiResults[driver.id] && (
                      <div style={styles.aiResult}>
                        <div style={{ fontWeight: 700, marginBottom: 6 }}>
                          Recommandation IA :{' '}
                          <span style={{ color: aiResults[driver.id].recommendation === 'APPROVE' ? '#388E3C' : '#F57C00' }}>
                            {aiResults[driver.id].recommendation === 'APPROVE' ? '✅ Approuver' : '🔍 À examiner'}
                          </span>
                          {' '}(confiance {aiResults[driver.id].meanConfidence}%)
                        </div>
                        {aiResults[driver.id].analyses?.license && (
                          <div style={styles.aiLine}>
                            Permis : {aiResults[driver.id].analyses.license.readable === false ? 'illisible' : 'lisible'}
                            {aiResults[driver.id].analyses.license.concerns ? ` — ${aiResults[driver.id].analyses.license.concerns}` : ''}
                          </div>
                        )}
                        {aiResults[driver.id].analyses?.cni && (
                          <div style={styles.aiLine}>
                            CNI : {aiResults[driver.id].analyses.cni.readable === false ? 'illisible' : 'lisible'}
                            {aiResults[driver.id].analyses.cni.concerns ? ` — ${aiResults[driver.id].analyses.cni.concerns}` : ''}
                          </div>
                        )}
                        <div style={styles.aiNote}>Avis IA — la décision finale reste la vôtre.</div>
                      </div>
                    )}
                  </div>
                )}

                <div style={styles.cardActions}>
                  {driver.verificationStatus === 'PENDING' ? (
                    <>
                      <button style={styles.approveBtn} onClick={() => verifyDriver(driver.id, 'VERIFIED')}>✅ Approuver</button>
                      <button style={styles.rejectBtn} onClick={() => verifyDriver(driver.id, 'REJECTED')}>❌ Rejeter</button>
                    </>
                  ) : (
                    <span style={styles.statusTag}>
                      {driver.verificationStatus === 'VERIFIED' ? '✅ Vérifié' : '❌ Rejeté'}
                    </span>
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
  filters: { display: 'flex', gap: 8, marginBottom: 24 },
  filterBtn: { padding: '8px 16px', backgroundColor: '#f5f5f5', borderRadius: 6, fontSize: 13, fontWeight: 600, color: '#757575', cursor: 'pointer' },
  filterActive: { backgroundColor: '#1DB954', color: '#fff' },
  errorBox: { backgroundColor: '#FFEBEE', color: '#D32F2F', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14 },
  empty: { backgroundColor: '#fff', padding: 48, borderRadius: 12, textAlign: 'center', color: '#999' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  cardTop: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, position: 'relative' },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#1DB954', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 18 },
  driverName: { fontSize: 16, fontWeight: 700 },
  driverPhone: { fontSize: 13, color: '#757575' },
  onlineDot: { position: 'absolute', right: 0, top: 0, width: 12, height: 12, borderRadius: 6, border: '2px solid #fff' },
  cardDetails: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 },
  detail: { display: 'flex', justifyContent: 'space-between', fontSize: 13 },
  detailLabel: { color: '#757575' },
  docsRow: { display: 'flex', gap: 8, marginBottom: 12, overflowX: 'auto', paddingBottom: 4 },
  warnBox: { backgroundColor: '#FFF3E0', color: '#E65100', padding: 8, borderRadius: 6, fontSize: 12, marginBottom: 12 },
  aiBtn: { width: '100%', padding: 10, backgroundColor: '#EDE7F6', color: '#5E35B1', borderRadius: 6, fontWeight: 700, fontSize: 13, border: 'none', cursor: 'pointer' },
  aiResult: { marginTop: 10, backgroundColor: '#F3E5F5', borderRadius: 8, padding: 12, fontSize: 13 },
  aiLine: { color: '#424242', marginTop: 2 },
  aiNote: { fontSize: 11, color: '#9E9E9E', marginTop: 6, fontStyle: 'italic' },
  docThumb: { display: 'flex', flexDirection: 'column', alignItems: 'center', textDecoration: 'none', color: '#757575' },
  docImg: { width: 70, height: 50, objectFit: 'cover', borderRadius: 6, border: '1px solid #e0e0e0' },
  docCaption: { fontSize: 10, marginTop: 2 },
  cardActions: { display: 'flex', gap: 8 },
  approveBtn: { flex: 1, padding: 10, backgroundColor: '#E8F5E9', color: '#388E3C', borderRadius: 6, fontWeight: 700, fontSize: 13, border: 'none', cursor: 'pointer' },
  rejectBtn: { flex: 1, padding: 10, backgroundColor: '#FFEBEE', color: '#D32F2F', borderRadius: 6, fontWeight: 700, fontSize: 13, border: 'none', cursor: 'pointer' },
  statusTag: { flex: 1, padding: 10, backgroundColor: '#f5f5f5', color: '#212121', borderRadius: 6, fontWeight: 600, fontSize: 13, textAlign: 'center' },
};
