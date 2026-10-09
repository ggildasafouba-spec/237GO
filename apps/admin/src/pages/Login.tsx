import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Logo from '../components/Logo';

export default function Login() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const response = await axios.post('/api/auth/login', { phone, password });
      const { user, token } = response.data.data;

      if (user.role !== 'ADMIN') {
        setError('Accès réservé aux administrateurs');
        setIsLoading(false);
        return;
      }

      localStorage.setItem('admin_token', token);
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erreur de connexion');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <form onSubmit={handleSubmit} style={styles.form}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          <Logo size={80} />
        </div>
        <h1 style={styles.logo}>237GO</h1>
        <p style={styles.subtitle}>Administration</p>
        <div style={styles.flagBar}>
          <div style={{ flex: 1, backgroundColor: '#1DB954' }} />
          <div style={{ flex: 1, backgroundColor: '#CE1126' }} />
          <div style={{ flex: 1, backgroundColor: '#FCD116' }} />
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <input
          type="text"
          placeholder="Téléphone (6XXXXXXXX)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          style={styles.input}
          maxLength={9}
        />
        <input
          type="password"
          placeholder="Mot de passe"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={styles.input}
        />
        <button type="submit" disabled={isLoading} style={styles.button}>
          {isLoading ? 'Connexion...' : 'Se connecter'}
        </button>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh',
    background: 'linear-gradient(160deg, #0C1310 0%, #1C2621 60%, #121A17 100%)',
  },
  form: { backgroundColor: '#fff', padding: 48, borderRadius: 20, width: 380, textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' },
  logo: { fontSize: 34, fontWeight: 900, color: '#141A17', marginBottom: 4 },
  subtitle: { color: '#757575', marginBottom: 16, fontSize: 14 },
  flagBar: { display: 'flex', height: 4, width: 90, margin: '0 auto 28px', borderRadius: 2, overflow: 'hidden' },
  input: { width: '100%', padding: 14, border: '1px solid #e0e0e0', borderRadius: 10, fontSize: 16, marginBottom: 16, boxSizing: 'border-box' },
  button: { width: '100%', padding: 14, backgroundColor: '#1DB954', color: '#fff', border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 700, cursor: 'pointer' },
  error: { backgroundColor: '#FFEBEE', color: '#CE1126', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14 },
};
