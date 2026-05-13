import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { API_BASE_URL } from '../api'; 
import './styles/Profile.css';

// ── 0. GRAPHQL CLIENT (With Token Hunter) ──
const gqlClient = async (query: string, variables: Record<string, any> = {}) => {
  // 🛡️ THE FIX: Hunt for the token everywhere to stop "Unauthorized"
  let token = localStorage.getItem('auth_token') || localStorage.getItem('access_token') || '';
  
  if (!token) {
    const adminSession = localStorage.getItem('admin_session');
    if (adminSession) {
      try { token = JSON.parse(adminSession).token || ''; } catch (e) {}
    }
  }

  const response = await fetch(`${API_BASE_URL}/graphql/profile`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ query, variables })
  });

  if (response.status === 401) throw new Error("Unauthorized: Token missing or expired.");

  const json = await response.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
};

// ── 1. SESSION CACHE SCRAPER ──
const getSessionFallback = () => {
  const sessionStr = localStorage.getItem('admin_session') || localStorage.getItem('user_session') || localStorage.getItem('resident_session');
  let s: any = {};
  if (sessionStr) {
    try { s = JSON.parse(sessionStr); } catch (e) { }
  }

  let fallbackName = s.full_name || s.fullName || s.profile?.full_name || s.profile?.profileName || 'System Administrator';
  const cleanFallback = fallbackName.replace(/[^a-zA-Z0-9 ]/g, '').trim();
  if (cleanFallback.length < 2) fallbackName = 'System Administrator';

  let fallbackUsername = s.username || s.profile?.username || '';

  return {
    id: s.account_id || s.official_id || s.resident_id || s.id || 'unknown_user',
    name: fallbackName,
    email: s.email || s.profile?.email || '', // 🛡️ Zero forced duplication
    username: fallbackUsername,
    role: s.role || s.user_role || s.profile?.role || 'Resident',
    phone: s.contact_number || s.phone || s.profile?.contact_number || '',
    avatar: localStorage.getItem(`avatar_${s.account_id || 'default'}`) || null
  };
};

const Profile: React.FC = () => {
  const fallbackInfo = useMemo(() => getSessionFallback(), []);
  
  const [formData, setFormData] = useState({
    fullName: fallbackInfo.name,
    email: fallbackInfo.email,
    username: fallbackInfo.username,
    role: fallbackInfo.role,
    phone: fallbackInfo.phone
  });
  
  const activeId = fallbackInfo.id;
  const [theme, setTheme] = useState(() => localStorage.getItem(`sb_theme_${activeId}`) || 'light');
  
  const [formErrors, setFormErrors] = useState({ email: '', phone: '' });
  const [loading, setLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState('');

  // 🛡️ AVATAR UPLOAD STATE
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(fallbackInfo.avatar);

  // 🛡️ SECURITY: Password & OTP States
  const [isPassModalOpen, setIsPassModalOpen] = useState(false);
  const [isChangingPass, setIsChangingPass] = useState(false);
  const [passError, setPassError] = useState('');
  const [passData, setPassData] = useState({ current: '', new: '', confirm: '' });
  const [showPass, setShowPass] = useState({ current: false, new: false, confirm: false });
  
  const [otpMode, setOtpMode] = useState(false);
  const [otpStep, setOtpStep] = useState(1); 
  const [otpValue, setOtpValue] = useState('');

  const isFetching = useRef(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // ── 2. AVATAR UPLOAD HANDLER ──
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      setAvatarPreview(base64String);
      localStorage.setItem(`avatar_${activeId}`, base64String);
    };
    reader.readAsDataURL(file);
  };

  // ── 3. GRAPHQL PROFILE FETCH ──
  const fetchProfileData = useCallback(async () => {
    if (isFetching.current) return;
    isFetching.current = true;
    setLoading(true);
    
    try {
      const query = `
        query {
          getProfile {
            id full_name username email contact_number role theme_preference avatar_url
          }
        }
      `;
      const data = await gqlClient(query);
      const profile = data.getProfile;

      if (!profile) return;
      
      let fetchedName = profile.full_name || '';
      const cleanFetchedName = fetchedName.replace(/[^a-zA-Z0-9 ]/g, '').trim();
      if (cleanFetchedName.length < 2) fetchedName = fallbackInfo.name;

      setFormData({
        fullName: fetchedName,
        email:    profile.email || '', 
        username: profile.username || fallbackInfo.username || '',
        role:     profile.role || fallbackInfo.role || 'Resident',
        phone:    profile.contact_number || '',
      });

      if (profile.avatar_url) {
        setAvatarPreview(profile.avatar_url);
        localStorage.setItem(`avatar_${activeId}`, profile.avatar_url);
      }

      setTheme(prevTheme => {
        if (profile.theme_preference && profile.theme_preference !== prevTheme) {
          document.documentElement.setAttribute('data-theme', profile.theme_preference);
          localStorage.setItem(`sb_theme_${activeId}`, profile.theme_preference);
          return profile.theme_preference;
        }
        return prevTheme;
      });
      setError('');
    } catch (err: any) {
      console.warn("GraphQL sync failed. Relying on cache.", err.message);
    } finally {
      setLoading(false); 
      isFetching.current = false;
    }
  }, [activeId, fallbackInfo]); 

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

  // ── 4. GRAPHQL UPDATE PROFILE ──
  const handleSave = async () => {
    if (!validateForm()) return; 
    
    setIsSaving(true);
    try {
      const mutation = `
        mutation Update($fn: String, $first: String, $last: String, $em: String, $ph: String, $avatar: String) {
          updateProfile(full_name: $fn, first_name: $first, last_name: $last, email: $em, contact_number: $ph, phone: $ph, avatar_url: $avatar) {
            id full_name email contact_number avatar_url
          }
        }
      `;
      const variables = {
        fn: formData.fullName,
        first: formData.fullName.split(' ')[0],
        last: formData.fullName.split(' ').slice(1).join(' '),
        em: formData.email,
        ph: formData.phone,
        avatar: avatarPreview
      };

      const data = await gqlClient(mutation, variables);
      const updatedProfile = data.updateProfile;
      
      if (updatedProfile?.id) {
        alert('Profile updated successfully!');
        setIsEditing(false);
        
        // Push the confirmed new data into the session cache
        ['admin_session', 'user_session', 'resident_session'].forEach(key => {
          const sessionStr = localStorage.getItem(key);
          if (sessionStr) {
             const s = JSON.parse(sessionStr);
             if (s.profile) {
               s.profile.full_name = updatedProfile.full_name;
               s.profile.profileName = updatedProfile.full_name;
               s.profile.email = updatedProfile.email;
               s.profile.contact_number = updatedProfile.contact_number;
             }
             s.full_name = updatedProfile.full_name;
             s.profileName = updatedProfile.full_name;
             s.email = updatedProfile.email;
             s.phone = updatedProfile.contact_number;
             localStorage.setItem(key, JSON.stringify(s));
          }
        });
        
        setFormData(prev => ({
          ...prev,
          fullName: updatedProfile.full_name,
          email: updatedProfile.email || '',
          phone: updatedProfile.contact_number || ''
        }));

      } else {
        throw new Error('Update failed or returned null');
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleThemeChange = async (newTheme: 'light' | 'dark') => {
    if (theme === newTheme) return; 
    setTheme(newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem(`sb_theme_${activeId}`, newTheme);

    try {
      const mutation = `mutation UpdateTheme($t: String!) { updateTheme(theme: $t) { success } }`;
      await gqlClient(mutation, { t: newTheme });
    } catch (err) {
      console.error("Failed to sync theme:", err);
    }
  };

  // ── 5. GRAPHQL PASSWORD CHANGE ──
  const submitPasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassError('');

    if (passData.new.length < 8) return setPassError('New password must be at least 8 characters long.');
    if (passData.new !== passData.confirm) return setPassError('New passwords do not match.');
    if (passData.current === passData.new) return setPassError('New password cannot be the same as the current password.');

    setIsChangingPass(true);
    try {
      const mutation = `
        mutation ChangePass($curr: String!, $new: String!) {
          changePassword(currentPassword: $curr, newPassword: $new) { success message }
        }
      `;
      const data = await gqlClient(mutation, { curr: passData.current, new: passData.new });

      if (data.changePassword?.success) {
        alert('Security Update: Password changed successfully.');
        closePassModal();
      } else {
        throw new Error(data.changePassword?.message || 'Failed to update password.');
      }
    } catch (err: any) {
      setPassError(err.message);
    } finally {
      setIsChangingPass(false);
    }
  };

  // ── 6. GRAPHQL OTP RECOVERY FLOW ──
  const startOtpFlow = async () => {
    if (!formData.email) return setPassError('No email linked to this account. Update profile first.');
    setPassError('');
    setIsChangingPass(true);
    try {
      const mutation = `mutation ReqOtp($e: String!) { requestOtp(email: $e) { success message } }`;
      const data = await gqlClient(mutation, { e: formData.email });
      if (data.requestOtp?.success) {
        setOtpMode(true);
        setOtpStep(2);
      } else throw new Error('Failed to send OTP.');
    } catch (err: any) {
      setPassError(err.message);
    } finally {
      setIsChangingPass(false);
    }
  };

  const verifyOtpFlow = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassError('');
    setIsChangingPass(true);
    try {
      const mutation = `mutation VerOtp($e: String!, $o: String!) { verifyOtp(email: $e, otp: $o) { success message } }`;
      const data = await gqlClient(mutation, { e: formData.email, o: otpValue });
      if (data.verifyOtp?.success) setOtpStep(3); 
      else throw new Error('Invalid code.');
    } catch (err: any) {
      setPassError(err.message);
    } finally {
      setIsChangingPass(false);
    }
  };

  const resetPasswordFlow = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassError('');
    if (passData.new.length < 8) return setPassError('New password must be at least 8 characters long.');
    if (passData.new !== passData.confirm) return setPassError('New passwords do not match.');

    setIsChangingPass(true);
    try {
      const mutation = `
        mutation Reset($e: String!, $o: String!, $n: String!) {
          publicReset(email: $e, otp: $o, newPassword: $n) { success message }
        }
      `;
      const data = await gqlClient(mutation, { e: formData.email, o: otpValue, n: passData.new });
      if (data.publicReset?.success) {
        alert('Security Update: Password reset successfully via OTP.');
        closePassModal();
      } else throw new Error('Failed to reset password.');
    } catch (err: any) {
      setPassError(err.message);
    } finally {
      setIsChangingPass(false);
    }
  };

  const closePassModal = () => {
    setIsPassModalOpen(false);
    setPassData({ current: '', new: '', confirm: '' });
    setPassError('');
    setOtpMode(false);
    setOtpStep(1);
    setOtpValue('');
  };

  useEffect(() => {
    fetchProfileData();
  }, [fetchProfileData]);

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

  const getDisplayRole = (roleStr: string) => {
    const cleanRole = String(roleStr || '').toLowerCase().replace(/\s+/g, '');
    const roleMap: Record<string, string> = {
      'superadmin': 'SUPER ADMIN',
      'admin': 'ADMINISTRATOR',
      'barangayhall': 'BARANGAY HALL',
      'punongbarangay': 'PUNONG BARANGAY',
      'barangaysecretary': 'BARANGAY SECRETARY',
      'secretary': 'BARANGAY SECRETARY',
      'barangaytreasurer': 'BARANGAY TREASURER',
      'treasurer': 'BARANGAY TREASURER',
      'barangaykagawad': 'BARANGAY KAGAWAD',
      'kagawad': 'BARANGAY KAGAWAD',
      'skchairperson': 'SK CHAIRPERSON',
      'bhw': 'BARANGAY HEALTH WORKER',
      'barangayhealthworker': 'BARANGAY HEALTH WORKER',
      'resident': 'RESIDENT',
      'staff': 'BARANGAY STAFF'
    };
    return roleMap[cleanRole] || String(roleStr).toUpperCase();
  };

  const displayFullName = formData.fullName || 'System Administrator';
  const avatarLetter = displayFullName.charAt(0).toUpperCase();

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
            {/* 🛡️ AVATAR WITH HIDDEN FILE UPLOAD */}
            <div 
              className="PF_AVATAR_WRAPPER" 
              onClick={() => fileInputRef.current?.click()} 
              style={{ cursor: 'pointer', overflow: 'hidden', position: 'relative' }}
            >
              {avatarPreview ? (
                <img src={avatarPreview} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div className="PF_AVATAR_PLACEHOLDER">{avatarLetter}</div>
              )}
              <div className="PF_AVATAR_OVERLAY">
                <i className="fas fa-camera" style={{ fontSize: '1rem' }} />
              </div>
              <input 
                type="file" 
                accept="image/*" 
                hidden 
                ref={fileInputRef} 
                onChange={handleImageUpload} 
              />
            </div>
            
            <div className="PF_USER_INFO">
              <h2 className="PF_USER_DISPLAY_NAME">
                {displayFullName}
              </h2>
              <span className="PF_USER_DISPLAY_ROLE">
                {getDisplayRole(formData.role)}
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
              <label>System Username</label>
              <input
                value={formData.username || '—'}
                disabled
                readOnly
                className="PF_CLEAN_INPUT PF_DISABLED"
              />
            </div>
            <div className="PF_INPUT_GROUP">
              <label>System Role</label>
              <input
                value={getDisplayRole(formData.role)}
                disabled
                readOnly
                className="PF_CLEAN_INPUT PF_DISABLED"
              />
            </div>
          </div>

          <div className="PF_ACTIONS">
            {isEditing ? (
              <>
                <button className="PF_BTN_CANCEL" onClick={handleCancel} disabled={isSaving}>Discard</button>
                <button className="PF_BTN_SAVE" onClick={handleSave} disabled={isSaving}>
                  {isSaving ? 'Saving…' : 'Save Changes'}
                </button>
              </>
            ) : (
              <button className="PF_BTN_EDIT" onClick={() => setIsEditing(true)} disabled={loading || !!error}>
                Edit Profile
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="PF_SETTING_SECTION">
        <div className="PF_SECTION_LABEL">Security</div>
        <div className="PF_CONTENT_CARD" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: '0 0 4px 0', fontSize: '15px', color: 'var(--text-main)' }}>Account Password</h3>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>Regularly update your password to maintain account security.</p>
          </div>
          <button 
            className="PF_BTN_EDIT" 
            style={{ backgroundColor: 'var(--bg-main)', color: 'var(--text-main)', border: '1px solid var(--border-color)' }}
            onClick={() => setIsPassModalOpen(true)}
          >
            <i className="fas fa-lock" style={{ marginRight: '6px' }}/> Change Password
          </button>
        </div>
      </section>

      <section className="PF_SETTING_SECTION">
        <div className="PF_SECTION_LABEL">Appearance</div>
        <div className="PF_CONTENT_CARD">
          <div className="PF_THEME_GRID">
            <button className={`PF_THEME_VISUAL_BTN ${theme === 'light' ? 'ACTIVE' : ''}`} onClick={() => handleThemeChange('light')}>
              <div className="PF_THEME_PREVIEW">
                <div className="PF_MOCK_WINDOW">
                  <div className="PF_MOCK_SIDEBAR">
                    <div className="PF_MOCK_SIDEBAR_DOT" /><div className="PF_MOCK_SIDEBAR_DOT" /><div className="PF_MOCK_SIDEBAR_DOT" />
                  </div>
                  <div className="PF_MOCK_CONTENT">
                    <div className="PF_MOCK_LINE" /><div className="PF_MOCK_LINE" /><div className="PF_MOCK_LINE" />
                  </div>
                </div>
              </div>
              <span>Light Mode</span>
            </button>

            <button className={`PF_THEME_VISUAL_BTN ${theme === 'dark' ? 'ACTIVE' : ''}`} onClick={() => handleThemeChange('dark')}>
              <div className="PF_THEME_PREVIEW">
                <div className="PF_MOCK_WINDOW DARK_WINDOW">
                  <div className="PF_MOCK_SIDEBAR">
                    <div className="PF_MOCK_SIDEBAR_DOT" /><div className="PF_MOCK_SIDEBAR_DOT" /><div className="PF_MOCK_SIDEBAR_DOT" />
                  </div>
                  <div className="PF_MOCK_CONTENT">
                    <div className="PF_MOCK_LINE" /><div className="PF_MOCK_LINE" /><div className="PF_MOCK_LINE" />
                  </div>
                </div>
              </div>
              <span>Dark Mode</span>
            </button>
          </div>
        </div>
      </section>

      {/* 🛡️ REFACTORED SECURITY MODAL */}
      {isPassModalOpen && (
        <div className="PF_MODAL_OVERLAY" onClick={closePassModal}>
          <div className="PF_MODAL_BOX" onClick={e => e.stopPropagation()}>
            
            <h2 className="PF_MODAL_TITLE">
              {otpMode ? 'Account Recovery' : 'Change Password'}
            </h2>
            <p className="PF_MODAL_DESC">
              {otpMode 
                ? (otpStep === 2 ? `An OTP has been sent to ${formData.email}. Please enter it below.` : 'Enter a new secure password.')
                : 'Enter your current password and a new secure password.'
              }
            </p>
            
            {passError && <div className="PF_MODAL_ERROR">{passError}</div>}

            {/* ── STANDARD PASSWORD CHANGE FORM ── */}
            {!otpMode && (
              <form onSubmit={submitPasswordChange} className="PF_MODAL_FORM">
                <div className="PF_INPUT_GROUP">
                  <div className="PF_MODAL_HEADER_ROW">
                    <label className="PF_MODAL_LABEL">Current Password</label>
                    <button type="button" onClick={startOtpFlow} disabled={isChangingPass} className="PF_MODAL_FORGOT_LINK">
                      Forgot password?
                    </button>
                  </div>
                  <div className="PF_MODAL_INPUT_WRAP">
                    <input 
                      type={showPass.current ? "text" : "password"} 
                      required 
                      value={passData.current} 
                      onChange={(e) => setPassData({...passData, current: e.target.value})} 
                      className="PF_CLEAN_INPUT" 
                    />
                    <button type="button" className="PF_MODAL_EYE_BTN" onClick={() => setShowPass({...showPass, current: !showPass.current})}>
                      <i className={`fas ${showPass.current ? 'fa-eye-slash' : 'fa-eye'}`} />
                    </button>
                  </div>
                </div>

                <div className="PF_INPUT_GROUP">
                  <label className="PF_MODAL_LABEL">New Password</label>
                  <div className="PF_MODAL_INPUT_WRAP">
                    <input 
                      type={showPass.new ? "text" : "password"} 
                      required minLength={8} 
                      value={passData.new} 
                      onChange={(e) => setPassData({...passData, new: e.target.value})} 
                      className="PF_CLEAN_INPUT" 
                    />
                    <button type="button" className="PF_MODAL_EYE_BTN" onClick={() => setShowPass({...showPass, new: !showPass.new})}>
                      <i className={`fas ${showPass.new ? 'fa-eye-slash' : 'fa-eye'}`} />
                    </button>
                  </div>
                </div>

                <div className="PF_INPUT_GROUP">
                  <label className="PF_MODAL_LABEL">Confirm New Password</label>
                  <div className="PF_MODAL_INPUT_WRAP">
                    <input 
                      type={showPass.confirm ? "text" : "password"} 
                      required minLength={8} 
                      value={passData.confirm} 
                      onChange={(e) => setPassData({...passData, confirm: e.target.value})} 
                      className="PF_CLEAN_INPUT" 
                    />
                    <button type="button" className="PF_MODAL_EYE_BTN" onClick={() => setShowPass({...showPass, confirm: !showPass.confirm})}>
                      <i className={`fas ${showPass.confirm ? 'fa-eye-slash' : 'fa-eye'}`} />
                    </button>
                  </div>
                </div>

                <div className="PF_MODAL_ACTIONS_ROW">
                  <button type="button" className="PF_BTN_CANCEL" onClick={closePassModal} disabled={isChangingPass}>Cancel</button>
                  <button type="submit" className="PF_BTN_SAVE" disabled={isChangingPass}>
                    {isChangingPass ? 'Updating...' : 'Update Password'}
                  </button>
                </div>
              </form>
            )}

            {/* ── OTP VERIFICATION FORM ── */}
            {otpMode && otpStep === 2 && (
              <form onSubmit={verifyOtpFlow} className="PF_MODAL_FORM">
                <div className="PF_INPUT_GROUP">
                  <label className="PF_MODAL_LABEL">6-Digit OTP Code</label>
                  <input 
                    type="text" 
                    required 
                    maxLength={6} 
                    placeholder="XXXXXX" 
                    value={otpValue} 
                    onChange={(e) => setOtpValue(e.target.value)} 
                    className="PF_CLEAN_INPUT PF_OTP_INPUT_OVERRIDE" 
                  />
                </div>
                <div className="PF_MODAL_ACTIONS_ROW">
                  <button type="button" className="PF_BTN_CANCEL" onClick={closePassModal} disabled={isChangingPass}>Cancel</button>
                  <button type="submit" className="PF_BTN_SAVE" disabled={isChangingPass}>
                    {isChangingPass ? 'Verifying...' : 'Verify OTP'}
                  </button>
                </div>
              </form>
            )}

            {/* ── OTP PASSWORD RESET FORM ── */}
            {otpMode && otpStep === 3 && (
              <form onSubmit={resetPasswordFlow} className="PF_MODAL_FORM">
                <div className="PF_INPUT_GROUP">
                  <label className="PF_MODAL_LABEL">New Password</label>
                  <div className="PF_MODAL_INPUT_WRAP">
                    <input 
                      type={showPass.new ? "text" : "password"} 
                      required minLength={8} 
                      value={passData.new} 
                      onChange={(e) => setPassData({...passData, new: e.target.value})} 
                      className="PF_CLEAN_INPUT" 
                    />
                    <button type="button" className="PF_MODAL_EYE_BTN" onClick={() => setShowPass({...showPass, new: !showPass.new})}>
                      <i className={`fas ${showPass.new ? 'fa-eye-slash' : 'fa-eye'}`} />
                    </button>
                  </div>
                </div>

                <div className="PF_INPUT_GROUP">
                  <label className="PF_MODAL_LABEL">Confirm New Password</label>
                  <div className="PF_MODAL_INPUT_WRAP">
                    <input 
                      type={showPass.confirm ? "text" : "password"} 
                      required minLength={8} 
                      value={passData.confirm} 
                      onChange={(e) => setPassData({...passData, confirm: e.target.value})} 
                      className="PF_CLEAN_INPUT" 
                    />
                    <button type="button" className="PF_MODAL_EYE_BTN" onClick={() => setShowPass({...showPass, confirm: !showPass.confirm})}>
                      <i className={`fas ${showPass.confirm ? 'fa-eye-slash' : 'fa-eye'}`} />
                    </button>
                  </div>
                </div>

                <div className="PF_MODAL_ACTIONS_ROW">
                  <button type="button" className="PF_BTN_CANCEL" onClick={closePassModal} disabled={isChangingPass}>Cancel</button>
                  <button type="submit" className="PF_BTN_SAVE" disabled={isChangingPass}>
                    {isChangingPass ? 'Saving...' : 'Reset Password'}
                  </button>
                </div>
              </form>
            )}

          </div>
        </div>
      )}

    </div>
  );
};

export default Profile;