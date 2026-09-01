import React from 'react';
import { colors } from '../theme';

// Dat.Bike branded top bar — black background, orange accent, white wordmark.
// `right` renders optional content on the right side (e.g. user email + sign out).
function DatBikeHeader({ right = null }) {
  return (
    <div style={wrapStyle}>
      <div style={barStyle}>
        <div style={logoGroupStyle}>
          <span style={logoMarkStyle}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={colors.black} strokeWidth="2">
              <circle cx="6" cy="17" r="3.5" />
              <circle cx="18" cy="17" r="3.5" />
              <path d="M6 17l4-8h5l3 8M10 9l-1-3H7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span style={wordmarkStyle}>
            DAT<span style={{ color: colors.orange }}>.</span>BIKE
          </span>
          <span style={dividerStyle}>|</span>
          <span style={appTitleStyle}>Production Log — Production</span>
        </div>
        <div style={rightStyle}>{right}</div>
      </div>
      <div style={accentBarStyle} />
    </div>
  );
}

const wrapStyle = { width: '100%' };
const barStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  height: '56px',
  padding: '0 24px',
  backgroundColor: colors.black,
};
const logoGroupStyle = { display: 'flex', alignItems: 'center', gap: '12px' };
const logoMarkStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '34px',
  height: '34px',
  borderRadius: '50%',
  backgroundColor: colors.orange,
};
const wordmarkStyle = {
  color: colors.white,
  fontWeight: '800',
  fontSize: '20px',
  letterSpacing: '1px',
};
const dividerStyle = { color: '#555', fontSize: '18px' };
const appTitleStyle = { color: '#cfcfcf', fontSize: '15px', fontWeight: '500', whiteSpace: 'nowrap' };
const rightStyle = { display: 'flex', alignItems: 'center', gap: '14px' };
const accentBarStyle = { height: '3px', backgroundColor: colors.orange };

export default DatBikeHeader;
