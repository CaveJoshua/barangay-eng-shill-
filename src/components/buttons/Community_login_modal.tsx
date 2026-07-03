import React, { useState, useEffect, useCallback } from 'react';
import './styles/Community_login_modal.css';
import { API_BASE_URL } from '../UI/api';
import { ThemeManager } from '../UI/ThemeManager';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (data: any) => void; 
}

export const CommunityLoginModal: React.FC<LoginModalProps> = ({ isOpen, onClose, onLoginSuccess }) => {
  // --- View State ---
  const [isForgotPasswordView, setIsForgotPasswordView] = useState(false);
  const [recoveryPhase, setRecoveryPhase] = useState<'request' | 'reset'>('request');

  // --- Account Verification State (confirm ownership BEFORE first use) ---
  const [isVerifyView, setIsVerifyView] = useState(false);
  const [verifyPhase, setVerifyPhase] = useState<'request' | 'confirm' | 'done'>('request');
  const [verifyIdentifier, setVerifyIdentifier] = useState('');
  const [verifyChannel, setVerifyChannel] = useState<'email' | 'sms'>('email');
  const [verifyOtp, setVerifyOtp] = useState('');

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

      const recordId = data.profile?.record_id || data.user?.record_id;
      const theme = (data.theme_preference as 'light' | 'dark') || 'light';
      if (recordId) ThemeManager.saveResident(String(recordId), theme);
      else ThemeManager.applyResident(theme);

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

  // ─── ACCOUNT VERIFICATION (ownership check BEFORE first use) ────
  // The resident chooses WHERE to receive the code: their Gmail or their
  // phone number. Both hit the same public endpoint with a channel flag.
  const handleVerifyRequest = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (lockoutRemaining > 0) return;

    setError('');
    setRecoverySuccessMsg('');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/residents/verify/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ identifier: verifyIdentifier.trim(), channel: verifyChannel })
      });
      const data = await res.json();

      if (res.status === 429) {
        applyLockout(60, data.error || 'Please wait before requesting another code.');
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Could not send the verification code.');

      setRecoverySuccessMsg(
        verifyChannel === 'email'
          ? 'If the account exists, a 6-digit code was sent to its email address.'
          : 'If the account exists, a 6-digit code was texted to its phone number.'
      );
      setVerifyPhase('confirm');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lockoutRemaining > 0) return;

    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/residents/verify/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ identifier: verifyIdentifier.trim(), otp: verifyOtp.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Verification failed.');

      setVerifyPhase('done');
      setRecoverySuccessMsg('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── UTILS ──────────────────────────────────────────────────────
  const resetSharedState = () => {
    setError('');
    setRecoverySuccessMsg('');
    setUsername('');
    setPassword('');
    setRecoveryIdentifier('');
    setOtpCode('');
    setNewPassword('');
    setVerifyPhase('request');
    setVerifyIdentifier('');
    setVerifyChannel('email');
    setVerifyOtp('');
  };

  const toggleView = () => {
    setIsForgotPasswordView(!isForgotPasswordView);
    setIsVerifyView(false);
    setRecoveryPhase('request');
    resetSharedState();
  };

  const openVerifyView = (open: boolean) => {
    setIsVerifyView(open);
    setIsForgotPasswordView(false);
    setRecoveryPhase('request');
    resetSharedState();
  };

  if (!isOpen) return null;

  const isBlocked = lockoutRemaining > 0 || loading;

  return (
    <div className="CM_LOGIN_OVERLAY">
      <div className="CM_LOGIN_CARD">
        <button className="CM_LOGIN_CLOSE" onClick={onClose} aria-label="Close modal">
          <i className="fas fa-times"></i>
        </button>
        
        {isVerifyView ? (
          <>
            <div className="CM_LOGIN_HEADER">
              <div className="CM_LOGIN_ICON"><i className="fas fa-user-check"></i></div>
              <h2>Verify Your Account</h2>
              <p>Confirm you own this account before using it. Choose where to receive your code.</p>
            </div>

            {verifyPhase === 'request' && (
              <form onSubmit={handleVerifyRequest} className="CM_LOGIN_FORM">
                {error && (
                  <div className="CM_ERROR_MSG">
                    <i className={lockoutRemaining > 0 ? 'fas fa-lock' : 'fas fa-exclamation-triangle'}></i> {error}
                  </div>
                )}

                <div className="CM_INPUT_GROUP">
                  <label>Username, Email, or Phone Number</label>
                  <div className="CM_INPUT_WRAPPER">
                    <i className="fas fa-user-tag"></i>
                    <input type="text" placeholder="Any of the three works" value={verifyIdentifier} onChange={e => setVerifyIdentifier(e.target.value)} required disabled={isBlocked} />
                  </div>
                </div>

                <div className="CM_INPUT_GROUP">
                  <label>Send my code via</label>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    {([
                      { key: 'email', icon: 'fa-envelope', label: 'Gmail / Email' },
                      { key: 'sms', icon: 'fa-mobile-alt', label: 'Text (SMS)' },
                    ] as const).map(opt => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setVerifyChannel(opt.key)}
                        disabled={isBlocked}
                        style={{
                          flex: 1, padding: '12px 8px', borderRadius: 10, cursor: 'pointer',
                          fontWeight: 700, fontSize: '0.85rem',
                          border: verifyChannel === opt.key ? '2px solid #3b82f6' : '1px solid #cbd5e1',
                          background: verifyChannel === opt.key ? 'rgba(59,130,246,0.08)' : 'transparent',
                          color: verifyChannel === opt.key ? '#2563eb' : 'inherit',
                        }}
                      >
                        <i className={`fas ${opt.icon}`} style={{ marginRight: 6 }}></i>{opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <button type="submit" className="CM_LOGIN_SUBMIT" disabled={isBlocked}>
                  {lockoutRemaining > 0 ? `Please Wait (${lockoutRemaining}s)` : loading ? <i className="fas fa-circle-notch fa-spin"></i> : 'Send Verification Code'}
                </button>
              </form>
            )}

            {verifyPhase === 'confirm' && (
              <form onSubmit={handleVerifyConfirm} className="CM_LOGIN_FORM">
                {error && (
                  <div className="CM_ERROR_MSG">
                    <i className="fas fa-exclamation-triangle"></i> {error}
                  </div>
                )}
                {recoverySuccessMsg && !error && <div className="CM_SUCCESS_MSG"><i className="fas fa-check-circle"></i> {recoverySuccessMsg}</div>}

                <div className="CM_INPUT_GROUP">
                  <label>6-Digit Code</label>
                  <div className="CM_INPUT_WRAPPER">
                    <i className="fas fa-hashtag"></i>
                    <input type="text" inputMode="numeric" placeholder="e.g., 482913" value={verifyOtp} onChange={e => setVerifyOtp(e.target.value.replace(/\D/g, ''))} required disabled={isBlocked} maxLength={6} className="CM_OTP_INPUT" />
                  </div>
                  <div style={{ textAlign: 'right', marginTop: '8px' }}>
                    <button type="button" className="CM_FORGOT_BTN" onClick={() => handleVerifyRequest()} disabled={isBlocked} style={{ fontSize: '0.85rem' }}>
                      Didn't get it? Send a new code.
                    </button>
                  </div>
                </div>

                <button type="submit" className="CM_LOGIN_SUBMIT success" disabled={isBlocked || verifyOtp.length !== 6}>
                  {loading ? <i className="fas fa-circle-notch fa-spin"></i> : 'Confirm Account'}
                </button>
              </form>
            )}

            {verifyPhase === 'done' && (
              <div className="CM_LOGIN_FORM">
                <div className="CM_SUCCESS_MSG" style={{ textAlign: 'center' }}>
                  <i className="fas fa-check-circle"></i> Account ownership confirmed! You can now log in.
                </div>
                <button type="button" className="CM_LOGIN_SUBMIT success" onClick={() => openVerifyView(false)}>
                  Proceed to Login
                </button>
              </div>
            )}

            <div className="CM_LOGIN_FOOTER">
              <button type="button" className="CM_RETURN_BTN" onClick={() => openVerifyView(false)} disabled={isBlocked}>
                <i className="fas fa-arrow-left"></i> Return to Login
              </button>
            </div>
          </>
        ) : !isForgotPasswordView ? (
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

              <div className="CM_LOGIN_ACTIONS" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <button type="button" className="CM_FORGOT_BTN" onClick={() => openVerifyView(true)} disabled={isBlocked}>
                  New account? Verify it first
                </button>
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