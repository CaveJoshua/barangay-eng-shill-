import React, { useState, useEffect } from 'react';

interface ServerBusyDetail {
  message?: string;
  tagalogMessage?: string;
  retryAfter?: number;
}

export const ServerBusyToast: React.FC = () => {
  const [busyState, setBusyState] = useState<ServerBusyDetail | null>(null);
  const [countdown, setCountdown] = useState<number>(15);

  useEffect(() => {
    const handleBusy = (e: Event) => {
      const customEvent = e as CustomEvent<ServerBusyDetail>;
      const detail = customEvent.detail || {};
      setBusyState(detail);
      setCountdown(detail.retryAfter || 15);
    };

    window.addEventListener('server-busy', handleBusy);
    return () => window.removeEventListener('server-busy', handleBusy);
  }, []);

  useEffect(() => {
    if (!busyState) return;

    if (countdown <= 0) {
      setBusyState(null);
      return;
    }

    const timer = setInterval(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [busyState, countdown]);

  if (!busyState) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 99999,
        background: '#ffffff',
        border: '1px solid #fed7aa',
        borderRadius: '16px',
        padding: '1.2rem 1.5rem',
        boxShadow: '0 20px 40px -15px rgba(234, 88, 12, 0.25)',
        maxWidth: '420px',
        animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        fontFamily: 'inherit',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
        <div
          style={{
            background: '#ffedd5',
            color: '#c2410c',
            borderRadius: '50%',
            width: '36px',
            height: '36px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.1rem',
            flexShrink: 0,
          }}
        >
          <i className="fas fa-server"></i>
        </div>

        <div style={{ flex: 1 }}>
          <strong style={{ display: 'block', color: '#9a3412', fontSize: '0.95rem', marginBottom: '4px' }}>
            High Server Traffic (500+ Users)
          </strong>
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#475569', lineHeight: '1.4' }}>
            {busyState.message ||
              'The portal is currently at peak capacity. Please wait a moment while we finish pending transactions.'}
          </p>

          <div
            style={{
              marginTop: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.8rem',
              fontWeight: 700,
              color: '#ea580c',
            }}
          >
            <span>Retrying in {countdown}s...</span>
            <button
              onClick={() => setBusyState(null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                fontSize: '0.8rem',
                padding: '2px 6px',
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
