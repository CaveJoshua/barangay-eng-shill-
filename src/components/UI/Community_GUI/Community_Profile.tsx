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

  // ── 🛡️ IDENTITY EXTRACTION ──
  const displayName = (resident?.formattedName || 'UNKNOWN RESIDENT').toUpperCase();
  
  const initial = displayName !== 'UNKNOWN RESIDENT' 
    ? displayName.charAt(0).toUpperCase() 
    : (resident?.username ? String(resident.username).charAt(0).toUpperCase() : 'U');
  
  const recordId = resident?.record_id || resident?.id || 'N/A';
  const address = (resident?.purok || resident?.address || "ENGINEER'S HILL").toUpperCase();
  const username = (resident?.username || 'user').toUpperCase();
  const email = resident?.email || 'NOT LINKED';

  // ── THEME INITIALIZATION ──
  useEffect(() => {
    if (!recordId || recordId === 'N/A') return;

    const savedTheme = localStorage.getItem(`theme_${recordId}`);
    const rootTheme = document.documentElement.getAttribute('data-resident-theme');
    
    if (savedTheme === 'dark' || rootTheme === 'dark') {
      setIsDarkMode(true);
      document.documentElement.setAttribute('data-resident-theme', 'dark');
    } else {
      setIsDarkMode(false);
      document.documentElement.setAttribute('data-resident-theme', 'light');
    }
  }, [recordId]);

  // ── TOGGLE HANDLER ──
  const toggleTheme = () => {
    const newTheme = !isDarkMode ? 'dark' : 'light';
    document.documentElement.setAttribute('data-resident-theme', newTheme);
    
    if (recordId !== 'N/A') {
      localStorage.setItem(`theme_${recordId}`, newTheme);
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
            <div className="C_P_AVATAR_LARGE">{initial}</div>
            <div className="C_P_HERO_TEXT">
              <h3>{displayName}</h3>
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
                  <span className="C_P_DATA_VALUE">{recordId}</span>
                </div>
                <div className="C_P_DATA_ROW">
                  <span className="C_P_DATA_LABEL">
                    <i className="fas fa-envelope"></i> GMAIL ADDRESS
                  </span>
                  <span className="C_P_DATA_VALUE">{email}</span>
                </div>
                <div className="C_P_DATA_ROW">
                  <span className="C_P_DATA_LABEL">
                    <i className="fas fa-map-marker-alt"></i> ADDRESS
                  </span>
                  <span className="C_P_DATA_VALUE">{address}</span>
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
                  <span className="C_P_DATA_VALUE">@{username}</span>
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