import React, { useEffect, useState, useCallback } from 'react';
import api from '../config/api';

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
  const [total, setTotal] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRole, setFilterRole] = useState('ALL');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const params: Record<string, string> = { limit: '100' };
      if (filterRole !== 'ALL') params.role = filterRole;
      if (searchQuery) params.search = searchQuery;

      const res = await api.get('/admin/users', { params });
      setUsers(res.data.data.users || []);
      setTotal(res.data.data.total || 0);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erreur de chargement');
    } finally {
      setIsLoading(false);
    }
  }, [filterRole, searchQuery]);

  useEffect(() => {
    const timer = setTimeout(loadUsers, 300); // debounce la recherche
    return () => clearTimeout(timer);
  }, [loadUsers]);

  const toggleUser = async (id: string) => {
    try {
      await api.patch(`/admin/users/${id}/toggle`);
      await loadUsers();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Erreur');
    }
  };

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
        <p style={styles.subtitle}>{total} utilisateur(s) enregistré(s)</p>
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

      {error && <div style={styles.errorBox}>{error}</div>}

      <div style={styles.table}>
        <div style={styles.tableHeader}>
          <span style={{ ...styles.cell, flex: 2 }}>Nom</span>
          <span style={styles.cell}>Téléphone</span>
          <span style={styles.cell}>Rôle</span>
          <span style={styles.cell}>Statut</span>
          <span style={styles.cell}>Inscrit le</span>
          <span style={styles.cell}>Actions</span>
        </div>
        {isLoading ? (
          <div style={styles.empty}>Chargement...</div>
        ) : users.length === 0 ? (
          <div style={styles.empty}>Aucun utilisateur trouvé</div>
        ) : (
          users.map((user) => {
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
                  <button
                    style={styles.actionBtn}
                    onClick={() => toggleUser(user.id)}
                    title={user.isActive ? 'Désactiver' : 'Activer'}
                  >
                    {user.isActive ? '🔒' : '🔓'}
                  </button>
                </span>
              </div>
            );
          })
        )}
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
  filterBtn: { padding: '8px 16px', backgroundColor: '#f5f5f5', borderRadius: 6, fontSize: 12, fontWeight: 600, color: '#757575', cursor: 'pointer' },
  filterBtnActive: { backgroundColor: '#1DB954', color: '#fff' },
  errorBox: { backgroundColor: '#FFEBEE', color: '#D32F2F', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14 },
  table: { backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  tableHeader: { display: 'flex', padding: '14px 20px', backgroundColor: '#f9f9f9', borderBottom: '1px solid #e0e0e0', fontWeight: 700, fontSize: 13, color: '#757575' },
  tableRow: { display: 'flex', padding: '14px 20px', borderBottom: '1px solid #f0f0f0', alignItems: 'center', fontSize: 14 },
  cell: { flex: 1, display: 'flex', alignItems: 'center' },
  badge: { padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700 },
  actionBtn: { background: 'none', border: 'none', fontSize: 16, padding: '4px 8px', cursor: 'pointer' },
  empty: { padding: 48, textAlign: 'center', color: '#999' },
};
