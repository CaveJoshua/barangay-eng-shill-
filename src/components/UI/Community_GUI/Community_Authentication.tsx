import { useState, useEffect } from 'react';
import './C-Styles/Community_Authentication.css';
import { ApiService } from '../api';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  resident: any; // Contains email and record_id
}

type AuthStep = 'REQUEST' | 'VERIFY_OTP' | 'NEW_PASSWORD' | 'SUCCESS';

export default function Community_Authentication({ isOpen, onClose, resident }: Props) {
  const [step, setStep] = useState<AuthStep>('REQUEST');
  const [otp, setOtp] = useState('');
  const [passwords, setPasswords] = useState({ new: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setStep('REQUEST');
      setError(null);
      setOtp('');
      setPasswords({ new: '', confirm: '' });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // 1. Send OTP to Gmail
  const handleRequestOTP = async () => {
    setLoading(true);
    setError(null);
    try {
      // Backend triggers Mailer.js to send 6-character code
      const result = await ApiService.requestPasswordResetOTP(resident.email);
      if (result.success) {
        setStep('VERIFY_OTP');
      } else {
        setError(result.message || "Failed to send verification email.");
      }
    } catch (err) {
      setError("Server connection failed.");
    } finally {
      setLoading(false);
    }
  };

  // 2. Verify OTP code
  const handleVerifyOTP = async () => {
    setLoading(true);
    try {
      const result = await ApiService.verifyOTP(resident.email, otp);
      if (result.success) {
        setStep('NEW_PASSWORD');
      } else {
        setError("Invalid or expired OTP code.");
      }
    } catch (err) {
      setError("Verification failed.");
    } finally {
      setLoading(false);
    }
  };

  // 3. Finalize Password Update
  const handleUpdatePassword = async () => {
    if (passwords.new !== passwords.confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (passwords.new.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    try {
      // 🛡️ THE FIX: Pass exactly 3 arguments (Email, OTP, New Password)
      const result = await ApiService.updatePassword(resident.email, otp, passwords.new);
      
      if (result.success) {
        setStep('SUCCESS');
      } else {
        setError(result.message || result.error || "Update failed.");
      }
    } catch (err) {
      setError("System handshake failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="AUTH_MODAL_OVERLAY">
      <div className="AUTH_CARD">
        <button className="AUTH_CLOSE" onClick={onClose}><i className="fas fa-times" /></button>

        <div className="AUTH_BODY">
          {/* STEP 1: INITIAL REQUEST */}
          {step === 'REQUEST' && (
            <div className="AUTH_STEP">
              <i className="fas fa-envelope-open-text AUTH_ICON" />
              <h3>Verify Identity</h3>
              <p>We will send a security code to <strong>{resident.email}</strong> to verify this request.</p>
              {error && <p className="AUTH_ERR">{error}</p>}
              <button className="AUTH_PRIMARY_BTN" onClick={handleRequestOTP} disabled={loading}>
                {loading ? 'SENDING...' : 'SEND VERIFICATION CODE'}
              </button>
            </div>
          )}

          {/* STEP 2: OTP ENTRY */}
          {step === 'VERIFY_OTP' && (
            <div className="AUTH_STEP">
              <i className="fas fa-key AUTH_ICON" />
              <h3>Enter Security Code</h3>
              <p>Type the 6-character code sent to your Gmail.</p>
              <input 
                type="text" 
                maxLength={6} 
                className="AUTH_INPUT OTP_INPUT" 
                placeholder="XXXXXX"
                value={otp}
                // 🛡️ THE FIX: Allow Letters and Numbers (Alphanumeric) instead of just digits
                onChange={(e) => setOtp(e.target.value.replace(/[^A-Za-z0-9]/g, ''))}
              />
              {error && <p className="AUTH_ERR">{error}</p>}
              <button className="AUTH_PRIMARY_BTN" onClick={handleVerifyOTP} disabled={otp.length !== 6 || loading}>
                {loading ? 'VERIFYING...' : 'VERIFY CODE'}
              </button>
              <button className="AUTH_LINK" onClick={handleRequestOTP}>Resend Email</button>
            </div>
          )}

          {/* STEP 3: NEW PASSWORD */}
          {step === 'NEW_PASSWORD' && (
            <div className="AUTH_STEP">
              <i className="fas fa-shield-alt AUTH_ICON" />
              <h3>Set New Password</h3>
              <input 
                type="password" 
                className="AUTH_INPUT" 
                placeholder="NEW PASSWORD" 
                value={passwords.new}
                onChange={(e) => setPasswords({...passwords, new: e.target.value})}
              />
              <input 
                type="password" 
                className="AUTH_INPUT" 
                placeholder="CONFIRM NEW PASSWORD" 
                value={passwords.confirm}
                onChange={(e) => setPasswords({...passwords, confirm: e.target.value})}
              />
              {error && <p className="AUTH_ERR">{error}</p>}
              <button className="AUTH_PRIMARY_BTN" onClick={handleUpdatePassword} disabled={loading}>
                {loading ? 'UPDATING...' : 'UPDATE PASSWORD'}
              </button>
            </div>
          )}

          {/* STEP 4: SUCCESS */}
          {step === 'SUCCESS' && (
            <div className="AUTH_STEP SUCCESS">
              <i className="fas fa-check-circle AUTH_ICON" />
              <h3>Password Updated</h3>
              <p>Your security credentials have been successfully reset.</p>
              <button className="AUTH_PRIMARY_BTN" onClick={onClose}>RETURN TO PROFILE</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}