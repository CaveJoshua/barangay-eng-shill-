import React from 'react';
import { useNavigate } from 'react-router-dom';
import './styles/Login.css';

interface LoginProps {
  onSelectPortal: (target: 'admin' | 'community') => void;
}

/**
 * 🏠 MAIN LOGIN PAGE (Portal Selection)
 *
 * Admin Portal → /officialslogin (admin login page)
 * Community Portal → /community (resident landing/login)
 *
 * After resident logs in via Community, they go to /resident dashboard
 */

const Login: React.FC<LoginProps> = ({ onSelectPortal }) => {
  const navigate = useNavigate();

  // ✅ Admin Portal → Goes to dedicated admin login page
  const handleAdminClick = () => {
    onSelectPortal('admin');
    navigate('/officialslogin');
  };

  // ✅ Community Portal → Goes to resident landing/login first
  // (NOT directly to /resident, that's the dashboard AFTER login)
  const handleCommunityClick = () => {
    onSelectPortal('community');
    navigate('/community');
  };

  return (
    <div className="LG_PAGE_STAGE">
      <div className="LG_HERO_BG">
        <div className="LG_STAIN_GLASS"></div>
      </div>

      <div className="LG_MAIN_WRAPPER">
        <div className="LG_PORTAL_CONTAINER">
          <header className="LG_BRANDING">
            <div className="LG_LOGO_HEX">
              <i className="fas fa-landmark"></i>
            </div>
            <h1 className="LG_HERO_TITLE">
              Barangay <span className="LG_ACCENT">Engineers Hill</span>
            </h1>
            <p className="LG_HERO_SUBTITLE">Smart Barangay System</p>
          </header>

          <div className="LG_PORTAL_GRID">
            {/* Community Portal Card */}
            <div
              className="LG_PORTAL_CARD"
              onClick={handleCommunityClick}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  handleCommunityClick();
                }
              }}
            >
              <div className="LG_CARD_BODY">
                <div className="LG_ICON_HALO LG_GREEN">
                  <i className="fas fa-users"></i>
                </div>
                <div className="LG_CARD_TEXT">
                  <h2>Resident Services</h2>
                  <p>
                    Access public announcements, file incident reports, and
                    request barangay documents.
                  </p>
                </div>
              </div>
              <div className="LG_CARD_FOOTER">
                <span>Enter Public Portal</span>
                <i className="fas fa-chevron-right"></i>
              </div>
            </div>

            {/* Admin Portal Card */}
            <div
              className="LG_PORTAL_CARD"
              onClick={handleAdminClick}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  handleAdminClick();
                }
              }}
            >
              <div className="LG_CARD_BODY">
                <div className="LG_ICON_HALO LG_NAVY">
                  <i className="fas fa-shield-alt"></i>
                </div>
                <div className="LG_CARD_TEXT">
                  <h2>Official Login</h2>
                  <p>
                    Secure administrative access for Barangay Officials and
                    authorized system staff.
                  </p>
                </div>
              </div>
              <div className="LG_CARD_FOOTER">
                <span>Sign In Securely</span>
                <i className="fas fa-lock"></i>
              </div>
            </div>
          </div>

          <footer className="LG_STAGE_FOOTER">
            <p>&copy; SMART BARANGAY SYSTEM</p>
          </footer>
        </div>
      </div>
    </div>
  );
};

export default Login;