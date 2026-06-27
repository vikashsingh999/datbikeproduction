import React, { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from './firebase';
import DatBikeHeader from './components/DatBikeHeader';
import DatBikeLogTab from './components/DatBikeLogTab';
import Login from './components/Login';
import { colors, fontFamily } from './theme';

function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setChecking(false);
    });
    return unsubscribe;
  }, []);

  if (checking) {
    return (
      <div style={pageBgStyle}>
        <DatBikeHeader />
        <div style={loadingStyle}>Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <div style={pageBgStyle}>
      <DatBikeHeader
        right={
          <>
            <span style={userEmailStyle}>{user.email}</span>
            <button type="button" onClick={() => signOut(auth)} style={logoutBtnStyle}>Sign Out</button>
          </>
        }
      />
      <div style={pageTitleRowStyle}>
        <span style={pageTitleStyle}>Production Log</span>
      </div>
      <div style={containerStyle}>
        <DatBikeLogTab />
      </div>
    </div>
  );
}

const pageBgStyle = {
  minHeight: '100vh',
  backgroundColor: colors.pageBg,
  fontFamily,
};

const pageTitleRowStyle = {
  display: 'flex',
  alignItems: 'center',
  padding: '18px 24px 8px',
};

const pageTitleStyle = {
  fontSize: '24px',
  fontWeight: '700',
  color: colors.textDark,
};

const userEmailStyle = { fontSize: '13px', color: '#cfcfcf' };
const logoutBtnStyle = { padding: '6px 14px', border: `1px solid ${colors.orange}`, borderRadius: '4px', backgroundColor: 'transparent', color: colors.orange, fontSize: '13px', fontWeight: '600', cursor: 'pointer' };

const loadingStyle = { padding: '40px', textAlign: 'center', color: colors.textMuted };

const containerStyle = {
  maxWidth: '800px',
  margin: '0 auto 40px',
  padding: '20px',
  backgroundColor: colors.cardBg,
  borderRadius: '8px',
  border: `1px solid ${colors.border}`,
};

export default App;
