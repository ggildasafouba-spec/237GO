import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import Logo from './Logo';

const navItems = [
  { path: '/', label: 'Dashboard', icon: '📊' },
  { path: '/users', label: 'Utilisateurs', icon: '👥' },
  { path: '/rides', label: 'Courses', icon: '🚗' },
  { path: '/deliveries', label: 'Livraisons', icon: '📦' },
  { path: '/drivers', label: 'Chauffeurs', icon: '🚕' },
  { path: '/merchants', label: 'Marchands', icon: '🏪' },
  { path: '/vehicles', label: 'Locations', icon: '🔑' },
  { path: '/finance', label: 'Finance', icon: '💰' },
  { path: '/disputes', label: 'Litiges', icon: '⚖️' },
  { path: '/settings', label: 'Paramètres', icon: '⚙️' },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  // Menu latéral : ouvert/fermé (utile sur mobile où il est masqué par défaut)
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = () => {
    localStorage.removeItem('admin_token');
    navigate('/login');
  };

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="admin-layout">
      {/* Bouton hamburger (visible uniquement sur petit écran via le CSS) */}
      <button
        className="admin-burger"
        onClick={() => setMenuOpen((o) => !o)}
        aria-label="Ouvrir le menu"
      >
        ☰
      </button>

      <aside className={`admin-sidebar${menuOpen ? ' open' : ''}`}>
        <div style={styles.logo}>
          <Logo size={40} />
          <div>
            <h1 style={styles.logoText}>237GO</h1>
            <span style={styles.logoSub}>Admin</span>
          </div>
        </div>
        {/* Barre couleurs Cameroun : vert - rouge - jaune */}
        <div style={styles.flagBar}>
          <div style={{ ...styles.flagStripe, backgroundColor: '#1DB954' }} />
          <div style={{ ...styles.flagStripe, backgroundColor: '#CE1126' }} />
          <div style={{ ...styles.flagStripe, backgroundColor: '#FCD116' }} />
        </div>
        <nav style={styles.nav}>
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              onClick={closeMenu}
              style={({ isActive }) => ({
                ...styles.navItem,
                ...(isActive ? styles.navItemActive : {}),
              })}
            >
              <span style={styles.navIcon}>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button onClick={handleLogout} style={styles.logoutBtn}>
          🚪 Déconnexion
        </button>
      </aside>

      {/* Voile sombre pour fermer le menu en tapant à côté (mobile) */}
      <div className="admin-overlay" onClick={closeMenu} />

      <main className="admin-main">{children}</main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  logo: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '0 24px 16px',
  },
  logoText: { fontSize: 24, fontWeight: 900, letterSpacing: 1, margin: 0 },
  logoSub: { fontSize: 11, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 2 },
  flagBar: { display: 'flex', height: 4, margin: '0 24px 20px', borderRadius: 2, overflow: 'hidden' },
  flagStripe: { flex: 1 },
  nav: { flex: 1, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' },
  navItem: {
    display: 'flex', alignItems: 'center', padding: '12px 16px',
    borderRadius: 10, color: 'rgba(255,255,255,0.7)', fontSize: 14,
    fontWeight: 500, transition: 'all 0.2s', textDecoration: 'none',
  },
  navItemActive: {
    backgroundColor: '#1DB954', color: '#fff', fontWeight: 700,
  },
  navIcon: { marginRight: 12, fontSize: 18 },
  logoutBtn: {
    margin: '0 16px', padding: '12px', backgroundColor: 'rgba(206,17,38,0.15)',
    color: '#FF6B7A', border: '1px solid rgba(206,17,38,0.3)', borderRadius: 8,
    fontSize: 14, cursor: 'pointer',
  },
};
