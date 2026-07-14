import React, { useState } from 'react';
import { ApiService } from '../UI/api';
import { getPasswordChecks, getPasswordStrength, strengthColor } from './Tools/PasswordChecks';

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

const baseInputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: '8px',
  border: '1px solid #cbd5e1', marginBottom: '6px', fontSize: '0.9rem', boxSizing: 'border-box',
  transition: 'border-color 120ms ease',
};

const dotStyle = (met: boolean, dirty: boolean): React.CSSProperties => ({
  display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%',
  marginRight: '7px', flexShrink: 0,
  backgroundColor: !dirty ? '#cbd5e1' : met ? '#16a34a' : '#dc2626',
  transition: 'background-color 120ms ease',
});

const OfficialResetPasswordModal: React.FC<OfficialResetProps> = ({ isOpen, accountId, firstName, onSuccess }) => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const checks = getPasswordChecks(newPassword, firstName);
  const passwordDirty = newPassword.length > 0;
  const allChecksMet = checks.every(c => c.met);
  const strength = getPasswordStrength(newPassword, checks);

  const confirmDirty = confirmPassword.length > 0;
  const passwordsMatch = confirmDirty && newPassword === confirmPassword;

  const newPasswordFieldStyle: React.CSSProperties = {
    ...baseInputStyle,
    borderColor: !passwordDirty ? '#cbd5e1' : allChecksMet ? '#16a34a' : '#dc2626',
  };
  const confirmFieldStyle: React.CSSProperties = {
    ...baseInputStyle,
    borderColor: !confirmDirty ? '#cbd5e1' : passwordsMatch ? '#16a34a' : '#dc2626',
  };

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
            style={newPasswordFieldStyle}
          />

          {passwordDirty && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', fontSize: '0.75rem', fontWeight: 700, color: strengthColor(strength), margin: '0 0 8px' }}>
              {strength.toUpperCase()} PASSWORD
            </div>
          )}

          <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px', marginBottom: '12px', fontSize: '0.78rem', color: '#475569' }}>
            {checks.map(c => (
              <div key={c.label} style={{ display: 'flex', alignItems: 'center', padding: '2px 0', color: !passwordDirty ? '#64748b' : c.met ? '#166534' : '#991b1b' }}>
                <span style={dotStyle(c.met, passwordDirty)} />
                {c.label}
              </div>
            ))}
            <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid #e2e8f0', color: '#94a3b8', fontSize: '0.72rem' }}>
              Also checked on submit: must differ from your current password, and must not be your username.
            </div>
          </div>

          <input
            type="password"
            placeholder="Confirm new password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            required
            autoComplete="new-password"
            style={confirmFieldStyle}
          />
          {confirmDirty && !passwordsMatch && (
            <div style={{ display: 'flex', alignItems: 'center', fontSize: '0.75rem', color: '#991b1b', margin: '2px 0 10px' }}>
              <span style={dotStyle(false, true)} />
              Passwords do not match
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '11px', borderRadius: '8px', border: 'none', marginTop: confirmDirty && !passwordsMatch ? 0 : '12px',
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
