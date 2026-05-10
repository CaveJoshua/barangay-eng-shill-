import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ApiService, API_BASE_URL } from '../api'; 
import './styles/Profile.css';

// ── 1. SESSION FALLBACK (Safety Net) ──
const getSessionFallback = () => {
  const sessionStr = localStorage.getItem('admin_session') || localStorage.getItem('user_session') || localStorage.getItem('resident_session');
  let s: any = {};
  if (sessionStr) {
    try { s = JSON.parse(sessionStr); } catch (e) { }
  }

  // Normalize the role to ensure 'barangayhall' is handled cleanly
  let rawRole = s.role || s.user_role || s.profile?.role || localStorage.getItem('user_role') || 'Resident';
  
  return {
    id: s.account_id || s.official_id || s.resident_id || s.id || s.user?.id || localStorage.getItem('account_id') || 'unknown_user',
    name: s.full_name || s.fullName || s.profileName || s.profile?.full_name || s.user?.name || localStorage.getItem('full_name') || '',
    email: s.email || s.profile?.email || s.user?.email || '',
    role: rawRole,
    phone: s.contact_number || s.phone || s.profile?.contact_number || ''
  };
};

const Profile: React.FC = () => {
  const fallbackInfo = useMemo(() => getSessionFallback(), []);
  const activeId = fallbackInfo.id;

  // ── 2. STATE INITIALIZATION ──
  const [theme, setTheme] = useState(() => localStorage.getItem(`sb_theme_${activeId}`) || 'light');
  
  const [formData, setFormData] = useState(() => {
    const cachedStr = localStorage.getItem(`sb_profile_cache_${activeId}`);
    if (cachedStr) {
      const cached = JSON.parse(cachedStr);
      if (cached.fullName && cached.fullName.trim() !== '') return cached;
    }
    return {
      fullName: fallbackInfo.name,
      email: fallbackInfo.email,
      role: fallbackInfo.role,
      phone: fallbackInfo.phone
    };
  });
  
  const [formErrors, setFormErrors] = useState({ email: '', phone: '' });
  const [loading, setLoading]   = useState(false); 
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError]       = useState('');

  // 🛡️ THE FIX: Request Lock to prevent double-firing
  const isFetching = useRef(false);

  // ── 3. APPLY THEME ON MOUNT ──
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // ── 4. FETCH PROFILE (Now loop-proofed) ──
  const fetchProfileData = useCallback(async (signal?: AbortSignal) => {
    if (activeId === 'unknown_user') {
      setError('Session Error: Please log out and back in.');
      return;
    }

    // 🛡️ THE FIX: Block overlapping network requests
    if (isFetching.current) return;
    
    isFetching.current = true;
    setLoading(true);
    
    try {
      const data = await ApiService.getProfile(activeId, signal);
      
      if (!data || Object.keys(data).length === 0) {
        return; 
      }
      
      const syncedData = {
        fullName: data.full_name || fallbackInfo.name || 'Anonymous User',
        email:    data.email || fallbackInfo.email || '',
        role:     data.role || fallbackInfo.role || 'Resident',
        phone:    data.contact_number || data.phone || fallbackInfo.phone || '',
      };

      setFormData(syncedData);
      localStorage.setItem(`sb_profile_cache_${activeId}`, JSON.stringify(syncedData));

      // 🛡️ THE FIX: Functional state update decoupled from the dependency array
      setTheme(prevTheme => {
        if (data.theme_preference && data.theme_preference !== prevTheme) {
          document.documentElement.setAttribute('data-theme', data.theme_preference);
          localStorage.setItem(`sb_theme_${activeId}`, data.theme_preference);
          return data.theme_preference;
        }
        return prevTheme;
      });

      setError('');
    } catch (err: any) {
      if (err.name !== 'AbortError') {
         console.warn("Profile sync failed, using local session.");
      }
    } finally {
      setLoading(false); 
      isFetching.current = false;
    }
  }, [activeId, fallbackInfo]); 

  // ── 5. STRICT VALIDATION ENGINE ──
  const validateForm = () => {
    let isValid = true;
    const newErrors = { email: '', phone: '' };

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (formData.email && !emailRegex.test(formData.email)) {
      newErrors.email = 'Please provide a valid email format.';
      isValid = false;
    }

    const phoneRegex = /^09\d{9}$/;
    if (formData.phone && !phoneRegex.test(formData.phone)) {
      newErrors.phone = 'Phone number must be exactly 11 digits and start with "09".';
      isValid = false;
    }

    setFormErrors(newErrors);
    return isValid;
  };

  // ── 6. SAVE PROFILE DATA ──
  const handleSave = async () => {
    if (!validateForm()) return; 
    if (activeId === 'unknown_user') return alert('Session lost. Please log in again.');
    
    setIsSaving(true);
    try {
      const result = await ApiService.updateProfile(activeId, {
        full_name:      formData.fullName,
        first_name:     formData.fullName.split(' ')[0], 
        last_name:      formData.fullName.split(' ').slice(1).join(' '),
        email:          formData.email,
        contact_number: formData.phone,
        phone:          formData.phone
      });
      
      if (result.success) {
        alert('Profile updated successfully!');
        setIsEditing(false);
        localStorage.setItem(`sb_profile_cache_${activeId}`, JSON.stringify(formData));
        
        // Patch the session data instantly
        const sessionKeys = ['admin_session', 'user_session', 'resident_session'];
        sessionKeys.forEach(key => {
          const sessionStr = localStorage.getItem(key);
          if (sessionStr) {
             const s = JSON.parse(sessionStr);
             if (s.profile) s.profile.full_name = formData.fullName;
             s.full_name = formData.fullName;
             localStorage.setItem(key, JSON.stringify(s));
          }
        });

      } else {
        throw new Error(result.error);
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // ── 7. TOGGLE & SAVE THEME ──
  const handleThemeChange = async (newTheme: 'light' | 'dark') => {
    if (theme === newTheme) return; 

    setTheme(newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem(`sb_theme_${activeId}`, newTheme);

    try {
      await fetch(`${API_BASE_URL}/accounts/theme`, {
        method: 'PATCH',
        credentials: 'include', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: newTheme }) 
      });
    } catch (err) {
      console.error("Failed to sync theme:", err);
    }
  };

  // ── LIFECYCLE ──
  useEffect(() => {
    const valve = new AbortController();
    fetchProfileData(valve.signal);
    return () => valve.abort();
  }, [fetchProfileData]);

  // ── INPUT HANDLER ──
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;

    if (name === 'phone') {
      const onlyNumbers = value.replace(/\D/g, '');
      if (onlyNumbers.length <= 11) {
        setFormData({ ...formData, phone: onlyNumbers });
        if (formErrors.phone) setFormErrors({ ...formErrors, phone: '' }); 
      }
    } else {
      setFormData({ ...formData, [name]: value });
      if (name === 'email' && formErrors.email) setFormErrors({ ...formErrors, email: '' });
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setFormErrors({ email: '', phone: '' });
    fetchProfileData(); 
  };

  // ── 8. HELPER: FORMAT ROLE ──
  const getDisplayRole = (roleStr: string) => {
    const cleanRole = String(roleStr || '').toLowerCase().replace(/\s+/g, '');
    if (cleanRole === 'barangayhall') return 'BARANGAY HALL';
    if (cleanRole === 'punongbarangay') return 'PUNONG BARANGAY';
    if (cleanRole === 'barangaysecretary') return 'BARANGAY SECRETARY';
    return String(roleStr).toUpperCase();
  };

  // ── 9. MAIN RENDER ──
  const avatarLetter = (formData.fullName || fallbackInfo.name || '?').charAt(0).toUpperCase();

  return (
    <div className="PF_WIDE_CONTAINER">

      <header className="PF_PAGE_HEADER">
        <h1>My Profile</h1>
        <p>Manage your account settings and system preferences.</p>
      </header>

      {error && (
        <div className="PF_ERROR_BANNER">
          <i className="fas fa-exclamation-triangle" /> {error}
        </div>
      )}

      <section className="PF_SETTING_SECTION">
        <div className="PF_SECTION_LABEL">Account Details</div>
        <div className="PF_CONTENT_CARD">

          <div className="PF_PROFILE_HEADER">
            <div className="PF_AVATAR_WRAPPER">
              <div className="PF_AVATAR_PLACEHOLDER">{avatarLetter}</div>
              <div className="PF_AVATAR_OVERLAY">
                <i className="fas fa-camera" style={{ fontSize: '1rem' }} />
              </div>
            </div>
            <div className="PF_USER_INFO">
              <h2 className="PF_USER_DISPLAY_NAME">
                {formData.fullName || fallbackInfo.name || '—'}
              </h2>
              <span className="PF_USER_DISPLAY_ROLE">
                {getDisplayRole(formData.role || fallbackInfo.role)}
              </span>
            </div>
          </div>

          <div className="PF_FORM_GRID">
            <div className="PF_INPUT_GROUP">
              <label>Full Name</label>
              <input
                name="fullName"
                value={formData.fullName}
                onChange={handleChange}
                disabled={!isEditing || loading}
                className={`PF_CLEAN_INPUT ${(!isEditing || loading) ? 'PF_DISABLED' : ''}`}
              />
            </div>
            <div className="PF_INPUT_GROUP">
              <label>Email Address</label>
              <input
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                disabled={!isEditing || loading}
                className={`PF_CLEAN_INPUT ${(!isEditing || loading) ? 'PF_DISABLED' : ''} ${formErrors.email ? 'PF_INPUT_ERROR' : ''}`}
                style={formErrors.email ? { borderColor: '#ef4444' } : {}}
              />
              {formErrors.email && <span style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>{formErrors.email}</span>}
            </div>
            <div className="PF_INPUT_GROUP">
              <label>Phone Number</label>
              <input
                name="phone"
                type="tel"
                value={formData.phone}
                onChange={handleChange}
                disabled={!isEditing || loading}
                placeholder="09XXXXXXXXX"
                className={`PF_CLEAN_INPUT ${(!isEditing || loading) ? 'PF_DISABLED' : ''} ${formErrors.phone ? 'PF_INPUT_ERROR' : ''}`}
                style={formErrors.phone ? { borderColor: '#ef4444' } : {}}
              />
              {formErrors.phone && <span style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>{formErrors.phone}</span>}
            </div>
            <div className="PF_INPUT_GROUP">
              <label>System Role</label>
              <input
                value={getDisplayRole(formData.role || fallbackInfo.role)}
                disabled
                readOnly
                className="PF_CLEAN_INPUT PF_DISABLED"
              />
            </div>
          </div>

          <div className="PF_ACTIONS">
            {isEditing ? (
              <>
                <button
                  className="PF_BTN_CANCEL"
                  onClick={handleCancel}
                  disabled={isSaving}
                >Discard</button>
                <button
                  className="PF_BTN_SAVE"
                  onClick={handleSave}
                  disabled={isSaving}
                >{isSaving ? 'Saving…' : 'Save Changes'}</button>
              </>
            ) : (
              <button
                className="PF_BTN_EDIT"
                onClick={() => setIsEditing(true)}
                disabled={loading || !!error}
              >Edit Profile</button>
            )}
          </div>
        </div>
      </section>

      <section className="PF_SETTING_SECTION">
        <div className="PF_SECTION_LABEL">Appearance</div>
        <div className="PF_CONTENT_CARD">
          <div className="PF_THEME_GRID">

            <button
              className={`PF_THEME_VISUAL_BTN ${theme === 'light' ? 'ACTIVE' : ''}`}
              onClick={() => handleThemeChange('light')}
            >
              <div className="PF_THEME_PREVIEW">
                <div className="PF_MOCK_WINDOW">
                  <div className="PF_MOCK_SIDEBAR">
                    <div className="PF_MOCK_SIDEBAR_DOT" />
                    <div className="PF_MOCK_SIDEBAR_DOT" />
                    <div className="PF_MOCK_SIDEBAR_DOT" />
                  </div>
                  <div className="PF_MOCK_CONTENT">
                    <div className="PF_MOCK_LINE" />
                    <div className="PF_MOCK_LINE" />
                    <div className="PF_MOCK_LINE" />
                  </div>
                </div>
              </div>
              <span>Light Mode</span>
            </button>

            <button
              className={`PF_THEME_VISUAL_BTN ${theme === 'dark' ? 'ACTIVE' : ''}`}
              onClick={() => handleThemeChange('dark')}
            >
              <div className="PF_THEME_PREVIEW">
                <div className="PF_MOCK_WINDOW DARK_WINDOW">
                  <div className="PF_MOCK_SIDEBAR">
                    <div className="PF_MOCK_SIDEBAR_DOT" />
                    <div className="PF_MOCK_SIDEBAR_DOT" />
                    <div className="PF_MOCK_SIDEBAR_DOT" />
                  </div>
                  <div className="PF_MOCK_CONTENT">
                    <div className="PF_MOCK_LINE" />
                    <div className="PF_MOCK_LINE" />
                    <div className="PF_MOCK_LINE" />
                  </div>
                </div>
              </div>
              <span>Dark Mode</span>
            </button>

          </div>
        </div>
      </section>

    </div>
  );
};

export default Profile;