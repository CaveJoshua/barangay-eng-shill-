import React, { useState, useEffect, useRef } from 'react';
import { LOGIN_API } from '../UI/api'; 
import AdminRecoveryModal from './AdminRecoveryModal'; // We will create this next
import './styles/Login_modal.css';

// --- ENDPOINT CONSTANTS ---
const ROOT_REQUEST_API = '/api/auth/root-request'; 
const ROOT_USERNAME = 'SYSTEM_ROOT_ADMIN';

interface LoginModalProps {
  onClose: () => void;
  onSuccess: (token: string) => void;
}

type ModalView = 'LOGIN' | 'ROOT_OTP';

const Login_modal: React.FC<LoginModalProps> = ({ onClose, onSuccess }) => {
  const [view, setView] = useState<ModalView>('LOGIN');
  const [showRecoveryModal, setShowRecoveryModal] = useState(false);

  // --- DATA INPUTS ---
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [traceId, setTraceId] = useState(''); 

  // UI State
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [isLocked, setIsLocked] = useState(false);

  const isMounted = useRef(true);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (controllerRef.current) controllerRef.current.abort();
    };
  }, []);

  const handleBack = () => {
    setError('');
    if (view === 'ROOT_OTP') setView('LOGIN');
  };

  // ==========================================
  // 🛡️ ACTION: GHOST HANDSHAKE (ROOT REQUEST)
  // ==========================================
  const handleRootHandshake = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(ROOT_REQUEST_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: ROOT_USERNAME })
      });
      const data = await response.json();

      if (response.ok) {
        setTraceId(data.trace_id);
        setView('ROOT_OTP'); 
      } else {
        throw new Error(data.error || 'Security handshake failed.');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ==========================================
  // 🔑 ACTION: SIGN IN (Standard & Root Verify)
  // ==========================================
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (username.trim() === ROOT_USERNAME && view === 'LOGIN') {
      handleRootHandshake();
      return;
    }

    if (isLocked) {
      setError('Security Lock active. Please wait 30 seconds.');
      return;
    }

    setLoading(true);
    controllerRef.current = new AbortController();

    try {
      const payload = view === 'ROOT_OTP' 
        ? { username: ROOT_USERNAME, otp, trace_id: traceId } 
        : { username, password };

      const response = await fetch(LOGIN_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', 
        body: JSON.stringify(payload),
        signal: controllerRef.current.signal
      });

      const data = await response.json();
      if (!isMounted.current) return;

      if (response.ok) {
        // Save Core IDs
        localStorage.setItem('account_id', data.account_id);
        localStorage.setItem('profile_id', data.profile?.record_id || data.account_id);
        
        if (view === 'ROOT_OTP') {
            sessionStorage.setItem('trace_id', traceId);
        }

        // 🛡️ THE RBAC FIX: Aggressively hunt for the role name
        const resolvedRole = (data.user_role || data.role || data.profile?.role || data.profile?.user_role || '').toLowerCase();

        // 1. Set the standalone key for quick route guards
        localStorage.setItem('user_role', resolvedRole);

        // 2. Set the detailed session object
        localStorage.setItem('admin_session', JSON.stringify({
            username: data.username,
            role: resolvedRole, 
            profile: data.profile
        }));

        onSuccess("ZERO_TRUST_COOKIE_SET"); 
      } else {
        throw new Error(data.message || data.error || 'Invalid Credentials');
      }
    } catch (err: any) {
      if (!isMounted.current || err.name === 'AbortError') return;
      handleFailure(err.message);
    } finally {
      if (isMounted.current) setLoading(false);
    }
  };

  const handleFailure = (msg: string) => {
    const newAttempts = attempts + 1;
    setAttempts(newAttempts);
    setPassword('');
    setError(msg);

    if (newAttempts >= 5) {
      setIsLocked(true);
      setTimeout(() => {
        if (isMounted.current) { setIsLocked(false); setAttempts(0); setError(''); }
      }, 30000);
    }
  };

  // If the user clicks "Forgot Password", we render the new component instead.
  if (showRecoveryModal) {
    return <AdminRecoveryModal onClose={() => setShowRecoveryModal(false)} />;
  }

  return (
    <div className="LM_MODAL_OVERLAY" onClick={onClose}>
      <div className={`LM_MODAL_CARD ${username === ROOT_USERNAME ? 'ROOT_BORDER' : ''}`} onClick={(e) => e.stopPropagation()}>
        
        {view !== 'LOGIN' && (
          <button className="LM_BACK_LINK" onClick={handleBack}>
            <i className="fas fa-chevron-left"></i> Back
          </button>
        )}

        <button className="LM_CLOSE_BTN" onClick={onClose}>
          <i className="fas fa-times"></i>
        </button>

        {/* --- VIEW: LOGIN --- */}
        {view === 'LOGIN' && (
          <>
            <div className="LM_HEADER">
              <div className="LM_ICON"><i className="fas fa-user-shield"></i></div>
              <h2>Official Access</h2>
              <p>Enter your administrative credentials</p>
            </div>

            <form className="LM_FORM" onSubmit={handleSignIn}>
              {error && <div className="LM_ERROR_MSG">{error}</div>}
              <div className="LM_INPUT_GROUP">
                <label>Username</label>
                <div className="LM_INPUT_WRAPPER">
                  <i className="fas fa-user"></i>
                  <input
                    type="text"
                    placeholder="Username@role.officials.eng-hill.brg.ph"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={loading || isLocked}
                  />
                </div>
              </div>

              {username !== ROOT_USERNAME && (
                <div className="LM_INPUT_GROUP">
                    <label>Password</label>
                    <div className="LM_INPUT_WRAPPER">
                    <i className="fas fa-lock"></i>
                    <input
                        type={showPassword ? "text" : "password"}
                        placeholder="Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={loading || isLocked}
                    />
                    <button type="button" className="LM_EYE_TOGGLE" onClick={() => setShowPassword(!showPassword)}>
                        <i className={showPassword ? "fas fa-eye-slash" : "fas fa-eye"}></i>
                    </button>
                    </div>
                </div>
              )}

              <button type="submit" className={`LM_SUBMIT_BTN ${username === ROOT_USERNAME ? 'ROOT_BTN' : ''}`} disabled={loading || isLocked}>
                {loading ? <i className="fas fa-spinner fa-spin"></i> : 
                 username === ROOT_USERNAME ? 'Request Security Code' : 'Authenticate'}
              </button>

              <button type="button" className="LM_FORGOT_LINK" onClick={() => setShowRecoveryModal(true)}>
                Forgot password?
              </button>
            </form>
          </>
        )}

        {/* --- VIEW: GHOST ADMIN OTP --- */}
        {view === 'ROOT_OTP' && (
          <form className="LM_FORM" onSubmit={handleSignIn}>
            <div className="LM_HEADER">
              <div className="LM_ICON ROOT_ICON"><i className="fas fa-shield-alt"></i></div>
              <h2>Root Verification</h2>
              <p>A code was sent to the official Gmail.</p>
              <span className="LM_TRACE_DISPLAY">TRACE ID: {traceId}</span>
            </div>
            {error && <div className="LM_ERROR_MSG">{error}</div>}
            <div className="LM_INPUT_GROUP">
                <input 
                    type="text" 
                    className="LM_OTP_INPUT" 
                    placeholder="000000"
                    maxLength={6} 
                    value={otp} 
                    onChange={(e) => setOtp(e.target.value.toUpperCase())} 
                    required 
                />
            </div>
            <button className="LM_SUBMIT_BTN ROOT_BTN" disabled={loading}>
                {loading ? <i className="fas fa-spinner fa-spin"></i> : 'Verify & Override'}
            </button>
          </form>
        )}

      </div>
    </div>
  );
};

export default Login_modal;