import React, { useState, useRef, useEffect } from 'react';
import { ApiService } from '../UI/api'; 
import './styles/Login_modal.css'; 

interface AdminRecoveryModalProps {
  onClose: () => void;
}

type RecoveryView = 'EMAIL_INPUT' | 'OTP_INPUT' | 'NEW_PASSWORD' | 'SUCCESS';

const AdminRecoveryModal: React.FC<AdminRecoveryModalProps> = ({ onClose }) => {
  const [view, setView] = useState<RecoveryView>('EMAIL_INPUT');
  
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  
  // 🛡️ NEW: State to track if the user is using the Master Email fallback
  const [useFallback, setUseFallback] = useState<boolean>(false);

  // UI State matching Login Modal
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // --- ANTI-BRUTE FORCE STATE ---
  const [lockoutRemaining, setLockoutRemaining] = useState<number>(0);

  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  // 🛡️ SECURITY: Live Countdown Timer for Lockouts
  useEffect(() => {
    const checkLockout = () => {
      const savedEnd = localStorage.getItem('admin_sec_lockout');
      if (savedEnd) {
        const endMs = parseInt(savedEnd, 10);
        const now = Date.now();
        if (endMs > now) {
          setLockoutRemaining(Math.ceil((endMs - now) / 1000));
        } else {
          setLockoutRemaining(0);
          localStorage.removeItem('admin_sec_lockout');
        }
      }
    };
    
    checkLockout();
    const interval = setInterval(checkLockout, 1000);
    return () => clearInterval(interval);
  }, []);

  // 🛡️ SECURITY: Helper to trigger UI lockout
  const applyLockout = (seconds: number, msg: string) => {
    const endMs = Date.now() + (seconds * 1000);
    localStorage.setItem('admin_sec_lockout', endMs.toString());
    setLockoutRemaining(seconds);
    setError(msg);
  };

  // 🛡️ SECURITY: Smart Error Handler for Tiered Limiter
  const handleSecurityError = (errMsg: string, defaultWait = 60) => {
    if (errMsg.toLowerCase().includes('too many') || errMsg.toLowerCase().includes('wait') || errMsg.toLowerCase().includes('lockout')) {
      const waitMatch = errMsg.match(/wait (\d+) seconds/i);
      const waitSecs = waitMatch ? parseInt(waitMatch[1], 10) : defaultWait;
      applyLockout(waitSecs, errMsg);
    } else {
      setError(errMsg);
    }
  };

  const handleBack = () => {
    setError('');
    setMessage('');
    if (view === 'OTP_INPUT') setView('EMAIL_INPUT');
    if (view === 'NEW_PASSWORD') setView('OTP_INPUT');
  };

  // 1. Request OTP (Modified to pass fallback choice to backend)
  const handleRequestOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (lockoutRemaining > 0) return;

    setLoading(true);
    setError('');
    setMessage('');

    try {
      // 🛡️ THE FIX: Pass `useFallback` to the API so the backend knows where to route the mail
      const response = await ApiService.requestPasswordResetOTP(email, useFallback);
      if (!isMounted.current) return;
      
      if (response.success) {
        setView('OTP_INPUT');
        setMessage(
          response.message || 
          (useFallback 
            ? 'Emergency code sent to Barangay Hall Master Email.' 
            : 'Security code sent! Please check your email.')
        );
      } else {
        throw new Error(response.error || 'Failed to send reset code.');
      }
    } catch (err: any) {
      if (!isMounted.current) return;
      handleSecurityError(err.message);
    } finally {
      if (isMounted.current) setLoading(false);
    }
  };

  // 2. Verify OTP
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lockoutRemaining > 0) return;

    setLoading(true);
    setError('');

    try {
      const response = await ApiService.verifyOTP(email, otp);
      if (!isMounted.current) return;

      if (response.success) {
        setView('NEW_PASSWORD');
      } else {
        throw new Error(response.error || 'Invalid or expired code.');
      }
    } catch (err: any) {
      if (!isMounted.current) return;
      
      // Handle the specific "3 failed guesses" destroyed code response
      if (err.message.toLowerCase().includes('destroyed') || err.message.toLowerCase().includes('too many failed attempts')) {
        applyLockout(60, err.message || "Too many failed attempts. Code destroyed.");
        setView('EMAIL_INPUT'); 
        setOtp('');
      } else {
        handleSecurityError(err.message);
      }
    } finally {
      if (isMounted.current) setLoading(false);
    }
  };

  // 3. Final Password Reset
  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lockoutRemaining > 0) return;
    
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await ApiService.updatePassword(email, otp, newPassword);
      if (!isMounted.current) return;

      if (response.success) {
        setView('SUCCESS');
      } else {
        throw new Error(response.error || 'Failed to reset password.');
      }
    } catch (err: any) {
      if (!isMounted.current) return;
      handleSecurityError(err.message);
    } finally {
      if (isMounted.current) setLoading(false);
    }
  };

  const isBlocked = lockoutRemaining > 0 || loading;

  return (
    <div className="LM_MODAL_OVERLAY" onClick={onClose}>
      <div className="LM_MODAL_CARD" onClick={(e) => e.stopPropagation()}>
        
        {view !== 'SUCCESS' && view !== 'EMAIL_INPUT' && (
          <button className="LM_BACK_LINK" onClick={handleBack} disabled={isBlocked}>
            <i className="fas fa-chevron-left"></i> Back
          </button>
        )}

        <button className="LM_CLOSE_BTN" onClick={onClose}>
          <i className="fas fa-times"></i>
        </button>

        {/* --- STEP 1: REQUEST OTP --- */}
        {view === 'EMAIL_INPUT' && (
          <form className="LM_FORM" onSubmit={handleRequestOtp}>
            <div className="LM_HEADER">
              <div className="LM_ICON"><i className="fas fa-envelope"></i></div>
              <h2>Account Recovery</h2>
              <p>Enter your registered username or email.</p>
            </div>
            
            {error && (
              <div className="LM_ERROR_MSG">
                <i className={`fas ${lockoutRemaining > 0 ? "fa-lock" : "fa-exclamation-triangle"}`}></i> 
                {error}
              </div>
            )}
            
            <div className="LM_INPUT_GROUP">
              <label>Account Identifier</label> 
              <div className="LM_INPUT_WRAPPER">
                <i className="fas fa-at"></i>
                <input 
                  type="text" 
                  placeholder="Username or Registered Email" 
                  value={email} 
                  onChange={(e) => setEmail(e.target.value)} 
                  disabled={isBlocked}
                  required 
                />
              </div>
            </div>

            {/* 🛡️ NEW: Recovery Method Selection */}
            <div className="LM_INPUT_GROUP" style={{ marginTop: '1rem' }}>
              <label style={{ marginBottom: '8px', display: 'block', fontSize: '0.85rem', color: '#64748b' }}>
                Where should we send the verification code?
              </label>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem' }}>
                  <input 
                    type="radio" 
                    name="recoveryMode" 
                    checked={!useFallback} 
                    onChange={() => setUseFallback(false)}
                    disabled={isBlocked}
                    style={{ accentColor: '#3b82f6', width: '16px', height: '16px' }}
                  />
                  <span>My Registered Email Address</span>
                </label>
                
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem' }}>
                  <input 
                    type="radio" 
                    name="recoveryMode" 
                    checked={useFallback} 
                    onChange={() => setUseFallback(true)}
                    disabled={isBlocked}
                    style={{ accentColor: '#d97706', width: '16px', height: '16px' }}
                  />
                  <span style={{ color: useFallback ? '#b45309' : 'inherit', fontWeight: useFallback ? '600' : 'normal' }}>
                    Barangay Hall Master Email <small style={{ fontWeight: 'normal', color: '#94a3b8' }}>(Lost Access)</small>
                  </span>
                </label>
              </div>
            </div>

            <button className="LM_SUBMIT_BTN" disabled={isBlocked} style={useFallback ? { backgroundColor: '#d97706', color: 'white' } : {}}>
              {lockoutRemaining > 0 
                ? `Please Wait (${lockoutRemaining}s)` 
                : loading 
                  ? <i className="fas fa-spinner fa-spin"></i> 
                  : useFallback ? 'Request Master Code' : 'Send Reset Link'
              }
            </button>
            <button type="button" className="LM_FORGOT_LINK" onClick={onClose} disabled={isBlocked}>
              Back to Login
            </button>
          </form>
        )}

        {/* --- STEP 2: VERIFY OTP --- */}
        {view === 'OTP_INPUT' && (
          <form className="LM_FORM" onSubmit={handleVerifyOtp}>
            <div className="LM_HEADER">
              <div className="LM_ICON" style={useFallback ? { color: '#d97706', backgroundColor: '#fef3c7' } : {}}><i className="fas fa-key"></i></div>
              <h2>Enter Security Code</h2>
              {message && !error ? (
                <p className="LM_SUCCESS_MSG_TEXT">{message}</p>
              ) : (
                <p>
                  {useFallback 
                    ? "Contact the Super Admin for the code sent to the Master account." 
                    : "Check your email for the 6-character code."}
                </p>
              )}
            </div>
            
            {error && (
              <div className="LM_ERROR_MSG">
                <i className={`fas ${lockoutRemaining > 0 ? "fa-lock" : "fa-exclamation-triangle"}`}></i> 
                {error}
              </div>
            )}
            
            <div className="LM_INPUT_GROUP">
              <label className="LM_OTP_LABEL">6-Character Code</label>
              <input 
                type="text" 
                className="LM_OTP_INPUT" 
                placeholder="000000" 
                maxLength={6} 
                value={otp} 
                onChange={(e) => setOtp(e.target.value)} 
                disabled={isBlocked}
                style={useFallback ? { borderColor: '#d97706', color: '#b45309' } : {}}
                required 
              />

              <div className="LM_RESEND_WRAPPER">
                <button 
                  type="button" 
                  className="LM_RESEND_BTN"
                  onClick={() => handleRequestOtp()} 
                  disabled={isBlocked} 
                >
                  Didn't get it? Request a new code.
                </button>
              </div>
            </div>

            <button className="LM_SUBMIT_BTN" disabled={isBlocked} style={useFallback ? { backgroundColor: '#d97706', color: 'white' } : {}}>
              {lockoutRemaining > 0 ? `Locked (${lockoutRemaining}s)` : loading ? <i className="fas fa-spinner fa-spin"></i> : 'Verify Code'}
            </button>
          </form>
        )}

        {/* --- STEP 3: NEW PASSWORD --- */}
        {view === 'NEW_PASSWORD' && (
          <form className="LM_FORM" onSubmit={handleUpdatePassword}>
            <div className="LM_HEADER">
              <div className="LM_ICON"><i className="fas fa-lock"></i></div>
              <h2>Set New Password</h2>
              <p>Create a strong password for your account.</p>
            </div>
            
            {error && (
              <div className="LM_ERROR_MSG">
                <i className={`fas ${lockoutRemaining > 0 ? "fa-lock" : "fa-exclamation-triangle"}`}></i> 
                {error}
              </div>
            )}
            
            <div className="LM_INPUT_GROUP">
              <label>New Password</label>
              <div className="LM_INPUT_WRAPPER">
                <i className="fas fa-lock"></i>
                <input 
                  type={showPassword ? "text" : "password"} 
                  placeholder="Minimum 8 characters" 
                  value={newPassword} 
                  onChange={(e) => setNewPassword(e.target.value)} 
                  disabled={isBlocked}
                  required 
                  minLength={8}
                />
                <button type="button" className="LM_EYE_TOGGLE" onClick={() => setShowPassword(!showPassword)} disabled={isBlocked}>
                    <i className={showPassword ? "fas fa-eye-slash" : "fas fa-eye"}></i>
                </button>
              </div>
            </div>

            <button className="LM_SUBMIT_BTN" disabled={isBlocked}>
              {lockoutRemaining > 0 ? `Locked (${lockoutRemaining}s)` : loading ? <i className="fas fa-spinner fa-spin"></i> : 'Update Password'}
            </button>
          </form>
        )}

        {/* --- STEP 4: SUCCESS --- */}
        {view === 'SUCCESS' && (
          <div className="LM_SUCCESS_AREA">
            <i className="fas fa-check-circle LM_SUCCESS_ICON"></i>
            <h2>Password Updated</h2>
            <p className="LM_SUCCESS_DESC">Your account has been successfully secured.</p>
            <button className="LM_SUBMIT_BTN LM_SUCCESS_RETURN_BTN" onClick={onClose}>
              Return to Login
            </button>
          </div>
        )}

      </div>
    </div>
  );
};

export default AdminRecoveryModal;