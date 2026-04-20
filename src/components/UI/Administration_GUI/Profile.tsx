import { useState, useEffect, useCallback } from 'react';
import { ApiService, API_BASE_URL } from '../api'; 
import './styles/Profile.css';

const Profile: React.FC = () => {
  // Read initial from local storage as a quick fallback before DB loads
  const [theme, setTheme] = useState(() => localStorage.getItem('sb_theme') || 'light');
  const [formData, setFormData] = useState({ fullName: '', email: '', role: '', phone: '' });
  
  // ✅ Validation State
  const [formErrors, setFormErrors] = useState({ email: '', phone: '' });

  // ✅ Changed initial state to TRUE so it blocks rendering immediately
  const [loading, setLoading]   = useState(true); 
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError]       = useState('');

  const getActiveId = () => localStorage.getItem('profile_id') || localStorage.getItem('account_id');

  // ── 1. INITIALIZE THEME ON MOUNT ──
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // ── 2. FETCH PROFILE & THEME ──
  const fetchProfileData = useCallback(async (signal?: AbortSignal) => {
    const rawId = getActiveId();
    if (!rawId || rawId === 'undefined' || rawId === 'null') {
      setError('Session Error: Please log out and back in.');
      setLoading(false); // Ensure loading stops if there's no ID
      return;
    }
    
    setLoading(true);
    try {
      const data = await ApiService.getProfile(rawId, signal);
      if (data === null) return;
      
      setFormData({
        fullName: data.full_name || data.fullName || 'Anonymous Official',
        email:    data.email || '',
        role:     data.role  || 'Official',
        phone:    data.contact_number || data.phone || '',
      });

      // Sync theme from database if available
      if (data.theme_preference) {
        setTheme(data.theme_preference);
        document.documentElement.setAttribute('data-theme', data.theme_preference);
        localStorage.setItem('sb_theme', data.theme_preference);
      }

      setError('');
    } catch (err: any) {
      if (err.name !== 'AbortError') setError(err.message || 'Cannot reach server.');
    } finally {
      setLoading(false); // Only reveals the page once the fetch is completely finished
    }
  }, []);

  // ── 3. STRICT VALIDATION ENGINE ──
  const validateForm = () => {
    let isValid = true;
    const newErrors = { email: '', phone: '' };

    // Strict Email Format Validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!formData.email || !emailRegex.test(formData.email)) {
      newErrors.email = 'Please provide a valid email format (e.g., example@gmail.com).';
      isValid = false;
    }

    // Strict Phone Format Validation (Exactly 11 digits, starts with 09)
    const phoneRegex = /^09\d{9}$/;
    if (!formData.phone || !phoneRegex.test(formData.phone)) {
      newErrors.phone = 'Phone number must be exactly 11 digits and start with "09".';
      isValid = false;
    }

    setFormErrors(newErrors);
    return isValid;
  };

  // ── 4. SAVE PROFILE DATA ──
  const handleSave = async () => {
    if (!validateForm()) return; // Block save if validation fails

    const targetId = getActiveId();
    if (!targetId) return alert('Session lost. Please log in again.');
    
    setIsSaving(true);
    try {
      const result = await ApiService.updateProfile(targetId, {
        full_name:      formData.fullName,
        email:          formData.email,
        contact_number: formData.phone,
      });
      
      if (result.success) {
        alert('Profile updated successfully!');
        setIsEditing(false);
        fetchProfileData();
      } else {
        throw new Error(result.error);
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // ── 5. TOGGLE & SAVE THEME TO DATABASE ──
  const handleThemeChange = async (newTheme: 'light' | 'dark') => {
    if (theme === newTheme) return; 

    // 1. Instantly update UI
    setTheme(newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('sb_theme', newTheme);

    // 2. Send permanent update to the backend
    try {
      await fetch(`${API_BASE_URL}/accounts/theme`, {
        method: 'PATCH',
        credentials: 'include', 
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ theme: newTheme })
      });
    } catch (err) {
      console.error("Failed to sync official theme to database:", err);
    }
  };

  // ── LIFECYCLE ──
  useEffect(() => {
    const valve = new AbortController();
    fetchProfileData(valve.signal);
    return () => valve.abort();
  }, [fetchProfileData]);

  // ── INPUT HANDLER WITH REAL-TIME TYPING ENFORCEMENT ──
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;

    if (name === 'phone') {
      // Physically block typing anything except numbers, max length 11
      const onlyNumbers = value.replace(/\D/g, '');
      if (onlyNumbers.length <= 11) {
        setFormData({ ...formData, phone: onlyNumbers });
        if (formErrors.phone) setFormErrors({ ...formErrors, phone: '' }); // Clear error while typing
      }
    } else {
      setFormData({ ...formData, [name]: value });
      if (name === 'email' && formErrors.email) setFormErrors({ ...formErrors, email: '' });
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setFormErrors({ email: '', phone: '' });
    fetchProfileData(); // Reset to database values
  };

  // ── 6. THE "FETCH FIRST" GUARDS ──

  // Guard 1: Still fetching initial data
  if (loading && !formData.fullName) {
    return (
      <div className="PF_LOADING_SCREEN">
        <div className="PF_SPINNER"></div>
        <p>Syncing Profile Data...</p>
      </div>
    );
  }

  // Guard 2: Critical failure (like missing ID or server down completely)
  if (error && !formData.fullName) {
    return (
      <div className="PF_CRITICAL_ERROR">
         <h2>System Error</h2>
         <p>{error}</p>
         <button onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  // ── 7. MAIN RENDER ──
  const avatarLetter = (formData.fullName || '?').charAt(0).toUpperCase();

  return (
    <div className="PF_WIDE_CONTAINER">

      {/* ── HEADER ── */}
      <header className="PF_PAGE_HEADER">
        <h1>My Profile</h1>
        <p>Manage your account settings and system preferences.</p>
      </header>

      {/* Soft Error Banner (if error happens AFTER initial load) */}
      {error && (
        <div className="PF_ERROR_BANNER">
          <i className="fas fa-exclamation-triangle" /> {error}
        </div>
      )}

      {/* ── ACCOUNT DETAILS ── */}
      <section className="PF_SETTING_SECTION">
        <div className="PF_SECTION_LABEL">Account Details</div>
        <div className="PF_CONTENT_CARD">

          {/* Avatar + name */}
          <div className="PF_PROFILE_HEADER">
            <div className="PF_AVATAR_WRAPPER">
              <div className="PF_AVATAR_PLACEHOLDER">{avatarLetter}</div>
              <div className="PF_AVATAR_OVERLAY">
                <i className="fas fa-camera" style={{ fontSize: '1rem' }} />
              </div>
            </div>
            <div className="PF_USER_INFO">
              <h2 className="PF_USER_DISPLAY_NAME">
                {formData.fullName || '—'}
              </h2>
              <span className="PF_USER_DISPLAY_ROLE">
                {String(formData.role).toUpperCase()}
              </span>
            </div>
          </div>

          {/* Form fields */}
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
                value={String(formData.role).toUpperCase()}
                disabled
                readOnly
                className="PF_CLEAN_INPUT PF_DISABLED"
              />
            </div>
          </div>

          {/* Actions */}
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

      {/* ── APPEARANCE ── */}
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