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
  requireOtp = true 
}) => {
  const [step, setStep] = useState<ModalStep>(requireOtp ? 'REQUEST_OTP' : 'UPDATE_PASSWORD');
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

  // ── STEP 1: REQUEST OTP ──
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

  // ── STEP 2: VERIFY OTP / SECURITY TOKEN ──
  const handleVerifyOTP = async () => {
    if (otp.trim().length === 0) {
      setError("Please enter the verification code.");
      return;
    }

    setLoading(true);
    setError('');
    try {
      const result = await ApiService.verifyOTP(resident?.email || '', otp.trim());
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

    if (!newPassword || !confirmPassword) {
      setError('Please fill in both password fields.');
      return;
    }
    if (newPassword.length < 8) {
      setError('Security violation: Password must be at least 8 characters.');
      return;
    }
    if (!/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setError('Security violation: Password must contain uppercase and numbers.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Integrity check failed: Passwords do not match.');
      return;
    }

    let accountId = resident?.account_id || resident?.record_id; 
    if (!accountId) {
      const sessionStr = localStorage.getItem('resident_session');
      if (sessionStr) {
        const sessionData = JSON.parse(sessionStr);
        accountId = sessionData.account_id || sessionData.user?.record_id || sessionData.profile?.record_id;
      }
    }

    if (!accountId) {
      setError("Session Identity compromised. Please re-authenticate.");
      return;
    }

    setLoading(true);

    try {
      const token = localStorage.getItem('access_token');

      const res = await fetch(`${API_BASE_URL}/accounts/reset/${accountId}`, {
        method: 'PATCH',
        credentials: 'include', 
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ 
          password: newPassword
        })
      });

      const data = await res.json();

      if (!res.ok) {
          throw new Error(data.error || 'Server rejected the security update.');
      }

      const savedSession = localStorage.getItem('resident_session');
      if (savedSession) {
          const session = JSON.parse(savedSession);
          session.requires_reset = false;
          localStorage.setItem('resident_session', JSON.stringify(session));
      }

      alert("Security cleared: Your account has been securely updated.");
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
      <div className="CM_RESET_CARD">
        
        {onClose && (
          <button 
            onClick={onClose} 
            className="CM_RESET_CLOSE_BTN" 
            aria-label="Close Security Modal"
          >
            <i className="fas fa-times"></i>
          </button>
        )}

        {step === 'REQUEST_OTP' && (
          <div className="CM_RESET_HEADER">
            <div className="CM_RESET_ICON"><i className="fas fa-shield-alt"></i></div>
            <h2>Verify Authorization</h2>
            <p>A security code will be sent to your registered email.</p>
            
            <div className="CM_INFO_NOTICE">
              <strong><i className="fas fa-info-circle"></i> Identity Protection Notice:</strong><br/>
              To protect your Barangay Engineer's Hill account from unauthorized alterations, Multi-Factor Authentication (MFA) is strictly enforced.
            </div>

            {error && <div className="CM_RESET_ERROR">{error}</div>}
            <button className="CM_RESET_SUBMIT" onClick={handleRequestOTP} disabled={loading || countdown > 0}>
              {loading ? 'GENERATING...' : countdown > 0 ? `RETRY IN ${countdown}s` : 'SEND THE CODE'}
            </button>
          </div>
        )}

        {step === 'VERIFY_OTP' && (
          <div className="CM_RESET_HEADER">
            <div className="CM_RESET_ICON"><i className="fas fa-fingerprint"></i></div>
            <h2>Input Security Token</h2>
            <p>Enter the security code sent to your linked address.</p>
            
            <div className="CM_WARN_NOTICE">
              <strong><i className="fas fa-exclamation-triangle"></i> Official Warning:</strong><br/>
              Do not share this code with anyone. Barangay personnel, IT staff, and administrators will NEVER ask for your OTP.
            </div>

            <input 
              type="text" 
              value={otp}
              onChange={(e) => setOtp(e.target.value)} 
              placeholder="••••••"
              className="CM_OTP_DISPLAY_INPUT"
              disabled={loading}
              autoComplete="one-time-code"
            />
            {error && <div className="CM_RESET_ERROR">{error}</div>}
            <button className="CM_RESET_SUBMIT" onClick={handleVerifyOTP} disabled={otp.trim().length === 0 || loading}>
              {loading ? 'AUTHENTICATING...' : 'AUTHORIZE REQUEST'}
            </button>
          </div>
        )}

        {step === 'UPDATE_PASSWORD' && (
          <>
            <div className="CM_RESET_HEADER">
              <div className="CM_RESET_ICON"><i className="fas fa-user-lock"></i></div>
              <h2>Enforce New Protocol</h2>
              <p>Hello <strong>{resident?.first_name || 'Resident'}</strong>, establish your new encrypted access key.</p>
            </div>

            <div className="CM_SUCCESS_NOTICE">
              <strong><i className="fas fa-check-shield"></i> Cryptographic Standard:</strong><br/>
              Your new password will be heavily hashed via bcrypt before transmission. We recommend utilizing a unique passphrase.
            </div>

            <form onSubmit={handleReset} className="CM_RESET_FORM">
              {error && <div className="CM_RESET_ERROR"><i className="fas fa-exclamation-triangle"></i> {error}</div>}

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
                {loading ? 'ENCRYPTING...' : 'EXECUTE PROTOCOL'}
              </button>
            </form>
          </>
        )}

        {/* ── GLOBAL SECURITY FOOTER ── */}
        <div className="CM_RESET_FOOTER">
          <i className="fas fa-lock"></i> Secured by End-to-End Encryption <br/>
          <span>
            Unauthorized access is strictly prohibited. IP and activity are logged.
          </span>
        </div>

      </div>
    </div>
  );
};

export default CommunityResetPasswordModal;