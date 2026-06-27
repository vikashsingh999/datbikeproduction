import React from 'react';

const Icon = ({ children, label }) => (
  <span role="img" aria-label={label} style={iconButtonStyle}>
    {children}
  </span>
);

function FioriShell({ system = 'Test', systemId = 'N27/100', title, initials = 'VS' }) {
  return (
    <div>
      <div style={statusBarStyle}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
          <path d="M12 2 4 5v6c0 5 3.5 8.5 8 11 4.5-2.5 8-6 8-11V5l-8-3z" />
        </svg>
        <span style={statusTextStyle}>{system}</span>
        <span style={statusIdStyle}>{systemId}</span>
      </div>

      <div style={headerBarStyle}>
        <Icon label="Menu">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#32363a" strokeWidth="2">
            <path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round" />
          </svg>
        </Icon>
        <Icon label="Back">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#32363a" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Icon>

        <span style={sapLogoStyle}>SAP</span>
        <span style={productNameStyle}>S/4HANA Cloud</span>
        <span style={dividerStyle}>|</span>
        <span style={appTitleStyle}>{title}</span>

        <div style={headerSpacerStyle} />

        <Icon label="Search">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#32363a" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
          </svg>
        </Icon>
        <Icon label="Notifications">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#32363a" strokeWidth="2">
            <path d="M6 17h12M8 17v-6a4 4 0 1 1 8 0v6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M10 20a2 2 0 0 0 4 0" />
          </svg>
        </Icon>
        <Icon label="Support">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#32363a" strokeWidth="2">
            <path d="M4 13a8 8 0 1 1 16 0v4a2 2 0 0 1-2 2h-1v-6h3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4 13v3a2 2 0 0 0 2 2h1v-6H4z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Icon>
        <Icon label="Help">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#32363a" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
            <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.3" strokeLinecap="round" />
            <circle cx="12" cy="17" r="0.6" fill="#32363a" />
          </svg>
        </Icon>
        <span style={avatarStyle}>{initials}</span>
      </div>
    </div>
  );
}

const statusBarStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  height: '24px',
  backgroundColor: '#93004f',
  color: '#fff',
};
const statusTextStyle = { fontSize: '12px', fontWeight: '700' };
const statusIdStyle = { fontSize: '12px', fontWeight: '400', opacity: 0.9 };

const headerBarStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '14px',
  height: '48px',
  padding: '0 16px',
  backgroundColor: '#fff',
  borderBottom: '1px solid #e5e5e5',
};
const iconButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '32px',
  height: '32px',
  borderRadius: '50%',
  cursor: 'default',
};
const sapLogoStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '44px',
  height: '24px',
  backgroundColor: '#0a6ed1',
  color: '#fff',
  fontWeight: '700',
  fontStyle: 'italic',
  fontSize: '15px',
  letterSpacing: '0.5px',
};
const productNameStyle = { fontSize: '15px', color: '#32363a', whiteSpace: 'nowrap' };
const dividerStyle = { color: '#d9d9d9', fontSize: '15px' };
const appTitleStyle = { fontSize: '15px', fontWeight: '600', color: '#32363a', whiteSpace: 'nowrap' };
const headerSpacerStyle = { flex: 1 };
const avatarStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '32px',
  height: '32px',
  borderRadius: '50%',
  backgroundColor: '#c4e3f5',
  color: '#0a4a7a',
  fontSize: '13px',
  fontWeight: '700',
  marginLeft: '4px',
};

export default FioriShell;
