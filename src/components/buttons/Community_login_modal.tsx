import React, { useState, useEffect, useCallback } from 'react';
import './styles/Community_login_modal.css';
import { API_BASE_URL } from '../UI/api'; 

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (data: any) => void; 
}

export const CommunityLoginModal: React.FC<LoginModalProps> = ({ isOpen, onClose, onLoginSuccess }) => {
  // --- View State ---
  const [isForgotPasswordView, setIsForgotPasswordView] = useState(false);
  const [recoveryPhase, setRecoveryPhase] = useState<'request' | 'reset'>('request');

  // --- Login State ---
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  
  // --- Forgot Password State ---
  const [recoveryIdentifier, setRecoveryIdentifier] = useState('');
  const [otpCode, setOtpCode] = useState('');        
  const [newPassword, setNewPassword] = useState(''); 
  const [recoverySuccessMsg, setRecoverySuccessMsg] = useState('');

  // --- Shared State ---
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);

  const LOGIN_URL = `${API_BASE_URL}/residents/login`;
  const FORGOT_PW_URL = `${API_BASE_URL}/accounts/request-otp`; 
  const RESET_PW_URL = `${API_BASE_URL}/accounts/public-reset`; 

  const getFingerprint = useCallback(() => {
    let fp = document.cookie.split('; ').find(row => row.startsWith('sb_dev_fp='))?.split('=')[1];
    if (!fp) {
      fp = 'dev_' + Math.random().toString(36).substring(2, 15);
      document.cookie = `sb_dev_fp=${fp}; max-age=86400; path=/`;
    }
    return fp;
  }, []);

  useEffect(() => {
    const deviceId = getFingerprint();
    const savedLockout = localStorage.getItem(`lockout_${deviceId}`);
    if (savedLockout && Date.now() < parseInt(savedLockout)) {
      setLockoutUntil(parseInt(savedLockout));
    }
  }, [getFingerprint]);

  // ─── LOGIN HANDLER ──────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const now = Date.now();
    const deviceId = getFingerprint();

    if (lockoutUntil && now < lockoutUntil) {
      setError(`Security Lock: Try again shortly.`);
      return;
    }

    setError('');
    setLoading(true);

    try {
      const res = await fetch(LOGIN_URL, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // 🛡️ CRITICAL: Accepts the HttpOnly cookie from backend
        body: JSON.stringify({ 
          username: username.trim().toLowerCase(), 
          password: password.trim(), 
          deviceId 
        })
      });

      const data = await res.json();
      
      if (!res.ok) {
        if (res.status === 429) {
          const penalty = now + 60000; 
          setLockoutUntil(penalty);
          localStorage.setItem(`lockout_${deviceId}`, penalty.toString());
          throw new Error("Too many attempts. Locked for 60s.");
        }
        throw new Error(data.error || 'Invalid resident credentials');
      }

      const needsReset = data.requires_reset || data.user?.requires_reset || data.profile?.is_first_login;
      const sessionData = { ...data, requires_reset: needsReset };

      // 🛡️ ZERO TRUST UPDATE: 
      // We ONLY store non-sensitive UI state here. 
      // The actual JWT is now locked inside the browser's HttpOnly cookie vault.
      localStorage.setItem('user_role', 'resident');
      localStorage.setItem('resident_session', JSON.stringify(sessionData));

      onLoginSuccess(sessionData); 
      onClose();
    } catch (err: any) {
      setError(err.message); 
    } finally {
      setLoading(false);
    }
  };

  // ─── PHASE 1: REQUEST OTP ───────────────────────────────────────
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setRecoverySuccessMsg('');
    setLoading(true);

    try {
      const res = await fetch(FORGOT_PW_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // Send fingerprint cookie for rate limiting
        body: JSON.stringify({ email: recoveryIdentifier.trim().toLowerCase() })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to process recovery request.');

      setRecoverySuccessMsg("Security code sent! Please check your email.");
      setRecoveryPhase('reset'); 

    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── PHASE 2: SUBMIT OTP & NEW PASSWORD ─────────────────────────
  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch(RESET_PW_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: recoveryIdentifier.trim().toLowerCase(),
          otp: otpCode.trim(),
          newPassword: newPassword
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reset password.');

      alert("Password successfully reset! You can now log in.");
      toggleView(); 
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── UTILS ──────────────────────────────────────────────────────
  const toggleView = () => {
    setIsForgotPasswordView(!isForgotPasswordView);
    setRecoveryPhase('request'); 
    setError('');
    setRecoverySuccessMsg('');
    setUsername('');
    setPassword('');
    setRecoveryIdentifier('');
    setOtpCode('');
    setNewPassword('');
  };

  if (!isOpen) return null;

  return (
    <div className="CM_LOGIN_OVERLAY">
      <div className="CM_LOGIN_CARD">
        <button className="CM_LOGIN_CLOSE" onClick={onClose} aria-label="Close modal">
          <i className="fas fa-times"></i>
        </button>
        
        {!isForgotPasswordView ? (
          <>
            <div className="CM_LOGIN_HEADER">
              <div className="CM_LOGIN_ICON"><i className="fas fa-user-shield"></i></div>
              <h2>Resident Portal</h2>
              <p>Login to request documents and view notifications.</p>
            </div>

            <form onSubmit={handleLogin} className="CM_LOGIN_FORM">
              {error && <div className="CM_ERROR_MSG"><i className="fas fa-exclamation-triangle"></i> {error}</div>}
              
              <div className="CM_INPUT_GROUP">
                <label>Resident ID / Email</label>
                <div className="CM_INPUT_WRAPPER">
                  <i className="fas fa-at"></i>
                  <input type="text" placeholder="username@residents.eng-hill.ph" value={username} onChange={e => setUsername(e.target.value)} required disabled={loading} />
                </div>
              </div>

              <div className="CM_INPUT_GROUP">
                <label>Password</label>
                <div className="CM_INPUT_WRAPPER">
                  <i className="fas fa-lock"></i>
                  <input type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required disabled={loading} />
                </div>
              </div>

              <div className="CM_LOGIN_ACTIONS">
                <button type="button" className="CM_FORGOT_BTN" onClick={toggleView} disabled={loading}>
                  Forgot Password?
                </button>
              </div>

              <button type="submit" className="CM_LOGIN_SUBMIT" disabled={loading}>
                {loading ? <i className="fas fa-circle-notch fa-spin"></i> : 'Enter Dashboard'}
              </button>
            </form>
          </>
        ) : (
          <>
            <div className="CM_LOGIN_HEADER">
              <div className="CM_LOGIN_ICON warning"><i className="fas fa-key"></i></div>
              <h2>Account Recovery</h2>
              <p>Enter your details to regain access.</p>
            </div>

            {recoveryPhase === 'request' ? (
              <form onSubmit={handleForgotPassword} className="CM_LOGIN_FORM">
                {error && <div className="CM_ERROR_MSG"><i className="fas fa-exclamation-triangle"></i> {error}</div>}
                
                <div className="CM_INPUT_GROUP">
                  <label>Registered Account</label>
                  <div className="CM_INPUT_WRAPPER">
                    <i className="fas fa-user-tag"></i>
                    <input type="text" placeholder="Username or Email address" value={recoveryIdentifier} onChange={e => setRecoveryIdentifier(e.target.value)} required disabled={loading} />
                  </div>
                </div>

                <button type="submit" className="CM_LOGIN_SUBMIT warning" disabled={loading}>
                  {loading ? <i className="fas fa-circle-notch fa-spin"></i> : 'Request Security Code'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleResetSubmit} className="CM_LOGIN_FORM">
                {error && <div className="CM_ERROR_MSG"><i className="fas fa-exclamation-triangle"></i> {error}</div>}
                {recoverySuccessMsg && <div className="CM_SUCCESS_MSG"><i className="fas fa-check-circle"></i> {recoverySuccessMsg}</div>}
                
                <div className="CM_INPUT_GROUP">
                  <label>6-Character Security Code</label>
                  <div className="CM_INPUT_WRAPPER">
                    <i className="fas fa-hashtag"></i>
                    <input type="text" placeholder="e.g., aB3X9z" value={otpCode} onChange={e => setOtpCode(e.target.value)} required disabled={loading} maxLength={6} className="CM_OTP_INPUT" />
                  </div>
                </div>

                <div className="CM_INPUT_GROUP">
                  <label>New Password</label>
                  <div className="CM_INPUT_WRAPPER">
                    <i className="fas fa-lock"></i>
                    <input type="password" placeholder="Enter new password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required disabled={loading} minLength={6} />
                  </div>
                </div>

                <button type="submit" className="CM_LOGIN_SUBMIT success" disabled={loading}>
                  {loading ? <i className="fas fa-circle-notch fa-spin"></i> : 'Confirm New Password'}
                </button>
              </form>
            )}

            <div className="CM_LOGIN_FOOTER">
              <button type="button" className="CM_RETURN_BTN" onClick={toggleView} disabled={loading}>
                <i className="fas fa-arrow-left"></i> Return to Login
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
export default CommunityLoginModal;