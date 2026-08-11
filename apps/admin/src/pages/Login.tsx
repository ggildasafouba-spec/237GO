import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

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
        <h1 style={styles.logo}>237GO</h1>
        <p style={styles.subtitle}>Administration</p>

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
  container: { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: '#1B5E20' },
  form: { backgroundColor: '#fff', padding: 48, borderRadius: 16, width: 380, textAlign: 'center' },
  logo: { fontSize: 36, fontWeight: 900, color: '#1B5E20', marginBottom: 4 },
  subtitle: { color: '#757575', marginBottom: 32, fontSize: 14 },
  input: { width: '100%', padding: 14, border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 16, marginBottom: 16 },
  button: { width: '100%', padding: 14, backgroundColor: '#1B5E20', color: '#fff', borderRadius: 8, fontSize: 16, fontWeight: 700 },
  error: { backgroundColor: '#FFEBEE', color: '#D32F2F', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14 },
};
