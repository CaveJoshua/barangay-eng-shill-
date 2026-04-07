import React, { useState, useEffect, useRef } from 'react';
import './styles/Community_Resetpassword_modal.css'; 
import { API_BASE_URL, ApiService } from '../UI/api'; 

interface ResetProps {
  isOpen: boolean;
  resident: any; 
  onSuccess: () => void;
  onClose?: () => void;       
  requireOtp?: boolean;       
}

type ModalStep = 'REQUEST_OTP' | 'VERIFY_OTP' | 'UPDATE_PASSWORD';

const CommunityResetPasswordModal: React.FC<ResetProps> = ({ 
  isOpen, 
  resident, 
  onSuccess, 
  onClose, 
  requireOtp = false 
}) => {
  const [step, setStep] = useState<ModalStep>('UPDATE_PASSWORD');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  // ── SECURITY: Anti-Spam Cooldown ──
  const [countdown, setCountdown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── AGGRESSIVE MEMORY CLEANUP ──
  const resetState = () => {
    setStep(requireOtp ? 'REQUEST_OTP' : 'UPDATE_PASSWORD');
    setOtp('');
    setNewPassword('');
    setConfirmPassword('');
    setError('');
  };

  useEffect(() => {
    if (isOpen) {
      resetState();
    } else {
      // Wipe sensitive data from memory when closed
      setOtp('');
      setNewPassword('');
      setConfirmPassword('');
    }
  }, [isOpen, requireOtp]);

  useEffect(() => {
    if (countdown > 0) {
      timerRef.current = setTimeout(() => setCountdown(countdown - 1), 1000);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [countdown]);

  // ── STEP 1: REQUEST OTP (With Anti-Spam) ──
  const handleRequestOTP = async () => {
    if (countdown > 0) return; 
    
    setLoading(true);
    setError('');
    try {
      const result = await ApiService.requestPasswordResetOTP(resident?.email || '');
      if (result.success) {
        setStep('VERIFY_OTP');
        setCountdown(60); 
      } else {
        setError(result.error || "Failed to dispatch secure token. Try again.");
      }
    } catch (err) {
      setError("Network handshake failed. Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  // ── STEP 2: VERIFY OTP ──
  const handleVerifyOTP = async () => {
    if (otp.length !== 6 || !/^\d+$/.test(otp)) {
      setError("Invalid format. OTP must be strictly 6 digits.");
      return;
    }

    setLoading(true);
    setError('');
    try {
      const result = await ApiService.verifyOTP(resident?.email || '', otp);
      if (result.success) {
        setStep('UPDATE_PASSWORD');
        setOtp(''); 
      } else {
        setError("Invalid or expired authorization code.");
      }
    } catch (err) {
      setError("Verification sequence failed.");
    } finally {
      setLoading(false);
    }
  };

  // ── STEP 3: ZERO-TRUST PASSWORD UPDATE ──
  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Strict Client-Side Complexity Enforcement
    if (!newPassword || !confirmPassword) {
      setError('Please fill in both password fields.');
      return;
    }
    if (newPassword.length < 8) {
      setError('Security violation: Password must be at least 8 characters.');
      return;
    }
    if (!/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setError('Security violation: Password must contain at least one uppercase letter and one number.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Integrity check failed: Passwords do not match.');
      return;
    }
    if (newPassword.includes('123456') || newPassword.toLowerCase().includes('password')) {
      setError('Security violation: Password is too common or easily guessable.');
      return;
    }

    // Secure Identity Extraction
    let accountId = resident?.account_id || resident?.record_id; 
    
    if (!accountId) {
      try {
        const sessionStr = localStorage.getItem('resident_session');
        if (sessionStr) {
          const sessionData = JSON.parse(sessionStr);
          accountId = sessionData.account_id || sessionData.id || sessionData.record_id || sessionData.profile?.record_id;
        }
      } catch (e) {
        // Silent catch
      }
    }

    if (!accountId) {
      setError("Session Identity compromised. Please log out and authenticate again.");
      return;
    }

    setLoading(true);

    try {
      // 🛡️ ZERO TRUST FIX: The browser automatically attaches the HttpOnly cookie because of `credentials: 'include'`.
      const res = await fetch(`${API_BASE_URL}/accounts/reset/${accountId}`, {
        method: 'PATCH',
        credentials: 'include', // Crucial for secure cookies
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': resident?.role || localStorage.getItem('user_role') || 'resident' 
        },
        body: JSON.stringify({ 
          password: newPassword,
          updatedBy: resident?.username || resident?.first_name || 'Resident'
        })
      });

      const data = await res.json();

      if (!res.ok) {
          throw new Error(data.error || 'Server rejected the security update.');
      }

      // Securely flag session as resolved
      const savedSession = localStorage.getItem('resident_session');
      if (savedSession) {
          const session = JSON.parse(savedSession);
          session.requires_reset = false;
          if(session.profile) {
              session.profile.is_first_login = false;
          }
          localStorage.setItem('resident_session', JSON.stringify(session));
      }

      alert("Security cleared: Your account has been securely locked with the new credentials.");
      resetState(); 
      onSuccess();

    } catch (err: any) {
      setError(err.message || "An unexpected security exception occurred.");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="CM_RESET_OVERLAY">
      <div className="CM_RESET_CARD" style={{ position: 'relative' }}>
        
        {/* VOLUNTARY CLOSE BUTTON */}
        {onClose && (
          <button 
            onClick={onClose} 
            className="CM_RESET_CLOSE_BTN"
            style={{ position: 'absolute', top: '15px', right: '20px', background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--cm-text-muted)' }}
            aria-label="Close Security Modal"
          >
            <i className="fas fa-times"></i>
          </button>
        )}

        {/* ── UI: OTP REQUEST ── */}
        {step === 'REQUEST_OTP' && (
          <div className="CM_RESET_HEADER" style={{ textAlign: 'center', paddingTop: '20px' }}>
            <div className="CM_RESET_ICON" style={{ fontSize: '3rem', color: 'var(--cm-primary)', marginBottom: '15px' }}>
              <i className="fas fa-shield-alt"></i>
            </div>
            <h2>Verify Authorization</h2>
            <p style={{ margin: '15px 0' }}>To prevent unauthorized changes, a security code will be dispatched to <strong>{resident?.email || 'your registered email'}</strong>.</p>
            {error && <div className="CM_RESET_ERROR"><i className="fas fa-exclamation-triangle"></i> {error}</div>}
            
            <button className="CM_RESET_SUBMIT" onClick={handleRequestOTP} disabled={loading || countdown > 0} style={{ marginTop: '20px' }}>
              {loading ? (
                <><i className="fas fa-spinner fa-spin"></i> GENERATING TOKEN...</>
              ) : countdown > 0 ? (
                `RETRY AVAILABLE IN ${countdown}s`
              ) : (
                'DISPATCH SECURITY CODE'
              )}
            </button>
          </div>
        )}

        {/* ── UI: OTP VERIFY ── */}
        {step === 'VERIFY_OTP' && (
          <div className="CM_RESET_HEADER" style={{ textAlign: 'center', paddingTop: '20px' }}>
            <div className="CM_RESET_ICON" style={{ fontSize: '3rem', color: 'var(--cm-primary)', marginBottom: '15px' }}>
              <i className="fas fa-fingerprint"></i>
            </div>
            <h2>Input Security Token</h2>
            <p style={{ margin: '15px 0' }}>Please enter the 6-digit authorization code sent to your device.</p>
            
            <input 
              type="text" 
              maxLength={6} 
              autoComplete="one-time-code" 
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} 
              placeholder="••••••"
              style={{ width: '100%', padding: '15px', fontSize: '2rem', textAlign: 'center', letterSpacing: '0.5em', borderRadius: '10px', border: '1px solid var(--cm-border)', marginBottom: '15px', fontFamily: 'monospace' }}
            />
            {error && <div className="CM_RESET_ERROR"><i className="fas fa-exclamation-triangle"></i> {error}</div>}
            
            <button className="CM_RESET_SUBMIT" onClick={handleVerifyOTP} disabled={otp.length !== 6 || loading}>
              {loading ? <><i className="fas fa-spinner fa-spin"></i> AUTHENTICATING...</> : 'AUTHORIZE REQUEST'}
            </button>

            {countdown === 0 && (
              <button 
                onClick={handleRequestOTP} 
                style={{ marginTop: '15px', background: 'none', border: 'none', color: 'var(--cm-primary)', cursor: 'pointer', fontWeight: 'bold' }}
              >
                Resend Code
              </button>
            )}
          </div>
        )}

        {/* ── UI: UPDATE PASSWORD ── */}
        {step === 'UPDATE_PASSWORD' && (
          <>
            <div className="CM_RESET_HEADER">
              <div className="CM_RESET_ICON">
                <i className="fas fa-user-lock"></i>
              </div>
              <h2>Enforce New Protocol</h2>
              <p>
                Hello <strong>{resident?.first_name || 'Resident'}</strong>, establish your new encrypted access key below.
              </p>
            </div>

            <form onSubmit={handleReset} className="CM_RESET_FORM">
              {error && (
                <div className="CM_RESET_ERROR">
                  <i className="fas fa-exclamation-triangle"></i> {error}
                </div>
              )}

              <div className="CM_RESET_INPUT_GROUP">
                <label>New Secure Key</label>
                <div className="CM_RESET_INPUT_WRAPPER">
                  <i className="fas fa-key"></i>
                  <input 
                    type="password" 
                    placeholder="Min 8 chars, 1 uppercase, 1 number"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    disabled={loading}
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <div className="CM_RESET_INPUT_GROUP">
                <label>Confirm Secure Key</label>
                <div className="CM_RESET_INPUT_WRAPPER">
                  <i className="fas fa-check-double"></i>
                  <input 
                    type="password" 
                    placeholder="Repeat encryption key"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    disabled={loading}
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <button type="submit" className="CM_RESET_SUBMIT" disabled={loading}>
                {loading ? (
                    <>
                      <i className="fas fa-spinner fa-spin"></i> ENCRYPTING...
                    </>
                ) : (
                    <>
                      EXECUTE PROTOCOL <i className="fas fa-shield-alt"></i>
                    </>
                )}
              </button>
            </form>

            <div className="CM_RESET_FOOTER">
              <p>Engineer's Hill strict security protocols are active.</p>
            </div>
          </>
        )}

      </div>
    </div>
  );
};

export default CommunityResetPasswordModal;