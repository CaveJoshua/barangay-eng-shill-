import React from 'react';

interface TermEndedLockProps {
  onLogout: () => void;
  user?: { profile?: { profileName?: string; position?: string; official_status?: string } } | null;
}

// 🔒 Shown to an official whose access has been restricted by an explicit
// status change (Suspended / Resigned) made by the Punong Barangay. They
// authenticated successfully, but their role was downgraded to 'restricted'
// server-side, so every admin API call returns 403. This screen explains why
// and always points them back to the Barangay Hall Officials to resolve it —
// this is not a self-service unlock.
const TermEndedLock: React.FC<TermEndedLockProps> = ({ onLogout, user }) => {
  const name = user?.profile?.profileName;
  const position = user?.profile?.position;
  const officialStatus = (user?.profile?.official_status || '').toLowerCase().trim();

  const REASON_COPY: Record<string, { icon: string; headline: string; detail: string }> = {
    suspended: {
      icon: 'fa-user-slash',
      headline: 'Your access has been suspended',
      detail: 'has been placed under a suspension by the Punong Barangay, so official access is temporarily restricted.',
    },
    resigned: {
      icon: 'fa-user-slash',
      headline: 'This account is marked as resigned',
      detail: 'has been recorded as resigned, so official access has been withdrawn.',
    },
  };

  const DEFAULT_REASON = {
    icon: 'fa-lock',
    headline: 'Your access has been restricted',
    detail: 'no longer has active official access.',
  };

  const reason = REASON_COPY[officialStatus] || DEFAULT_REASON;

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0f172a',
        padding: '24px',
        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 460,
          width: '100%',
          background: '#1e293b',
          border: '1px solid #334155',
          borderRadius: 16,
          padding: '40px 32px',
          textAlign: 'center',
          color: '#f1f5f9',
          boxShadow: '0 20px 45px -15px rgba(0,0,0,0.6)',
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            background: 'rgba(239,68,68,0.12)',
            color: '#f87171',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 28,
            margin: '0 auto 20px',
          }}
        >
          <i className={`fas ${reason.icon}`}></i>
        </div>

        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, margin: '0 0 10px' }}>
          {reason.headline}
        </h1>

        <p style={{ color: '#94a3b8', lineHeight: 1.6, margin: '0 0 8px' }}>
          {name ? <strong style={{ color: '#e2e8f0' }}>{name}</strong> : 'This account'}
          {position ? ` — ${position}` : ''} {reason.detail} Official access has been{' '}
          <strong style={{ color: '#f87171' }}>restricted</strong>.
        </p>

        <p style={{ color: '#94a3b8', lineHeight: 1.6, margin: '0 0 28px' }}>
          Please contact the <strong style={{ color: '#e2e8f0' }}>Barangay Hall Officials</strong> for access details.
        </p>

        <button
          onClick={onLogout}
          style={{
            background: '#ef4444',
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            padding: '12px 24px',
            fontWeight: 700,
            fontSize: '0.95rem',
            cursor: 'pointer',
            width: '100%',
          }}
        >
          <i className="fas fa-sign-out-alt" style={{ marginRight: 8 }}></i>
          Log out
        </button>
      </div>
    </div>
  );
};

export default TermEndedLock;
