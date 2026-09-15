import React, { useEffect, useRef, useState } from 'react';
import { colors } from '../theme';

// Who is signed in, and the way out, folded into the header avatar. The bar is
// tight on a tablet held in portrait, and an address like
// quality.line2@datbike.com crowds out the app title when it sits there in full.
function UserMenu({ email, onSignOut }) {
  const [open, setOpen] = useState(false);
  const [signOutHot, setSignOutHot] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const closeOnOutside = (e) => {
      if (!wrapRef.current || wrapRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const closeOnEscape = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('touchstart', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('touchstart', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const initial = (email || '?').trim().charAt(0).toUpperCase();

  return (
    <div style={wrapStyle} ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        style={triggerStyle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${email}`}
        title={email}
      >
        <span style={avatarStyle}>{initial}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          aria-hidden="true"
          style={{ ...chevronStyle, transform: open ? 'rotate(180deg)' : 'none' }}
        >
          <path d="M1 3.5L5 7.5L9 3.5" fill="none" stroke="#cfcfcf" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div style={panelStyle} role="menu">
          <div style={labelStyle}>Signed in as / Đang đăng nhập</div>
          <div style={emailStyle}>{email}</div>
          <div style={dividerStyle} />
          <button
            type="button"
            onClick={onSignOut}
            onMouseEnter={() => setSignOutHot(true)}
            onMouseLeave={() => setSignOutHot(false)}
            style={{ ...signOutStyle, backgroundColor: signOutHot ? '#fdf1e9' : 'transparent' }}
            role="menuitem"
          >
            Sign Out / Đăng xuất
          </button>
        </div>
      )}
    </div>
  );
}

const wrapStyle = { position: 'relative' };
const triggerStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '7px',
  padding: '4px 8px 4px 4px',
  border: '1px solid #3a3a3a',
  borderRadius: '20px',
  backgroundColor: 'transparent',
  fontFamily: 'inherit',
  cursor: 'pointer',
};
const avatarStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '28px',
  height: '28px',
  borderRadius: '50%',
  backgroundColor: colors.orange,
  color: colors.black,
  fontSize: '13px',
  fontWeight: '700',
};
const chevronStyle = { transition: 'transform 120ms ease', flexShrink: 0 };
const panelStyle = {
  position: 'absolute',
  top: 'calc(100% + 12px)',
  right: 0,
  zIndex: 20,
  minWidth: '232px',
  padding: '14px 16px',
  backgroundColor: colors.cardBg,
  border: `1px solid ${colors.border}`,
  borderTop: `3px solid ${colors.orange}`,
  borderRadius: '6px',
  boxShadow: '0 10px 28px rgba(0,0,0,0.28)',
};
const labelStyle = { fontSize: '11px', fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.4px' };
const emailStyle = { marginTop: '5px', fontSize: '13px', fontWeight: '600', color: colors.textDark, wordBreak: 'break-all' };
const dividerStyle = { height: '1px', margin: '13px -16px 9px', backgroundColor: colors.border };
const signOutStyle = {
  display: 'block',
  width: '100%',
  padding: '8px 10px',
  border: 'none',
  borderRadius: '4px',
  backgroundColor: 'transparent',
  color: colors.orange,
  fontSize: '13px',
  fontWeight: '700',
  fontFamily: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
};

export default UserMenu;
