import React from 'react';

interface TermEndedLockProps {
  onLogout: () => void;
  user?: { profile?: { profileName?: string; position?: string; term_end?: string } } | null;
}

// 🔒 Shown to an official whose term has lapsed. They authenticated successfully,
// but their role was downgraded to 'restricted' server-side, so every admin API
// call returns 403. This screen explains why and offers a clean way out.
const TermEndedLock: React.FC<TermEndedLockProps> = ({ onLogout, user }) => {
  const name = user?.profile?.profileName;
  const position = user?.profile?.position;
  const termEnd = user?.profile?.term_end;

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
          <i className="fas fa-user-clock"></i>
        </div>

        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, margin: '0 0 10px' }}>
          Your term has ended
        </h1>

        <p style={{ color: '#94a3b8', lineHeight: 1.6, margin: '0 0 8px' }}>
          {name ? <strong style={{ color: '#e2e8f0' }}>{name}</strong> : 'This account'}
          {position ? ` — ${position}` : ''} no longer holds an active term, so official
          access has been <strong style={{ color: '#f87171' }}>restricted</strong>.
        </p>

        {termEnd && (
          <p style={{ color: '#64748b', fontSize: '0.85rem', margin: '0 0 8px' }}>
            Term ended on {new Date(termEnd).toLocaleDateString()}.
          </p>
        )}

        <p style={{ color: '#94a3b8', lineHeight: 1.6, margin: '0 0 28px' }}>
          To restore access, the Barangay Hall must register the official for the new term.
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
