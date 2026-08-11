import React, { useEffect, useState } from 'react';
import axios from 'axios';

interface User {
  id: string;
  phone: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

export default function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRole, setFilterRole] = useState('ALL');

  useEffect(() => {
    // TODO: Fetch from admin API
    setUsers([
      { id: '1', phone: '691234567', firstName: 'Jean', lastName: 'Mballa', role: 'PASSENGER', isActive: true, createdAt: '2026-01-15' },
      { id: '2', phone: '677654321', firstName: 'Marie', lastName: 'Ngo', role: 'DRIVER', isActive: true, createdAt: '2026-02-20' },
      { id: '3', phone: '655112233', firstName: 'Paul', lastName: 'Tchamba', role: 'MERCHANT', isActive: true, createdAt: '2026-03-10' },
      { id: '4', phone: '698765432', firstName: 'Aimé', lastName: 'Fotso', role: 'PASSENGER', isActive: false, createdAt: '2026-04-05' },
    ]);
  }, []);

  const filteredUsers = users.filter((u) => {
    if (filterRole !== 'ALL' && u.role !== filterRole) return false;
    if (searchQuery && !`${u.firstName} ${u.lastName} ${u.phone}`.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const getRoleBadge = (role: string) => {
    const badges: Record<string, { bg: string; color: string }> = {
      PASSENGER: { bg: '#E3F2FD', color: '#1976D2' },
      DRIVER: { bg: '#E8F5E9', color: '#388E3C' },
      MERCHANT: { bg: '#FFF3E0', color: '#E65100' },
      ADMIN: { bg: '#F3E5F5', color: '#7B1FA2' },
    };
    return badges[role] || { bg: '#f5f5f5', color: '#757575' };
  };

  return (
    <div>
      <div style={styles.header}>
        <h1 style={styles.title}>Utilisateurs</h1>
        <p style={styles.subtitle}>{users.length} utilisateurs enregistrés</p>
      </div>

      <div style={styles.filters}>
        <input
          type="text"
          placeholder="🔍 Rechercher par nom ou téléphone..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={styles.searchInput}
        />
        <div style={styles.filterBtns}>
          {['ALL', 'PASSENGER', 'DRIVER', 'MERCHANT', 'ADMIN'].map((role) => (
            <button
              key={role}
              onClick={() => setFilterRole(role)}
              style={{ ...styles.filterBtn, ...(filterRole === role ? styles.filterBtnActive : {}) }}
            >
              {role === 'ALL' ? 'Tous' : role}
            </button>
          ))}
        </div>
      </div>

      <div style={styles.table}>
        <div style={styles.tableHeader}>
          <span style={{ ...styles.cell, flex: 2 }}>Nom</span>
          <span style={styles.cell}>Téléphone</span>
          <span style={styles.cell}>Rôle</span>
          <span style={styles.cell}>Statut</span>
          <span style={styles.cell}>Inscrit le</span>
          <span style={styles.cell}>Actions</span>
        </div>
        {filteredUsers.map((user) => {
          const badge = getRoleBadge(user.role);
          return (
            <div key={user.id} style={styles.tableRow}>
              <span style={{ ...styles.cell, flex: 2, fontWeight: 600 }}>
                {user.firstName} {user.lastName}
              </span>
              <span style={styles.cell}>+237 {user.phone}</span>
              <span style={styles.cell}>
                <span style={{ ...styles.badge, backgroundColor: badge.bg, color: badge.color }}>
                  {user.role}
                </span>
              </span>
              <span style={styles.cell}>
                <span style={{ color: user.isActive ? '#388E3C' : '#D32F2F' }}>
                  {user.isActive ? '● Actif' : '● Inactif'}
                </span>
              </span>
              <span style={styles.cell}>{new Date(user.createdAt).toLocaleDateString('fr-FR')}</span>
              <span style={styles.cell}>
                <button style={styles.actionBtn}>👁️</button>
                <button style={styles.actionBtn}>{user.isActive ? '🔒' : '🔓'}</button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: { marginBottom: 24 },
  title: { fontSize: 28, fontWeight: 700 },
  subtitle: { color: '#757575', marginTop: 4 },
  filters: { display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' },
  searchInput: { padding: '12px 16px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 14, width: 300 },
  filterBtns: { display: 'flex', gap: 8 },
  filterBtn: { padding: '8px 16px', backgroundColor: '#f5f5f5', borderRadius: 6, fontSize: 12, fontWeight: 600, color: '#757575' },
  filterBtnActive: { backgroundColor: '#1B5E20', color: '#fff' },
  table: { backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  tableHeader: { display: 'flex', padding: '14px 20px', backgroundColor: '#f9f9f9', borderBottom: '1px solid #e0e0e0', fontWeight: 700, fontSize: 13, color: '#757575' },
  tableRow: { display: 'flex', padding: '14px 20px', borderBottom: '1px solid #f0f0f0', alignItems: 'center', fontSize: 14 },
  cell: { flex: 1, display: 'flex', alignItems: 'center' },
  badge: { padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700 },
  actionBtn: { background: 'none', fontSize: 16, padding: '4px 8px', cursor: 'pointer' },
};
