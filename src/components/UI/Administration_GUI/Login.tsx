import React, { useState } from 'react';
import Login_modal from '../../buttons/Official_Login_modal'; 
import './styles/Login.css';

interface LoginProps {
  // 🛡️ FIX 1: Allow onSelectPortal to carry the userData payload up to App.tsx
  onSelectPortal: (target: 'admin' | 'community', userData?: any) => void;
}

const Login: React.FC<LoginProps> = ({ onSelectPortal }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  // 🛡️ FIX 2: Accept userData from the modal, and pass it to the portal
  const handleLoginSuccess = (userData: any) => {
    setIsModalOpen(false);
    onSelectPortal('admin', userData);
  };

  return (
    <div className="LG_PAGE_STAGE">
      {/* 1. Cinematic Background & Glass Overlay */}
      <div className="LG_HERO_BG">
        <div className="LG_STAIN_GLASS"></div>
      </div>
      
      {/* 2. Main Content Wrapper (Centered) */}
      <div className="LG_MAIN_WRAPPER">
        <div className="LG_PORTAL_CONTAINER">
          
          {/* Professional Header / Branding */}
          <header className="LG_BRANDING">
            <div className="LG_LOGO_HEX">
              <i className="fas fa-landmark"></i>
            </div>
            <h1 className="LG_HERO_TITLE">
              Barangay <span className="LG_ACCENT">Engineers Hill</span>
            </h1>
            <p className="LG_HERO_SUBTITLE"></p>
          </header>

          {/* Interactive Portal Cards */}
          <div className="LG_PORTAL_GRID">
            
            {/* Community Portal Card */}
            <div className="LG_PORTAL_CARD" onClick={() => onSelectPortal('community')}>
              <div className="LG_CARD_BODY">
                <div className="LG_ICON_HALO LG_GREEN">
                  <i className="fas fa-users"></i>
                </div>
                <div className="LG_CARD_TEXT">
                  <h2>Resident Services</h2>
                  <p>Access public announcements, file incident reports, and request barangay documents.</p>
                </div>
              </div>
              <div className="LG_CARD_FOOTER">
                <span>Enter Public Portal</span>
                <i className="fas fa-chevron-right"></i>
              </div>
            </div>

            {/* Admin Portal Card */}
            <div className="LG_PORTAL_CARD" onClick={() => setIsModalOpen(true)}>
              <div className="LG_CARD_BODY">
                <div className="LG_ICON_HALO LG_NAVY">
                  <i className="fas fa-shield-alt"></i>
                </div>
                <div className="LG_CARD_TEXT">
                  <h2>Official Login</h2>
                  <p>Secure administrative access for Barangay Officials and authorized system staff.</p>
                </div>
              </div>
              <div className="LG_CARD_FOOTER">
                <span>Sign In Securely</span>
                <i className="fas fa-lock"></i>
              </div>
            </div>

          </div>

          {/* System Footer */}
          <footer className="LG_STAGE_FOOTER">
            <p>&copy; SMART BARANGAY SYSTEM </p>
          </footer>
        </div>
      </div>

      {/* Login Modal Overlay */}
      {isModalOpen && (
        <Login_modal 
          onClose={() => setIsModalOpen(false)} 
          // 🛡️ FIX 3: It now correctly catches the payload and fires the updated handler
          onSuccess={handleLoginSuccess} 
        />
      )}
    </div>
  );
};

export default Login;