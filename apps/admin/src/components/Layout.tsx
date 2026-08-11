import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';

const navItems = [
  { path: '/', label: 'Dashboard', icon: '📊' },
  { path: '/users', label: 'Utilisateurs', icon: '👥' },
  { path: '/rides', label: 'Courses', icon: '🚗' },
  { path: '/deliveries', label: 'Livraisons', icon: '📦' },
  { path: '/drivers', label: 'Chauffeurs', icon: '🚕' },
  { path: '/merchants', label: 'Marchands', icon: '🏪' },
  { path: '/finance', label: 'Finance', icon: '💰' },
  { path: '/settings', label: 'Paramètres', icon: '⚙️' },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem('admin_token');
    navigate('/login');
  };

  return (
    <div style={styles.layout}>
      <aside style={styles.sidebar}>
        <div style={styles.logo}>
          <h1 style={styles.logoText}>237GO</h1>
          <span style={styles.logoSub}>Admin</span>
        </div>
        <nav style={styles.nav}>
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
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
      <main style={styles.main}>{children}</main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  layout: { display: 'flex', minHeight: '100vh' },
  sidebar: {
    width: 250, backgroundColor: '#1B5E20', color: '#fff',
    display: 'flex', flexDirection: 'column', padding: '20px 0',
    position: 'fixed', height: '100vh', left: 0, top: 0,
  },
  logo: { padding: '0 24px 24px', borderBottom: '1px solid rgba(255,255,255,0.15)' },
  logoText: { fontSize: 28, fontWeight: 900, letterSpacing: 1 },
  logoSub: { fontSize: 12, opacity: 0.7, textTransform: 'uppercase', letterSpacing: 2 },
  nav: { flex: 1, padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 4 },
  navItem: {
    display: 'flex', alignItems: 'center', padding: '12px 16px',
    borderRadius: 8, color: 'rgba(255,255,255,0.75)', fontSize: 14,
    fontWeight: 500, transition: 'all 0.2s',
  },
  navItemActive: {
    backgroundColor: 'rgba(255,255,255,0.15)', color: '#fff', fontWeight: 700,
  },
  navIcon: { marginRight: 12, fontSize: 18 },
  logoutBtn: {
    margin: '0 16px', padding: '12px', backgroundColor: 'rgba(255,255,255,0.1)',
    color: '#fff', borderRadius: 8, fontSize: 14,
  },
  main: { flex: 1, marginLeft: 250, padding: 32 },
};
