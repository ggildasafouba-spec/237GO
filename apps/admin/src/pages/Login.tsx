import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Logo from '../components/Logo';

export default function Login() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  // Étape 2 : code reçu par email (double vérification administrateur)
  const [challenge, setChallenge] = useState<{ challengeToken: string; maskedEmail: string } | null>(null);
  const [code, setCode] = useState('');
  const navigate = useNavigate();

  const finish = (user: { role: string }, token: string, warning?: string) => {
    if (user.role !== 'ADMIN') {
      setError('Accès réservé aux administrateurs');
      return;
    }
    localStorage.setItem('admin_token', token);
    if (warning) alert(`⚠️ ${warning}`);
    navigate('/');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const response = await axios.post('/api/auth/login', { phone: phone.trim(), password });
      const data = response.data.data;
      if (data.twoFactorRequired) {
        setChallenge({ challengeToken: data.challengeToken, maskedEmail: data.maskedEmail });
        setCode('');
        return;
      }
      finish(data.user, data.token, data.securityWarning);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erreur de connexion');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challenge) return;
    setIsLoading(true);
    setError('');
    try {
      const response = await axios.post('/api/auth/login/verify', {
        challengeToken: challenge.challengeToken,
        code: code.trim(),
      });
      const { user, token } = response.data.data;
      finish(user, token);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Code incorrect');
      // Demande expirée ou trop d'essais : retour à l'étape 1
      if (err.response?.status === 401 || err.response?.status === 429) setChallenge(null);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <form onSubmit={challenge ? handleVerify : handleSubmit} style={styles.form}>
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

        {challenge ? (
          <>
            <p style={styles.info}>
              🔐 Un code à 6 chiffres a été envoyé à <strong>{challenge.maskedEmail}</strong>.
              <br />Il est valable 10 minutes.
            </p>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="Code à 6 chiffres"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              style={{ ...styles.input, letterSpacing: 6, textAlign: 'center', fontSize: 22 }}
              maxLength={6}
              autoFocus
              aria-label="Code de vérification"
            />
            <button type="submit" disabled={isLoading || code.length !== 6} style={styles.button}>
              {isLoading ? 'Vérification...' : 'Valider'}
            </button>
            <button
              type="button"
              onClick={() => { setChallenge(null); setError(''); setPassword(''); }}
              style={styles.linkBtn}
            >
              ← Recommencer
            </button>
          </>
        ) : (
          <>
            <input
              type="text"
              placeholder="Téléphone ou email"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              style={styles.input}
              maxLength={80}
              autoComplete="username"
              aria-label="Téléphone ou email"
            />
            <input
              type="password"
              placeholder="Mot de passe"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.input}
              autoComplete="current-password"
              aria-label="Mot de passe"
            />
            <button type="submit" disabled={isLoading} style={styles.button}>
              {isLoading ? 'Connexion...' : 'Se connecter'}
            </button>
          </>
        )}
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh',
    padding: 16,
    background: 'linear-gradient(160deg, #0C1310 0%, #1C2621 60%, #121A17 100%)',
  },
  form: { backgroundColor: '#fff', padding: 40, borderRadius: 20, width: '100%', maxWidth: 380, textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' },
  logo: { fontSize: 34, fontWeight: 900, color: '#141A17', marginBottom: 4 },
  subtitle: { color: '#757575', marginBottom: 16, fontSize: 14 },
  flagBar: { display: 'flex', height: 4, width: 90, margin: '0 auto 28px', borderRadius: 2, overflow: 'hidden' },
  info: { fontSize: 14, color: '#424242', lineHeight: 1.5, marginBottom: 16 },
  input: { width: '100%', padding: 14, border: '1px solid #e0e0e0', borderRadius: 10, fontSize: 16, marginBottom: 16, boxSizing: 'border-box' },
  button: { width: '100%', padding: 14, backgroundColor: '#1DB954', color: '#fff', border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 700, cursor: 'pointer' },
  linkBtn: { width: '100%', marginTop: 12, padding: 8, background: 'none', border: 'none', color: '#757575', cursor: 'pointer', fontSize: 14 },
  error: { backgroundColor: '#FFEBEE', color: '#CE1126', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14 },
};
