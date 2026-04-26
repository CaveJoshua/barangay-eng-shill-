import React, { useState, useMemo, useEffect } from 'react';
import "./C-Styles/Community_Dashboard.css";
import "./C-Styles/Community_Bulletin_view.css"; 
import { useDashboardLogic } from './useDashboardLogic';

// ── SUB-MODULES ──
import Community_blotter from './Community_blotter';
import Community_Document from './Community_Document';
import Community_Profile from './Community_Profile';
import Community_Notification from './Community_Notfication'; 
import CommunityResetPasswordModal from '../../buttons/Community_Resetpassword_modal';

// 🛡️ IMPORT PREVIEW COMPONENTS
import Community_Preview from '../../forms/Community_preview';
import type { NewsItem } from '../../forms/Community_preview';
import { CaptchaModal } from './Captcha_model';

type DashboardView = 'Announcements' | 'Blotter' | 'Documents';

interface DashboardProps {
  onLogout: () => void;
}

const Community_Dashboard: React.FC<DashboardProps> = ({ onLogout }) => {
  const { 
    resident, 
    blotters, 
    documents, 
    newsList, 
    notifications, 
    loading, 
    fetchData, 
    activeTab, 
    setActiveTab 
  } = useDashboardLogic(onLogout);

  const [currentView, setCurrentView] = useState<DashboardView>('Announcements');
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [mustResetPassword, setMustResetPassword] = useState(false);
  const [bulletinCategory, setBulletinCategory] = useState<string>('All');
  
  const [selectedArticle, setSelectedArticle] = useState<NewsItem | null>(null);

  useEffect(() => {
    const savedSession = localStorage.getItem('resident_session');
    if (savedSession) {
      const session = JSON.parse(savedSession);
      if (session.requires_reset === true || session.profile?.is_first_login === true) {
        setMustResetPassword(true);
      }
    }
  }, []); 

  const navigateTo = (view: DashboardView) => {
    setCurrentView(view);
    setIsProfileOpen(false);
  };

  const openProfile = () => {
    if (!mustResetPassword) {
      setIsProfileOpen(true);
    }
  };

  const navDisplayName = resident?.formattedName || 'Resident';
  const navInitial = navDisplayName.charAt(0).toUpperCase();

  const renderMainContent = useMemo(() => {
    if (loading) {
      return (
        <div className="DASH_LOADER">
          <div className="SPINNER" />
          <p>Fetching your dashboard data...</p>
        </div>
      );
    }

    if (isProfileOpen) {
      return (
        <Community_Profile 
          resident={resident} 
          onClose={() => setIsProfileOpen(false)} 
        />
      );
    }

    switch (currentView) {
      case 'Announcements':
        const rawNews = newsList || [];
        const filteredNews = rawNews.filter((news: any) => {
          if (bulletinCategory === 'All') return true;
          return news.category?.toLowerCase() === bulletinCategory.toLowerCase();
        });
        
        return (
          <div className="BULLETIN_CONTAINER">
            <div className="BULLETIN_HEADER_SECTION">
              <div className="BULLETIN_TEXT_GROUP">
                <h3>Community Bulletin</h3>
                <p>Stay updated with the latest news and alerts from Engineer's Hill.</p>
              </div>
              
              {/* 🎯 CLEANED UP: No more inline styles! CSS handles the layout now. */}
              <div className="BULLETIN_FILTER_TABS">
                {['All', 'Public Advisory', 'Health & Safety', 'Senior Citizen', 'Events'].map(cat => (
                  <button
                    key={cat}
                    onClick={() => setBulletinCategory(cat)}
                    className={`BULLETIN_CATEGORY_BTN ${bulletinCategory === cat ? 'ACTIVE' : ''}`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {filteredNews.length === 0 ? (
              <div className="BULLETIN_EMPTY_STATE">
                <i className="fas fa-bullhorn"></i>
                <p>No {bulletinCategory !== 'All' ? bulletinCategory.toLowerCase() : ''} announcements at this time.</p>
              </div>
            ) : (
              <div className="BULLETIN_GRID">
                {filteredNews.map((news: any) => (
                  <div key={news.id} className="NEWS_CARD" data-category={news.category?.toLowerCase()}>
                    <div className="NEWS_IMAGE">
                      {news.image_url ? (
                        <img src={news.image_url} alt="Announcement" />
                      ) : (
                        <div className="NEWS_IMAGE_PLACEHOLDER">
                          <i className="fas fa-newspaper"></i>
                        </div>
                      )}
                      <span className="NEWS_CAT_TAG">{news.category || 'General'}</span>
                    </div>
                    <div className="NEWS_BODY">
                      <span className="NEWS_DATE">
                        <i className="far fa-calendar-alt"></i> {new Date(news.date_posted || news.created_at).toLocaleDateString()}
                      </span>
                      <h4>{news.title}</h4>
                      <p>{news.content}</p>
                      
                      <button 
                        className="BTN_READ_MORE"
                        onClick={() => setSelectedArticle({
                          ...news,
                          created_at: news.created_at || news.date_posted 
                        })}
                      >
                        Read Full Advisory <i className="fas fa-arrow-right" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );

      case 'Blotter':
        return (
          <Community_blotter 
            data={blotters || []} 
            activeTab={activeTab} 
            setActiveTab={setActiveTab} 
            refresh={() => fetchData(resident?.record_id)} 
          />
        );

      case 'Documents':
        return (
          <Community_Document 
            data={documents || []} 
            activeTab={activeTab} 
            setActiveTab={setActiveTab} 
            resident={resident}
            refresh={() => fetchData(resident?.record_id)} 
          />
        );

      default:
        return null;
    }
  }, [currentView, isProfileOpen, loading, resident, blotters, documents, newsList, activeTab, fetchData, setActiveTab, bulletinCategory, mustResetPassword]);

  return (
    <div className="CM_PAGE_WRAPPER">
      
      <CommunityResetPasswordModal 
        isOpen={mustResetPassword}
        resident={resident}
        onSuccess={() => {
          setMustResetPassword(false);
          const savedSession = localStorage.getItem('resident_session');
          if (savedSession) {
            const session = JSON.parse(savedSession);
            session.requires_reset = false;
            if (session.profile) session.profile.is_first_login = false;
            localStorage.setItem('resident_session', JSON.stringify(session));
          }
          fetchData(resident?.record_id);
        }}
      />

      <nav className="CM_NAV_MAIN">
        <div className="CM_NAV_LEFT">
          <i className="fas fa-shield-alt CM_LOGO_SHIELD" />
          <div className="CM_BRAND_INFO">
            <strong>ENGINEER'S HILL</strong>
            <span>BARANGAY PORTAL</span>
          </div>
          
          <div className="VIEW_SWITCHER DESKTOP_ONLY">
            {(['Announcements', 'Blotter', 'Documents'] as DashboardView[]).map((view) => (
              <button 
                key={view}
                className={`CM_FILTER_TAB ${currentView === view && !isProfileOpen ? 'ACTIVE' : ''}`} 
                onClick={() => navigateTo(view)}
                disabled={mustResetPassword}
              >
                {view === 'Announcements' ? 'Bulletin' : view === 'Blotter' ? 'Incident Report' : view}
              </button>
            ))}
          </div>
        </div>

        <div className="CM_NAV_RIGHT">
          {mustResetPassword ? (
            <div className="CM_SECURITY_ALERT">
              <i className="fas fa-exclamation-triangle" />
              <span>SECURITY RESET REQUIRED</span>
            </div>
          ) : (
            <>
              <div className={`CM_ONLINE_BADGE DESKTOP_ONLY ${resident?.record_id ? 'ONLINE' : 'OFFLINE'}`}>
                <div className="CM_DOT" /> 
                {resident?.record_id ? 'CONNECTED' : 'OFFLINE'}
              </div>

              <Community_Notification 
                notifications={notifications}
                blotters={blotters} 
                documents={documents} 
              />
            </>
          )}

          <div 
            className={`CM_USER_DISPLAY_SIMPLE ${isProfileOpen ? 'ACTIVE' : ''}`} 
            onClick={openProfile}
            style={{ cursor: mustResetPassword ? 'not-allowed' : 'pointer' }}
          >
             <div className="AVATAR_CIRCLE_SMALL">
               {navInitial}
             </div>
             <span className="DESKTOP_ONLY">{navDisplayName}</span>
          </div>

          <button className="CM_LOGOUT_WORD_BTN" onClick={onLogout}>
            <i className="fas fa-sign-out-alt" />
            <span>LOGOUT</span>
          </button>
        </div>
      </nav>

      <main className="CM_PAGE_STAGE">
        {renderMainContent}
      </main>

      <nav className="MOBILE_BOTTOM_NAV MOBILE_ONLY">
        <button 
          className={currentView === 'Announcements' && !isProfileOpen ? 'ACTIVE' : ''} 
          onClick={() => navigateTo('Announcements')}
          disabled={mustResetPassword}
        >
          <i className="fas fa-bullhorn" />
          <span>Bulletin</span>
        </button>
        <button 
          className={currentView === 'Blotter' && !isProfileOpen ? 'ACTIVE' : ''} 
          onClick={() => navigateTo('Blotter')}
          disabled={mustResetPassword}
        >
          <i className="fas fa-gavel" />
          <span>Report Incidents</span>
        </button>
        <button 
          className={currentView === 'Documents' && !isProfileOpen ? 'ACTIVE' : ''} 
          onClick={() => navigateTo('Documents')}
          disabled={mustResetPassword}
        >
          <i className="fas fa-file-alt" />
          <span>Request Documents</span>
        </button>
        <button 
          className={isProfileOpen ? 'ACTIVE' : ''} 
          onClick={openProfile}
          disabled={mustResetPassword}
        >
          <i className="fas fa-user-circle" />
          <span>Profile</span>
        </button>
      </nav>

      {selectedArticle && (
        <Community_Preview 
          article={selectedArticle} 
          onBack={() => setSelectedArticle(null)} 
        />
      )}
      <CaptchaModal />

    </div>
  );
};

export default Community_Dashboard;