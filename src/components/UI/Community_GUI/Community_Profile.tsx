import React, { useState, useEffect } from 'react';
import './C-Styles/Community_Profile.css';

// ── 🎯 Using your existing modal ──
import CommunityResetPasswordModal from '../../buttons/Community_Resetpassword_modal';

interface ProfileProps {
  resident: any;
  onClose: () => void;
}

const Community_Profile: React.FC<ProfileProps> = ({ resident, onClose }) => {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false); 
  const [profileData, setProfileData] = useState<any>({
      displayName: 'LOADING...',
      initial: 'U',
      recordId: 'N/A',
      address: "ENGINEER'S HILL",
      username: 'user',
      email: 'NOT LINKED'
  });

  // ── 🛡️ DEEP IDENTITY EXTRACTION ──
  useEffect(() => {
    // 1. Get backup data directly from local storage just in case the prop is stale
    const sessionStr = localStorage.getItem('resident_session');
    const sessionObj = sessionStr ? JSON.parse(sessionStr) : {};

    // 2. Merge everything together
    const source = { ...sessionObj, ...resident };
    
    // 3. Dig into the nested objects (Backend usually separates 'user' and 'profile')
    const userNode = source.user || {};
    const profileNode = source.profile || {};

    // 4. Extract with fallbacks
    const recordId = profileNode.record_id || userNode.record_id || userNode.account_id || source.account_id || 'N/A';
    const email = profileNode.email || userNode.email || source.email || 'NOT LINKED';
    const username = userNode.username || source.username || 'user';
    const address = profileNode.purok || profileNode.address || source.address || "ENGINEER'S HILL";

    // 5. Safely construct the display name
    const fName = profileNode.first_name || userNode.first_name || '';
    const lName = profileNode.last_name || userNode.last_name || '';
    
    let fullName = source.formattedName;
    if (!fullName && (fName || lName)) {
        fullName = `${fName} ${lName}`.trim();
    }

    const displayName = (fullName || 'UNKNOWN RESIDENT').toUpperCase();
    const initial = fullName 
        ? fullName.charAt(0).toUpperCase() 
        : (username ? String(username).charAt(0).toUpperCase() : 'U');

    // 6. Save to state so React renders it
    setProfileData({
        recordId,
        email,
        username,
        address,
        displayName,
        initial
    });

    // ── THEME INITIALIZATION ──
    if (recordId !== 'N/A') {
      const savedTheme = localStorage.getItem(`theme_${recordId}`);
      const rootTheme = document.documentElement.getAttribute('data-resident-theme');
      
      if (savedTheme === 'dark' || rootTheme === 'dark') {
        setIsDarkMode(true);
        document.documentElement.setAttribute('data-resident-theme', 'dark');
      } else {
        setIsDarkMode(false);
        document.documentElement.setAttribute('data-resident-theme', 'light');
      }
    }
  }, [resident]);

  // ── TOGGLE HANDLER ──
  const toggleTheme = () => {
    const newTheme = !isDarkMode ? 'dark' : 'light';
    document.documentElement.setAttribute('data-resident-theme', newTheme);
    
    if (profileData.recordId !== 'N/A') {
      localStorage.setItem(`theme_${profileData.recordId}`, newTheme);
    }
    
    setIsDarkMode(!isDarkMode);
  };

  if (!resident) return null;

  return (
    <div className="C_P_PROFILE_ROOT">
      <header className="C_P_PROFILE_HEADER">
        <button className="C_P_BACK_BTN" onClick={onClose}>
          <i className="fas fa-arrow-left"></i>
          <span className="DESKTOP_ONLY">BACK TO DASHBOARD</span>
        </button>
        <h2 className="C_P_PROFILE_TITLE">PROFILE</h2>
        <div className="C_P_HEADER_SPACER"></div>
      </header>

      <div className="C_P_PROFILE_SCROLL_AREA">
        <div className="C_P_PROFILE_CONTENT">
          
          <div className="C_P_PROFILE_CARD C_P_HERO_CARD">
            <div className="C_P_AVATAR_LARGE">{profileData.initial}</div>
            <div className="C_P_HERO_TEXT">
              <h3>{profileData.displayName}</h3>
              <p className="C_P_VERIFIED_BADGE">
                <i className="fas fa-check-circle"></i> VERIFIED RESIDENT
              </p>
            </div>
          </div>

          <div className="C_P_PROFILE_SECTION">
            <h4 className="C_P_SECTION_TITLE">OFFICIAL INFORMATION</h4>
            <div className="C_P_PROFILE_CARD">
              <div className="C_P_DATA_LIST">
                <div className="C_P_DATA_ROW">
                  <span className="C_P_DATA_LABEL">
                    <i className="fas fa-id-card"></i> RESIDENT ID
                  </span>
                  <span className="C_P_DATA_VALUE">{profileData.recordId}</span>
                </div>
                <div className="C_P_DATA_ROW">
                  <span className="C_P_DATA_LABEL">
                    <i className="fas fa-envelope"></i> GMAIL ADDRESS
                  </span>
                  <span className="C_P_DATA_VALUE">{profileData.email}</span>
                </div>
                <div className="C_P_DATA_ROW">
                  <span className="C_P_DATA_LABEL">
                    <i className="fas fa-map-marker-alt"></i> ADDRESS
                  </span>
                  <span className="C_P_DATA_VALUE">{profileData.address}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="C_P_PROFILE_SECTION">
            <h4 className="C_P_SECTION_TITLE">ACCOUNT & SETTINGS</h4>
            <div className="C_P_PROFILE_CARD">
              <div className="C_P_DATA_LIST">
                <div className="C_P_DATA_ROW">
                  <span className="C_P_DATA_LABEL">
                    <i className="fas fa-user-circle"></i> USERNAME
                  </span>
                  <span className="C_P_DATA_VALUE">@{profileData.username}</span>
                </div>

                <div className="C_P_DATA_ROW">
                  <span className="C_P_DATA_LABEL">
                    <i className={`fas ${isDarkMode ? 'fa-moon' : 'fa-sun'}`}></i> APPEARANCE
                  </span>
                  <div className="C_P_THEME_TOGGLE" onClick={toggleTheme}>
                    <div className={`TOGGLE_SLIDER ${isDarkMode ? 'DARK' : ''}`}>
                      <div className="TOGGLE_KNOB" />
                    </div>
                    <span className="C_P_DATA_VALUE">
                      {isDarkMode ? 'DARK MODE' : 'LIGHT MODE'}
                    </span>
                  </div>
                </div>
              </div>
              
              <div className="C_P_ACTION_CONTAINER">
                <button className="C_P_ACTION_BTN C_P_PWD_BTN" onClick={() => setIsResetModalOpen(true)}>
                  <i className="fas fa-lock"></i> CHANGE PASSWORD
                </button>
              </div>
            </div>
          </div>

          <div className="C_P_PROFILE_FOOTER">
            <i className="fas fa-info-circle"></i>
            <p>YOUR DATA IS SYNCED WITH THE OFFICIAL BARANGAY RECORDS OF ENGINEER'S HILL.</p>
          </div>

        </div>
      </div>

      {/* ── 🎯 YOUR EXISTING RESET MODAL ── */}
      <CommunityResetPasswordModal 
        isOpen={isResetModalOpen}
        resident={resident}
        onSuccess={() => setIsResetModalOpen(false)} 
      />

    </div>
  );
};

export default Community_Profile;