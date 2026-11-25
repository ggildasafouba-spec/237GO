import React, { useState, useEffect } from 'react';
import api from '../config/api';

type VehicleKey = 'MOTO' | 'CAR_ECONOMY' | 'CAR_COMFORT' | 'CAR_VIP';
type TariffField = 'minFare' | 'includedKm' | 'includedMin' | 'perKm' | 'perMin';
type Tariff = Record<TariffField, number>;

interface Pricing {
  tariffs: Record<VehicleKey, Tariff>;
  commissionPercent: number;
  loyaltyPointsPerXAF: number;
  bonusRechargeThreshold: number;
  bonusRechargePercent: number;
}

// Mêmes valeurs par défaut que le serveur (apps/backend/src/lib/pricingSettings.ts).
// Moto et Éco : tarifs maximums de Yango à Douala, avec un prix minimum inférieur de 30 F.
const DEFAULT_PRICING: Pricing = {
  tariffs: {
    MOTO: { minFare: 230, includedKm: 1.5, includedMin: 4, perKm: 59, perMin: 11 },
    CAR_ECONOMY: { minFare: 400, includedKm: 1.8, includedMin: 5, perKm: 90, perMin: 25 },
    CAR_COMFORT: { minFare: 1000, includedKm: 0, includedMin: 0, perKm: 450, perMin: 35 },
    CAR_VIP: { minFare: 2000, includedKm: 0, includedMin: 0, perKm: 700, perMin: 50 },
  },
  commissionPercent: 10,
  loyaltyPointsPerXAF: 100,
  bonusRechargeThreshold: 5000,
  bonusRechargePercent: 5,
};

const VEHICLES: { key: VehicleKey; label: string }[] = [
  { key: 'MOTO', label: '🏍️ Moto' },
  { key: 'CAR_ECONOMY', label: '🚗 Économique' },
  { key: 'CAR_COMFORT', label: '🚙 Confort' },
  { key: 'CAR_VIP', label: '✨ VIP' },
];

const FIELDS: { key: TariffField; label: string }[] = [
  { key: 'minFare', label: 'Prix minimum (XAF)' },
  { key: 'includedKm', label: 'Km inclus dans le minimum' },
  { key: 'includedMin', label: 'Minutes incluses' },
  { key: 'perKm', label: 'Par km en plus (XAF)' },
  { key: 'perMin', label: 'Par minute en plus (XAF)' },
];

const DEFAULT_SMS = {
  provider: 'africas_talking',
  senderId: '237GO',
  enabled: true,
};

// Même calcul que le serveur : prix minimum + km et minutes au-delà de ceux inclus, arrondi aux 10 F.
function exampleFare(t: Tariff, km: number): number {
  const min = Math.ceil(km * 3);
  const raw = t.minFare + t.perKm * Math.max(0, km - t.includedKm) + t.perMin * Math.max(0, min - t.includedMin);
  return Math.ceil(Math.round(raw * 100) / 100 / 10) * 10;
}

// Fusionne ce que renvoie le serveur avec les valeurs par défaut (champ manquant = défaut)
function mergePricing(data: Partial<Pricing> | undefined): Pricing {
  const merged: Pricing = {
    ...DEFAULT_PRICING,
    ...(data || {}),
    tariffs: { ...DEFAULT_PRICING.tariffs },
  };
  for (const v of VEHICLES) {
    merged.tariffs[v.key] = { ...DEFAULT_PRICING.tariffs[v.key], ...(data?.tariffs?.[v.key] || {}) };
  }
  return merged;
}

export default function Settings() {
  const [pricing, setPricing] = useState<Pricing>(DEFAULT_PRICING);
  const [smsConfig, setSmsConfig] = useState(DEFAULT_SMS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Charger les paramètres enregistrés au montage
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/admin/settings');
        const data = res.data?.data;
        if (data?.pricing) setPricing(mergePricing(data.pricing));
        if (data?.sms) setSmsConfig({ ...DEFAULT_SMS, ...data.sms });
      } catch {
        // En cas d'erreur, on garde les valeurs par défaut
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const setTariff = (vehicle: VehicleKey, field: TariffField, value: number) => {
    setPricing((p) => ({
      ...p,
      tariffs: { ...p.tariffs, [vehicle]: { ...p.tariffs[vehicle], [field]: Number.isFinite(value) ? value : 0 } },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put('/admin/settings', { pricing, sms: smsConfig });
      alert('Paramètres enregistrés ! Les nouveaux prix s\'appliquent tout de suite aux nouvelles courses.');
    } catch (err: any) {
      // Le serveur explique ce qui ne va pas (ex. « Moto : Tarif au km doit être entre 0 et 10000 »)
      alert(err?.response?.data?.message || "Échec de l'enregistrement. Réessayez.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 24 }}>Chargement des paramètres…</div>;
  }

  return (
    <div>
      <div style={styles.header}>
        <h1 style={styles.title}>Paramètres</h1>
        <button onClick={handleSave} disabled={saving} style={{ ...styles.saveBtn, opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Enregistrement…' : '💾 Sauvegarder'}
        </button>
      </div>

      {/* Tarification */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>💰 Tarification des courses</h2>
        <p style={styles.help}>
          Prix = prix minimum + (km au-delà des km inclus × tarif au km) + (minutes au-delà des minutes incluses × tarif à la minute),
          arrondi aux 10 F supérieurs. La durée est estimée à 3 minutes par km. Les prix proposés aux passagers changent dès
          l'enregistrement.
        </p>
        <div style={styles.grid}>
          {VEHICLES.map((v) => (
            <div key={v.key} style={styles.card}>
              <h3 style={styles.cardTitle}>{v.label}</h3>
              {FIELDS.map((f) => (
                <div key={f.key} style={styles.fieldRow}>
                  <label style={styles.label}>{f.label}</label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={pricing.tariffs[v.key][f.key]}
                    onChange={(e) => setTariff(v.key, f.key, parseFloat(e.target.value))}
                    style={styles.input}
                  />
                </div>
              ))}
              <p style={styles.example}>
                Exemples : 2 km = <strong>{exampleFare(pricing.tariffs[v.key], 2).toLocaleString('fr-FR')} F</strong> ·
                5 km = <strong>{exampleFare(pricing.tariffs[v.key], 5).toLocaleString('fr-FR')} F</strong> ·
                10 km = <strong>{exampleFare(pricing.tariffs[v.key], 10).toLocaleString('fr-FR')} F</strong>
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Commission */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>⚙️ Commission</h2>
        <div style={styles.grid}>
          <div style={styles.card}>
            <div style={styles.fieldRow}>
              <label style={styles.label}>Commission 237GO (%)</label>
              <input
                type="number"
                min={0}
                max={50}
                step="any"
                value={pricing.commissionPercent}
                onChange={(e) => setPricing({ ...pricing, commissionPercent: parseFloat(e.target.value) || 0 })}
                style={styles.input}
              />
            </div>
            <p style={styles.example}>
              Prélevée sur les courses, livraisons, commandes du marché, covoiturages et locations. Elle s'applique aux
              nouveaux paiements : les paiements déjà en cours gardent le taux de leur commande.
            </p>
          </div>
        </div>
      </div>

      {/* Fidélité & recharge : enregistrés mais pas encore appliqués par le serveur */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>🎁 Fidélité & bonus (pas encore appliqué)</h2>
        <p style={styles.help}>Ces valeurs sont enregistrées mais le serveur ne les utilise pas encore pour calculer les points ou les bonus.</p>
        <div style={styles.grid}>
          <div style={styles.card}>
            <div style={styles.fieldRow}>
              <label style={styles.label}>Points fidélité / XAF dépensé</label>
              <input type="number" value={pricing.loyaltyPointsPerXAF} onChange={(e) => setPricing({ ...pricing, loyaltyPointsPerXAF: +e.target.value })} style={styles.input} />
            </div>
          </div>
          <div style={styles.card}>
            <div style={styles.fieldRow}>
              <label style={styles.label}>Seuil bonus recharge (XAF)</label>
              <input type="number" value={pricing.bonusRechargeThreshold} onChange={(e) => setPricing({ ...pricing, bonusRechargeThreshold: +e.target.value })} style={styles.input} />
            </div>
            <div style={styles.fieldRow}>
              <label style={styles.label}>Bonus recharge (%)</label>
              <input type="number" value={pricing.bonusRechargePercent} onChange={(e) => setPricing({ ...pricing, bonusRechargePercent: +e.target.value })} style={styles.input} />
            </div>
          </div>
        </div>
      </div>

      {/* SMS */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>📱 Configuration SMS</h2>
        <div style={styles.card}>
          <div style={styles.fieldRow}>
            <label style={styles.label}>Fournisseur</label>
            <select value={smsConfig.provider} onChange={(e) => setSmsConfig({ ...smsConfig, provider: e.target.value })} style={styles.input}>
              <option value="africas_talking">Africa's Talking</option>
              <option value="infobip">Infobip</option>
              <option value="twilio">Twilio</option>
            </select>
          </div>
          <div style={styles.fieldRow}>
            <label style={styles.label}>Sender ID</label>
            <input type="text" value={smsConfig.senderId} onChange={(e) => setSmsConfig({ ...smsConfig, senderId: e.target.value })} style={styles.input} />
          </div>
          <div style={styles.fieldRow}>
            <label style={styles.label}>SMS activés</label>
            <input type="checkbox" checked={smsConfig.enabled} onChange={(e) => setSmsConfig({ ...smsConfig, enabled: e.target.checked })} />
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 },
  title: { fontSize: 28, fontWeight: 700 },
  saveBtn: { padding: '12px 24px', backgroundColor: '#1DB954', color: '#fff', borderRadius: 8, fontWeight: 700, fontSize: 14 },
  section: { marginBottom: 40 },
  sectionTitle: { fontSize: 20, fontWeight: 700, marginBottom: 16 },
  help: { fontSize: 13, color: '#757575', marginBottom: 16, lineHeight: 1.5, maxWidth: 760 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 },
  card: { backgroundColor: '#fff', padding: 20, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  cardTitle: { fontSize: 16, fontWeight: 700, marginBottom: 16 },
  fieldRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  label: { fontSize: 13, color: '#757575' },
  input: { padding: '8px 12px', border: '1px solid #e0e0e0', borderRadius: 6, fontSize: 14, width: 120, textAlign: 'right' },
  example: { fontSize: 12, color: '#757575', marginTop: 8, lineHeight: 1.6 },
};
