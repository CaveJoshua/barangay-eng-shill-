import React, { useState } from 'react';
import { ApiService } from '../UI/api';

interface OfficialResetProps {
  isOpen: boolean;
  accountId: string;
  firstName: string;
  onSuccess: () => void;
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: 'rgba(15, 23, 42, 0.55)', backdropFilter: 'blur(4px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000,
};

const cardStyle: React.CSSProperties = {
  backgroundColor: '#ffffff', padding: '32px 36px', borderRadius: '14px',
  boxShadow: '0 20px 40px rgba(0,0,0,0.15)', maxWidth: '420px', width: '90%',
  fontFamily: 'system-ui, -apple-system, sans-serif',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: '8px',
  border: '1px solid #cbd5e1', marginBottom: '12px', fontSize: '0.9rem', boxSizing: 'border-box',
};

const OfficialResetPasswordModal: React.FC<OfficialResetProps> = ({ isOpen, accountId, firstName, onSuccess }) => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!newPassword || !confirmPassword) {
      setError('Please fill in both password fields.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (!accountId) {
      setError('Session identity missing. Please log in again.');
      return;
    }

    setLoading(true);
    try {
      const result = await ApiService.resetPassword(accountId, { password: newPassword });
      if (!result.success) {
        throw new Error(result.error || 'Server rejected the password update.');
      }
      setNewPassword('');
      setConfirmPassword('');
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Password update failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={overlayStyle}>
      <div style={cardStyle}>
        <h2 style={{ margin: '0 0 8px', fontSize: '1.2rem', color: '#0f172a' }}>Action Required</h2>
        <p style={{ margin: '0 0 20px', fontSize: '0.85rem', color: '#64748b' }}>
          Hello {firstName || 'there'}, this account is still using its auto-generated password.
          Set a new one to continue.
        </p>

        {error && (
          <div style={{ backgroundColor: '#fef2f2', color: '#991b1b', padding: '10px 12px', borderRadius: '8px', marginBottom: '14px', fontSize: '0.82rem' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleReset}>
          <input
            type="password"
            placeholder="New password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            required
            autoComplete="new-password"
            style={inputStyle}
          />
          <input
            type="password"
            placeholder="Confirm new password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            required
            autoComplete="new-password"
            style={inputStyle}
          />
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '11px', borderRadius: '8px', border: 'none',
              backgroundColor: '#2563eb', color: '#fff', fontWeight: 700, fontSize: '0.9rem',
              cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default OfficialResetPasswordModal;
