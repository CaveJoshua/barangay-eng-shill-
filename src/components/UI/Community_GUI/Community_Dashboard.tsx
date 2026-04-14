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

// 🛡️ FIX 1 & 2: Strict casing (lowercase 'p') and strict 'type' import
import Community_Preview from '../../forms/Community_preview';
import type { NewsItem } from '../../forms/Community_preview';

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
    notifications, // 🛡️ THE FIX: Extracting the real notifications here!
    loading, 
    fetchData, 
    activeTab, 
    setActiveTab 
  } = useDashboardLogic(onLogout);

  const [currentView, setCurrentView] = useState<DashboardView>('Announcements');
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [mustResetPassword, setMustResetPassword] = useState(false);
  const [bulletinCategory, setBulletinCategory] = useState<string>('All');
  
  // Tracks the currently selected article for the full preview modal
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
          <p>Loading...</p>
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
              <div>
                <h3>Community Bulletin</h3>
                <p>Stay updated with the latest news from Engineer's Hill.</p>
              </div>
              <div className="BULLETIN_FILTER_TABS" style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
                {['All', 'Event', 'Alert', 'Update'].map(cat => (
                  <button
                    key={cat}
                    onClick={() => setBulletinCategory(cat)}
                    style={{
                      padding: '6px 16px',
                      borderRadius: '20px',
                      border: 'none',
                      fontWeight: 700,
                      fontSize: '1rem',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      backgroundColor: bulletinCategory === cat ? 'var(--c--p--brand-blue)' : 'var(--c--p--bg-switcher)',
                      color: bulletinCategory === cat ? '#fff' : 'var(--c--p--text-secondary)'
                    }}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {filteredNews.length === 0 ? (
              <div className="BULLETIN_EMPTY" style={{ textAlign: 'center', padding: '4rem', color: 'var(--c--p--text-secondary)' }}>
                <i className="fas fa-bullhorn" style={{ fontSize: '3rem', opacity: 0.3, marginBottom: '1rem' }}></i>
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
                        Read Full Advisory
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
            if (session.profile) {
               session.profile.is_first_login = false;
            }
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

              {/* 🛡️ THE FIX: Pass the real notifications array into the component! */}
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

          <button className="CM_LOGOUT_BTN" onClick={onLogout} title="Logout">
            <i className="fas fa-sign-out-alt" />
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
          <span>News</span>
        </button>
        <button 
          className={currentView === 'Blotter' && !isProfileOpen ? 'ACTIVE' : ''} 
          onClick={() => navigateTo('Blotter')}
          disabled={mustResetPassword}
        >
          <i className="fas fa-gavel" />
          <span>Incident Report</span>
        </button>
        <button 
          className={currentView === 'Documents' && !isProfileOpen ? 'ACTIVE' : ''} 
          onClick={() => navigateTo('Documents')}
          disabled={mustResetPassword}
        >
          <i className="fas fa-file-alt" />
          <span>Docs</span>
        </button>
        <button 
          className={isProfileOpen ? 'ACTIVE' : ''} 
          onClick={openProfile}
          disabled={mustResetPassword}
        >
          <i className="fas fa-user-circle" />
          <span>Me</span>
        </button>
      </nav>

      {/* ── FULL ARTICLE PREVIEW MODAL ── */}
      {selectedArticle && (
        <Community_Preview 
          article={selectedArticle} 
          onBack={() => setSelectedArticle(null)} 
        />
      )}

    </div>
  );
};

export default Community_Dashboard;