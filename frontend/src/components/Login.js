import React, { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase';
import DatBikeHeader from './DatBikeHeader';
import { colors, fontFamily } from '../theme';
import loginBg from '../assets/login-bg.png';

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      // App.js auth listener swaps to the main view automatically.
    } catch (err) {
      const code = err.code || '';
      if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
        setError('Invalid email or password.');
      } else if (code === 'auth/too-many-requests') {
        setError('Too many attempts. Please try again later.');
      } else {
        setError('Could not sign in. Please try again.');
      }
      setLoading(false);
    }
  };

  return (
    <div style={pageBgStyle}>
      <DatBikeHeader />
      <div style={centerStyle}>
        <form onSubmit={handleSubmit} style={cardStyle}>
          <div style={titleStyle}>Sign In</div>
          <div style={subtitleStyle}>Dat.Bike Production Log</div>

          <div style={formGroup}>
            <label style={labelStyle}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
              placeholder="you@datbike.com"
              autoFocus
              required
            />
          </div>

          <div style={formGroup}>
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
              placeholder="Enter your password"
              required
            />
          </div>

          {error && <div style={errorTextStyle}>{error}</div>}

          <button type="submit" disabled={loading} style={btnStyle}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

const pageBgStyle = {
  minHeight: '100vh',
  fontFamily,
  backgroundImage: `linear-gradient(rgba(10,10,10,0.55), rgba(10,10,10,0.75)), url(${loginBg})`,
  backgroundSize: 'cover',
  backgroundPosition: 'center',
  backgroundRepeat: 'no-repeat',
  backgroundAttachment: 'fixed',
};
const centerStyle = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'flex-start',
  padding: '80px 20px',
};
const cardStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
  width: '100%',
  maxWidth: '360px',
  padding: '36px',
  backgroundColor: colors.cardBg,
  borderRadius: '10px',
  border: `3px solid ${colors.orange}`,
  boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
};
const titleStyle = { fontSize: '22px', fontWeight: '700', color: colors.textDark };
const subtitleStyle = { fontSize: '13px', color: colors.textMuted, marginTop: '-10px' };
const formGroup = { display: 'flex', flexDirection: 'column', gap: '5px' };
const labelStyle = { fontWeight: '600', fontSize: '13px', color: colors.textMuted };
const inputStyle = { padding: '10px', borderRadius: '4px', border: '1px solid #89919a', fontSize: '14px', color: colors.textDark, backgroundColor: '#fff' };
const btnStyle = { padding: '11px', border: 'none', borderRadius: '4px', backgroundColor: colors.orange, color: '#fff', fontSize: '14px', fontWeight: '700', cursor: 'pointer', marginTop: '4px' };
const errorTextStyle = { color: colors.errorText, fontSize: '13px' };

export default Login;
