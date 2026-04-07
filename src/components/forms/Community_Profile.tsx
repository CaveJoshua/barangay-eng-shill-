import React from 'react';
import './styles/Community_Profile.css';

interface ProfileProps {
  resident: any;
  onClose: () => void;
  onEditPassword: () => void;
}

const Community_Profile: React.FC<ProfileProps> = ({ resident, onClose, onEditPassword }) => {
  if (!resident) return null;

  return (
    <div className="CM_PROFILE_ROOT">
      {/* --- MOBILE-STYLE APP BAR / HEADER --- */}
      <header className="CM_PROFILE_HEADER">
        <button className="CM_BACK_BTN" onClick={onClose}>
          <i className="fas fa-arrow-left"></i>
          <span className="DESKTOP_ONLY">Back to Dashboard</span>
        </button>
        <h2 className="CM_PROFILE_TITLE">Profile</h2>
        <div className="CM_HEADER_SPACER"></div> {/* Empty div to balance flexbox centering */}
      </header>

      {/* --- SCROLLABLE CONTENT AREA --- */}
      <div className="CM_PROFILE_SCROLL_AREA">
        <div className="CM_PROFILE_CONTENT">
          
          {/* --- HERO CARD (App-like top section) --- */}
          <div className="CM_PROFILE_CARD CM_HERO_CARD">
            <div className="CM_AVATAR_LARGE">
              {resident.formattedName?.charAt(0) || 'U'}
            </div>
            <div className="CM_HERO_TEXT">
              <h3>{resident.formattedName}</h3>
              <p className="CM_VERIFIED_BADGE">
                <i className="fas fa-check-circle"></i> Verified Resident
              </p>
            </div>
          </div>

          {/* --- OFFICIAL INFO SECTION --- */}
          <div className="CM_PROFILE_SECTION">
            <h4 className="CM_SECTION_TITLE">Official Information</h4>
            <div className="CM_PROFILE_CARD">
              <div className="CM_DATA_LIST">
                <div className="CM_DATA_ROW">
                  <span className="CM_DATA_LABEL"><i className="fas fa-id-card"></i> Resident ID</span>
                  <span className="CM_DATA_VALUE">{resident.record_id}</span>
                </div>
                <div className="CM_DATA_ROW">
                  <span className="CM_DATA_LABEL"><i className="fas fa-map-marker-alt"></i> Address</span>
                  <span className="CM_DATA_VALUE">{resident.purok || 'Not Specified'}</span>
                </div>
                <div className="CM_DATA_ROW">
                  <span className="CM_DATA_LABEL"><i className="fas fa-phone"></i> Contact</span>
                  <span className="CM_DATA_VALUE">{resident.contact_no || 'N/A'}</span>
                </div>
                <div className="CM_DATA_ROW">
                  <span className="CM_DATA_LABEL"><i className="fas fa-birthday-cake"></i> Birth Date</span>
                  <span className="CM_DATA_VALUE">{resident.birth_date ? new Date(resident.birth_date).toLocaleDateString() : 'N/A'}</span>
                </div>
                <div className="CM_DATA_ROW">
                  <span className="CM_DATA_LABEL"><i className="fas fa-user-friends"></i> Civil Status</span>
                  <span className="CM_DATA_VALUE">{resident.civil_status || 'N/A'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* --- ACCOUNT & SECURITY SECTION --- */}
          <div className="CM_PROFILE_SECTION">
            <h4 className="CM_SECTION_TITLE">Account & Security</h4>
            <div className="CM_PROFILE_CARD">
              <div className="CM_DATA_LIST">
                <div className="CM_DATA_ROW">
                  <span className="CM_DATA_LABEL"><i className="fas fa-user-circle"></i> Username</span>
                  <span className="CM_DATA_VALUE">{resident.username}</span>
                </div>
                <div className="CM_DATA_ROW">
                  <span className="CM_DATA_LABEL"><i className="fas fa-user-shield"></i> Role</span>
                  <span className="CM_DATA_VALUE CM_ROLE_BADGE">RESIDENT</span>
                </div>
              </div>
              
              <div className="CM_ACTION_CONTAINER">
                <button className="CM_ACTION_BTN CM_PWD_BTN" onClick={onEditPassword}>
                  <i className="fas fa-lock"></i> Change Password
                </button>
              </div>
            </div>
          </div>

          {/* --- DISCLAIMER / FOOTER --- */}
          <div className="CM_PROFILE_FOOTER">
            <i className="fas fa-info-circle"></i>
            <p>Synced with official Barangay Records. Visit the hall for updates.</p>
          </div>

        </div>
      </div>
    </div>
  );
};

export default Community_Profile;