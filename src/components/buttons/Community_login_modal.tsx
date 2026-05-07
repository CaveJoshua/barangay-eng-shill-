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
  
  // --- ANTI-BRUTE FORCE STATE ---
  const [lockoutRemaining, setLockoutRemaining] = useState<number>(0);

  const LOGIN_URL = `${API_BASE_URL}/residents/login`;
  const FORGOT_PW_URL = `${API_BASE_URL}/accounts/request-otp`; 
  const RESET_PW_URL = `${API_BASE_URL}/accounts/public-reset`; 

  // 🛡️ SECURITY: Generate/Retrieve Device Fingerprint
  const getFingerprint = useCallback(() => {
    let fp = document.cookie.split('; ').find(row => row.startsWith('sb_dev_fp='))?.split('=')[1];
    if (!fp) {
      fp = 'dev_' + Math.random().toString(36).substring(2, 15);
      document.cookie = `sb_dev_fp=${fp}; max-age=86400; path=/`;
    }
    return fp;
  }, []);

  // 🛡️ SECURITY: Live Countdown Timer for Lockouts
  useEffect(() => {
    const checkLockout = () => {
      const savedEnd = localStorage.getItem('sb_sec_lockout');
      if (savedEnd) {
        const endMs = parseInt(savedEnd, 10);
        const now = Date.now();
        if (endMs > now) {
          setLockoutRemaining(Math.ceil((endMs - now) / 1000));
        } else {
          setLockoutRemaining(0);
          localStorage.removeItem('sb_sec_lockout');
        }
      }
    };
    
    checkLockout();
    const interval = setInterval(checkLockout, 1000);
    return () => clearInterval(interval);
  }, []);

  // 🛡️ SECURITY: Helper to trigger UI lockout
  const applyLockout = (seconds: number, message: string) => {
    const endMs = Date.now() + (seconds * 1000);
    localStorage.setItem('sb_sec_lockout', endMs.toString());
    setLockoutRemaining(seconds);
    setError(message);
  };

  // ─── LOGIN HANDLER ──────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lockoutRemaining > 0) return;

    setError('');
    setLoading(true);

    try {
      const res = await fetch(LOGIN_URL, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          username: username.trim().toLowerCase(), 
          password: password.trim(), 
          deviceId: getFingerprint() 
        })
      });

      const data = await res.json();
      
      if (!res.ok) {
        if (res.status === 429) {
          applyLockout(60, "Too many login attempts. Locked out for 60 seconds.");
          return;
        }
        throw new Error(data.error || 'Invalid resident credentials');
      }

      const needsReset = data.requires_reset || data.user?.requires_reset || data.profile?.is_first_login;
      const sessionData = { ...data, requires_reset: needsReset };

      const actualToken = data.token || data.access_token;
      if (actualToken) localStorage.setItem('access_token', actualToken);

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

  // ─── PHASE 1: REQUEST / RESEND OTP ──────────────────────────────
  const handleForgotPassword = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (lockoutRemaining > 0) return;

    setError('');
    setRecoverySuccessMsg('');
    setLoading(true);

    try {
      const res = await fetch(FORGOT_PW_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: recoveryIdentifier.trim().toLowerCase() })
      });

      const data = await res.json();
      
      if (res.status === 429) {
        const waitMatch = data.error?.match(/wait (\d+) seconds/);
        const waitSecs = waitMatch ? parseInt(waitMatch[1], 10) : 60;
        applyLockout(waitSecs, data.error || `Too many requests. Blocked for ${waitSecs}s.`);
        return;
      }
      
      // 🛡️ FIX: If the backend says the account doesn't exist, throw the error to stop the process
      if (!res.ok) {
        throw new Error(data.error || 'Account not found. Please check your details.');
      }

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
    if (lockoutRemaining > 0) return;

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
      
      if (res.status === 429) {
        applyLockout(60, data.error || "Too many failed attempts. Code destroyed.");
        setRecoveryPhase('request'); 
        setOtpCode('');
        return;
      }

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

  const isBlocked = lockoutRemaining > 0 || loading;

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
              {error && (
                <div className="CM_ERROR_MSG">
                  <i className={lockoutRemaining > 0 ? "fas fa-lock" : "fas fa-exclamation-triangle"}></i> 
                  {error}
                </div>
              )}
              
              <div className="CM_INPUT_GROUP">
                <label>Resident ID / Email</label>
                <div className="CM_INPUT_WRAPPER">
                  <i className="fas fa-at"></i>
                  <input type="text" placeholder="username@residents.eng-hill.ph" value={username} onChange={e => setUsername(e.target.value)} required disabled={isBlocked} />
                </div>
              </div>

              <div className="CM_INPUT_GROUP">
                <label>Password</label>
                <div className="CM_INPUT_WRAPPER">
                  <i className="fas fa-lock"></i>
                  <input type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required disabled={isBlocked} />
                </div>
              </div>

              <div className="CM_LOGIN_ACTIONS">
                <button type="button" className="CM_FORGOT_BTN" onClick={toggleView} disabled={isBlocked}>
                  Forgot Password?
                </button>
              </div>

              <button type="submit" className="CM_LOGIN_SUBMIT" disabled={isBlocked}>
                {lockoutRemaining > 0 ? `Locked (${lockoutRemaining}s)` : loading ? <i className="fas fa-circle-notch fa-spin"></i> : 'Enter Dashboard'}
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
                {error && (
                  <div className="CM_ERROR_MSG">
                    <i className={lockoutRemaining > 0 ? "fas fa-lock" : "fas fa-exclamation-triangle"}></i> 
                    {error}
                  </div>
                )}
                
                <div className="CM_INPUT_GROUP">
                  <label>Registered Account</label>
                  <div className="CM_INPUT_WRAPPER">
                    <i className="fas fa-user-tag"></i>
                    <input type="text" placeholder="Username or Email address" value={recoveryIdentifier} onChange={e => setRecoveryIdentifier(e.target.value)} required disabled={isBlocked} />
                  </div>
                </div>

                <button type="submit" className="CM_LOGIN_SUBMIT warning" disabled={isBlocked}>
                  {lockoutRemaining > 0 ? `Please Wait (${lockoutRemaining}s)` : loading ? <i className="fas fa-circle-notch fa-spin"></i> : 'Request Security Code'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleResetSubmit} className="CM_LOGIN_FORM">
                {error && (
                  <div className="CM_ERROR_MSG">
                    <i className={lockoutRemaining > 0 ? "fas fa-lock" : "fas fa-exclamation-triangle"}></i> 
                    {error}
                  </div>
                )}
                {recoverySuccessMsg && !error && <div className="CM_SUCCESS_MSG"><i className="fas fa-check-circle"></i> {recoverySuccessMsg}</div>}
                
                <div className="CM_INPUT_GROUP">
                  <label>6-Character Security Code</label>
                  <div className="CM_INPUT_WRAPPER">
                    <i className="fas fa-hashtag"></i>
                    <input type="text" placeholder="e.g., aB3X9z" value={otpCode} onChange={e => setOtpCode(e.target.value)} required disabled={isBlocked} maxLength={6} className="CM_OTP_INPUT" />
                  </div>
                  
                  <div style={{ textAlign: 'right', marginTop: '8px' }}>
                    <button type="button" className="CM_FORGOT_BTN" onClick={() => handleForgotPassword()} disabled={isBlocked} style={{ fontSize: '0.85rem' }}>
                      Didn't get it? Request a new code.
                    </button>
                  </div>
                </div>

                <div className="CM_INPUT_GROUP">
                  <label>New Password</label>
                  <div className="CM_INPUT_WRAPPER">
                    <i className="fas fa-lock"></i>
                    <input type="password" placeholder="Enter new password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required disabled={isBlocked} minLength={6} />
                  </div>
                </div>

                <button type="submit" className="CM_LOGIN_SUBMIT success" disabled={isBlocked}>
                  {lockoutRemaining > 0 ? `Locked (${lockoutRemaining}s)` : loading ? <i className="fas fa-circle-notch fa-spin"></i> : 'Confirm New Password'}
                </button>
              </form>
            )}

            <div className="CM_LOGIN_FOOTER">
              <button type="button" className="CM_RETURN_BTN" onClick={toggleView} disabled={isBlocked}>
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