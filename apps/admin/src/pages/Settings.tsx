import React, { useState } from 'react';

export default function Settings() {
  const [pricing, setPricing] = useState({
    motoBase: 200, motoPerKm: 150,
    ecoBase: 500, ecoPerKm: 300,
    comfortBase: 1000, comfortPerKm: 450,
    vipBase: 2000, vipPerKm: 700,
    commissionRate: 15,
    loyaltyPointsPerXAF: 100,
    bonusRechargeThreshold: 5000,
    bonusRechargePercent: 5,
  });

  const [smsConfig, setSmsConfig] = useState({
    provider: 'africas_talking',
    senderId: '237GO',
    enabled: true,
  });

  const handleSave = () => {
    alert('Paramètres sauvegardés !');
  };

  return (
    <div>
      <div style={styles.header}>
        <h1 style={styles.title}>Paramètres</h1>
        <button onClick={handleSave} style={styles.saveBtn}>💾 Sauvegarder</button>
      </div>

      {/* Tarification */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>💰 Tarification des courses</h2>
        <div style={styles.grid}>
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>🏍️ Moto</h3>
            <div style={styles.fieldRow}>
              <label style={styles.label}>Base (XAF)</label>
              <input type="number" value={pricing.motoBase} onChange={(e) => setPricing({ ...pricing, motoBase: +e.target.value })} style={styles.input} />
            </div>
            <div style={styles.fieldRow}>
              <label style={styles.label}>Par km (XAF)</label>
              <input type="number" value={pricing.motoPerKm} onChange={(e) => setPricing({ ...pricing, motoPerKm: +e.target.value })} style={styles.input} />
            </div>
          </div>
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>🚗 Économique</h3>
            <div style={styles.fieldRow}>
              <label style={styles.label}>Base (XAF)</label>
              <input type="number" value={pricing.ecoBase} onChange={(e) => setPricing({ ...pricing, ecoBase: +e.target.value })} style={styles.input} />
            </div>
            <div style={styles.fieldRow}>
              <label style={styles.label}>Par km (XAF)</label>
              <input type="number" value={pricing.ecoPerKm} onChange={(e) => setPricing({ ...pricing, ecoPerKm: +e.target.value })} style={styles.input} />
            </div>
          </div>
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>🚙 Confort</h3>
            <div style={styles.fieldRow}>
              <label style={styles.label}>Base (XAF)</label>
              <input type="number" value={pricing.comfortBase} onChange={(e) => setPricing({ ...pricing, comfortBase: +e.target.value })} style={styles.input} />
            </div>
            <div style={styles.fieldRow}>
              <label style={styles.label}>Par km (XAF)</label>
              <input type="number" value={pricing.comfortPerKm} onChange={(e) => setPricing({ ...pricing, comfortPerKm: +e.target.value })} style={styles.input} />
            </div>
          </div>
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>✨ VIP</h3>
            <div style={styles.fieldRow}>
              <label style={styles.label}>Base (XAF)</label>
              <input type="number" value={pricing.vipBase} onChange={(e) => setPricing({ ...pricing, vipBase: +e.target.value })} style={styles.input} />
            </div>
            <div style={styles.fieldRow}>
              <label style={styles.label}>Par km (XAF)</label>
              <input type="number" value={pricing.vipPerKm} onChange={(e) => setPricing({ ...pricing, vipPerKm: +e.target.value })} style={styles.input} />
            </div>
          </div>
        </div>
      </div>

      {/* Commission & Fidélité */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>⚙️ Commission & Fidélité</h2>
        <div style={styles.grid}>
          <div style={styles.card}>
            <div style={styles.fieldRow}>
              <label style={styles.label}>Commission 237GO (%)</label>
              <input type="number" value={pricing.commissionRate} onChange={(e) => setPricing({ ...pricing, commissionRate: +e.target.value })} style={styles.input} />
            </div>
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
  saveBtn: { padding: '12px 24px', backgroundColor: '#1B5E20', color: '#fff', borderRadius: 8, fontWeight: 700, fontSize: 14 },
  section: { marginBottom: 40 },
  sectionTitle: { fontSize: 20, fontWeight: 700, marginBottom: 16 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 },
  card: { backgroundColor: '#fff', padding: 20, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  cardTitle: { fontSize: 16, fontWeight: 700, marginBottom: 16 },
  fieldRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  label: { fontSize: 13, color: '#757575' },
  input: { padding: '8px 12px', border: '1px solid #e0e0e0', borderRadius: 6, fontSize: 14, width: 120, textAlign: 'right' },
};
