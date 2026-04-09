import React, { useState, useEffect, useRef } from 'react';
import { LOGIN_API } from '../UI/api'; 
import './styles/Login_modal.css';

// --- ENDPOINT CONSTANTS ---
const ROOT_REQUEST_API = '/api/auth/root-request'; 
const ROOT_USERNAME = 'SYSTEM_ROOT_ADMIN';

interface LoginModalProps {
  onClose: () => void;
  onSuccess: (token: string) => void;
}

type ModalView =
  | 'LOGIN'
  | 'ROOT_OTP' 
  | 'RECOVER_SELECT'
  | 'RECOVER_EMAIL'
  | 'RECOVER_PHONE'
  | 'RECOVER_OTP'
  | 'RECOVER_SUCCESS';

const Login_modal: React.FC<LoginModalProps> = ({ onClose, onSuccess }) => {
  const [view, setView] = useState<ModalView>('LOGIN');

  // --- DATA INPUTS ---
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
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
    else if (view === 'RECOVER_SELECT') setView('LOGIN');
    else if (view === 'RECOVER_EMAIL' || view === 'RECOVER_PHONE') setView('RECOVER_SELECT');
    else if (view === 'RECOVER_OTP') setView('RECOVER_PHONE');
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

        // 🛡️ THE RBAC FIX: Prioritize specific database role from profile
        localStorage.setItem('admin_session', JSON.stringify({
            username: data.username,
            role: data.profile?.role || data.role, 
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

  // ==========================================
  // 🛠️ RECOVERY HANDLERS
  // ==========================================
  const handleEmailRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      if (isMounted.current) { setView('RECOVER_SUCCESS'); setLoading(false); }
    }, 1000);
  };

  const startPhoneRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      if (isMounted.current) { setView('RECOVER_OTP'); setLoading(false); }
    }, 1000);
  };

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      if (isMounted.current) { setView('RECOVER_SUCCESS'); setLoading(false); }
    }, 1000);
  };

  return (
    <div className="LM_MODAL_OVERLAY" onClick={onClose}>
      <div className={`LM_MODAL_CARD ${username === ROOT_USERNAME ? 'ROOT_BORDER' : ''}`} onClick={(e) => e.stopPropagation()}>
        
        {view !== 'LOGIN' && view !== 'RECOVER_SUCCESS' && (
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
                    placeholder="Username"
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

              <button type="button" className="LM_FORGOT_LINK" onClick={() => setView('RECOVER_SELECT')}>
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

        {/* --- VIEW: RECOVER SELECT --- */}
        {view === 'RECOVER_SELECT' && (
          <>
            <div className="LM_HEADER">
              <div className="LM_ICON"><i className="fas fa-key"></i></div>
              <h2>Recovery</h2>
              <p>Select verification method</p>
            </div>
            <div className="LM_RECOVERY_OPTIONS">
              <button className="LM_RECOVERY_BTN" onClick={() => setView('RECOVER_EMAIL')}>
                <i className="fas fa-envelope"></i><span>Email</span>
              </button>
              <button className="LM_RECOVERY_BTN" onClick={() => setView('RECOVER_PHONE')}>
                <i className="fas fa-mobile-alt"></i><span>Phone</span>
              </button>
            </div>
          </>
        )}

        {/* --- VIEW: RECOVER EMAIL --- */}
        {view === 'RECOVER_EMAIL' && (
          <form className="LM_FORM" onSubmit={handleEmailRecovery}>
            <div className="LM_HEADER"><h2>Email Recovery</h2></div>
            <div className="LM_INPUT_GROUP">
              <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <button className="LM_SUBMIT_BTN" disabled={loading}>Send Reset Link</button>
          </form>
        )}

        {/* --- VIEW: RECOVER PHONE --- */}
        {view === 'RECOVER_PHONE' && (
          <form className="LM_FORM" onSubmit={startPhoneRecovery}>
            <div className="LM_HEADER"><h2>Phone Recovery</h2></div>
            <div className="LM_INPUT_GROUP">
              <input type="tel" placeholder="09XXXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} required />
            </div>
            <button className="LM_SUBMIT_BTN" disabled={loading}>Send OTP</button>
          </form>
        )}

        {/* --- VIEW: RECOVER OTP (For Phone) --- */}
        {view === 'RECOVER_OTP' && (
          <form className="LM_FORM" onSubmit={verifyOtp}>
            <div className="LM_HEADER"><h2>Enter OTP</h2></div>
            <input type="text" className="LM_OTP_INPUT" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value)} required />
            <button className="LM_SUBMIT_BTN" disabled={loading}>Verify</button>
          </form>
        )}

        {/* --- VIEW: RECOVER SUCCESS --- */}
        {view === 'RECOVER_SUCCESS' && (
          <div className="LM_SUCCESS_AREA">
            <i className="fas fa-check-circle"></i>
            <h2>Verified</h2>
            <p>Identity confirmed. Please sign in.</p>
            <button className="LM_SUBMIT_BTN" onClick={() => setView('LOGIN')}>Return</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Login_modal;