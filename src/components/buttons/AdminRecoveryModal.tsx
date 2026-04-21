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
  
  // UI State matching Login Modal
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const handleBack = () => {
    setError('');
    setMessage('');
    if (view === 'OTP_INPUT') setView('EMAIL_INPUT');
    if (view === 'NEW_PASSWORD') setView('OTP_INPUT');
  };

  // 1. Request OTP
  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      const response = await ApiService.requestPasswordResetOTP(email);
      if (!isMounted.current) return;
      
      if (response.success) {
        setView('OTP_INPUT');
        setMessage(response.message || 'If an account exists, a code was sent.');
      } else {
        throw new Error(response.error || 'Failed to send reset code.');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      if (isMounted.current) setLoading(false);
    }
  };

  // 2. Verify OTP
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
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
      setError(err.message);
    } finally {
      if (isMounted.current) setLoading(false);
    }
  };

  // 3. Final Password Reset
  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
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
      setError(err.message);
    } finally {
      if (isMounted.current) setLoading(false);
    }
  };

  return (
    <div className="LM_MODAL_OVERLAY" onClick={onClose}>
      <div className="LM_MODAL_CARD" onClick={(e) => e.stopPropagation()}>
        
        {view !== 'SUCCESS' && view !== 'EMAIL_INPUT' && (
          <button className="LM_BACK_LINK" onClick={handleBack}>
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
              <p>Enter your registered email address.</p>
            </div>
            
            {error && <div className="LM_ERROR_MSG">{error}</div>}
            
            <div className="LM_INPUT_GROUP">
              <label>Email Address</label>
              {/* 👇 THE FIX: Wrapped the input in LM_INPUT_WRAPPER and added the icon */}
              <div className="LM_INPUT_WRAPPER">
                <i className="fas fa-at"></i>
                <input 
                  type="email" 
                  placeholder="official@example.com" 
                  value={email} 
                  onChange={(e) => setEmail(e.target.value)} 
                  disabled={loading}
                  required 
                />
              </div>
            </div>

            <button className="LM_SUBMIT_BTN" disabled={loading}>
              {loading ? <i className="fas fa-spinner fa-spin"></i> : 'Send Reset Link'}
            </button>
            <button type="button" className="LM_FORGOT_LINK" onClick={onClose}>
              Back to Login
            </button>
          </form>
        )}

        {/* --- STEP 2: VERIFY OTP --- */}
        {view === 'OTP_INPUT' && (
          <form className="LM_FORM" onSubmit={handleVerifyOtp}>
            <div className="LM_HEADER">
              <div className="LM_ICON"><i className="fas fa-key"></i></div>
              <h2>Enter Security Code</h2>
              {message ? <p style={{color: '#27ae60'}}>{message}</p> : <p>Check your email for the 6-character code.</p>}
            </div>
            
            {error && <div className="LM_ERROR_MSG">{error}</div>}
            
            <div className="LM_INPUT_GROUP">
              <label style={{ textAlign: 'center' }}>6-Digit Code</label>
              <input 
                type="text" 
                className="LM_OTP_INPUT" 
                placeholder="000000" 
                maxLength={6} 
                value={otp} 
                onChange={(e) => setOtp(e.target.value)} 
                disabled={loading}
                required 
              />
            </div>

            <button className="LM_SUBMIT_BTN" disabled={loading}>
              {loading ? <i className="fas fa-spinner fa-spin"></i> : 'Verify Code'}
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
            
            {error && <div className="LM_ERROR_MSG">{error}</div>}
            
            <div className="LM_INPUT_GROUP">
              <label>New Password</label>
              {/* 👇 THE FIX: Wrapped the input and added the show/hide eye toggle */}
              <div className="LM_INPUT_WRAPPER">
                <i className="fas fa-lock"></i>
                <input 
                  type={showPassword ? "text" : "password"} 
                  placeholder="Minimum 8 characters" 
                  value={newPassword} 
                  onChange={(e) => setNewPassword(e.target.value)} 
                  disabled={loading}
                  required 
                  minLength={8}
                />
                <button type="button" className="LM_EYE_TOGGLE" onClick={() => setShowPassword(!showPassword)}>
                    <i className={showPassword ? "fas fa-eye-slash" : "fas fa-eye"}></i>
                </button>
              </div>
            </div>

            <button className="LM_SUBMIT_BTN" disabled={loading}>
              {loading ? <i className="fas fa-spinner fa-spin"></i> : 'Update Password'}
            </button>
          </form>
        )}

        {/* --- STEP 4: SUCCESS --- */}
        {view === 'SUCCESS' && (
          <div className="LM_SUCCESS_AREA">
            <i className="fas fa-check-circle" style={{fontSize: '3rem', color: '#10b981', margin: '0 auto 1.5rem', display: 'block'}}></i>
            <h2>Password Updated</h2>
            <p style={{ color: '#64748b', marginTop: '10px' }}>Your account has been successfully secured.</p>
            <button className="LM_SUBMIT_BTN" onClick={onClose} style={{marginTop: '30px', width: '100%'}}>
              Return to Login
            </button>
          </div>
        )}

      </div>
    </div>
  );
};

export default AdminRecoveryModal;