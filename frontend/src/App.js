import React, { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from './firebase';
import DatBikeHeader from './components/DatBikeHeader';
import DatBikeLogTab from './components/DatBikeLogTab';
import Login from './components/Login';
import UserMenu from './components/UserMenu';
import { colors, fontFamily } from './theme';
import {
  IDLE_LIMIT_MS,
  idleMs,
  keepSignedIn,
  markIdleSignOut,
  noteActivity,
  rememberKeepSignedIn,
} from './session';

// Activity is polled rather than run off a single long timer: a timer set for
// half an hour does not survive a tablet going to sleep, a clock check does.
const IDLE_POLL_MS = 15 * 1000;
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'wheel', 'scroll'];

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

  // Sessions the user asked to keep are left alone; the rest are signed out once
  // the station has been idle past the limit.
  useEffect(() => {
    if (!user || keepSignedIn()) return undefined;

    noteActivity();
    ACTIVITY_EVENTS.forEach((name) => window.addEventListener(name, noteActivity, { passive: true }));

    const check = () => {
      if (idleMs() < IDLE_LIMIT_MS) return;
      markIdleSignOut();
      signOut(auth);
    };
    const poll = setInterval(check, IDLE_POLL_MS);
    // Coming back to a backgrounded tab is where the limit is most often
    // already blown, and the poll may have been throttled while it was hidden.
    document.addEventListener('visibilitychange', check);

    return () => {
      clearInterval(poll);
      document.removeEventListener('visibilitychange', check);
      ACTIVITY_EVENTS.forEach((name) => window.removeEventListener(name, noteActivity));
    };
  }, [user]);

  const handleSignOut = () => {
    // Signing out by hand drops the preference too, so the next sign-in starts
    // from an unticked box rather than silently reusing the last choice.
    rememberKeepSignedIn(false);
    signOut(auth);
  };

  if (checking) {
    return (
      <div style={pageBgStyle}>
        <DatBikeHeader />
        <div style={loadingStyle}>Loading... / Đang tải...</div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <div style={pageBgStyle}>
      <DatBikeHeader
        right={<UserMenu email={user.email} onSignOut={handleSignOut} />}
      />
      <div style={pageTitleRowStyle}>
        <span style={pageTitleStyle}>Production Log<span style={pageTitleViStyle}>Nhật ký sản xuất</span></span>
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
  display: 'flex',
  flexDirection: 'column',
  fontSize: '24px',
  fontWeight: '700',
  color: colors.textDark,
};

const pageTitleViStyle = {
  fontSize: '14px',
  fontWeight: '500',
  color: colors.orange,
};

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
