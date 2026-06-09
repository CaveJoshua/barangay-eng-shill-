import React, { useState, useEffect } from 'react';
import { ThemeManager } from '../ThemeManager';
import './Styles/CommunityProfile.css';

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
      email: 'NOT LINKED',
      mobile: 'NOT LINKED'
  });

  // ── 🛡️ DEEP IDENTITY EXTRACTION ──
  useEffect(() => {
    const sessionStr = localStorage.getItem('resident_session');
    const sessionObj = sessionStr ? JSON.parse(sessionStr) : {};

    const source = { ...sessionObj, ...resident };
    
    const userNode = source.user || {};
    const profileNode = source.profile || {};

    const recordId = source.record_id || profileNode.record_id || userNode.record_id || userNode.account_id || source.account_id || 'N/A';
    
    const email = source.email
               || profileNode.email
               || userNode.email
               || profileNode.gmail
               || profileNode.email_address
               || 'NOT LINKED';

    const mobile = source.contact_number
               || profileNode.contact_number
               || userNode.contact_number
               || source.phone
               || profileNode.phone
               || 'NOT LINKED';

    const username = source.username || userNode.username || profileNode.username || 'user';
    const address = profileNode.purok || profileNode.address || source.address || "ENGINEER'S HILL";

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

    setProfileData({
        recordId,
        email,
        mobile,
        username,
        address,
        displayName,
        initial
    });

    // ── THEME INITIALIZATION ──
    if (recordId !== 'N/A') {
      const saved = ThemeManager.loadResident(recordId);
      setIsDarkMode(saved === 'dark');
      ThemeManager.applyResident(saved);
    }
  }, [resident]);

  // ── TOGGLE HANDLER ──
  const toggleTheme = () => {
    const newTheme: 'light' | 'dark' = !isDarkMode ? 'dark' : 'light';
    setIsDarkMode(!isDarkMode);
    if (profileData.recordId !== 'N/A') {
      ThemeManager.saveResident(profileData.recordId, newTheme);
    } else {
      ThemeManager.applyResident(newTheme);
    }
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
                    <i className="fas fa-mobile-alt"></i> MOBILE NUMBER
                  </span>
                  <span className="C_P_DATA_VALUE">{profileData.mobile}</span>
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
                  <span className="C_P_DATA_VALUE">{profileData.username}</span>
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

      {/* ── 🎯 YOUR EXISTING RESET MODAL (NOW WITH ONCLOSE PROP!) ── */}
      <CommunityResetPasswordModal 
        isOpen={isResetModalOpen}
        resident={resident}
        onSuccess={() => setIsResetModalOpen(false)} 
        onClose={() => setIsResetModalOpen(false)} 
      />

    </div>
  );
};

export default Community_Profile;