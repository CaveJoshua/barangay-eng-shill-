import React, { useState, useMemo, useEffect } from 'react';
import "./Styles/CommunityDashboard.css";
import "./Styles/CommunityIncident.css";
import "./Styles/CommunityBulletinview.css";
import { useDashboardLogic } from './useDashboardLogic';


// ── SUB-MODULES ──
import Community_blotter from './CommunityIncident';
import Community_Document from './CommunityDocument';
import Community_Profile from './CommunityProfile';
import Community_Notification, { type CommunityNotifView } from './CommunityNotfication';
import Community_Notification_History from './CommunityNotificationHistory';
import CommunityResetPasswordModal from '../../buttons/Community_Resetpassword_modal';

// 🛡️ IMPORT PREVIEW COMPONENTS
import Community_Preview from '../../forms/Community_preview';
import type { NewsItem } from '../../forms/Community_preview';
import { CaptchaModal } from '../../Captcha/CaptchaModal';

type DashboardView = 'Announcements' | 'Blotter' | 'Documents' | 'Notifications';

interface DashboardProps {
  onLogout: () => void;
}

// 🔄 Persist the open view across page reloads (session-scoped: survives F5,
// cleared on logout/tab-close). Keeps a resident on Documents/Incident/etc.
// exactly where they were after refreshing.
const VIEW_STORAGE_KEY = 'cm_active_view';
const VALID_VIEWS: DashboardView[] = ['Announcements', 'Blotter', 'Documents', 'Notifications'];

const loadSavedView = (): DashboardView => {
  const saved = sessionStorage.getItem(VIEW_STORAGE_KEY) as DashboardView | null;
  return saved && VALID_VIEWS.includes(saved) ? saved : 'Announcements';
};

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

  const [currentView, setCurrentView] = useState<DashboardView>(loadSavedView);
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  // Mirror the active view into session storage so a reload restores it.
  useEffect(() => {
    sessionStorage.setItem(VIEW_STORAGE_KEY, currentView);
  }, [currentView]);
  const [mustResetPassword, setMustResetPassword] = useState(false);
  const [bulletinCategory, setBulletinCategory] = useState<string>('All');

  // 🎯 Notification highlighter target — the reference / id of the request card
  // the destination view should scroll to & glow. Set ONLY by a notification
  // click; cleared on any manual navigation so stale glows never re-fire.
  const [highlightTarget, setHighlightTarget] = useState<string | undefined>(undefined);
  
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
    setHighlightTarget(undefined); // manual nav → drop any pending highlight
  };

  // Notification → jump to the request's view and glow the matching card.
  const handleNotifNavigate = (view: CommunityNotifView, highlightRef: string) => {
    setCurrentView(view);
    setIsProfileOpen(false);
    setHighlightTarget(highlightRef);
  };

  // Bell "History" button → open the full notification history view.
  const openNotificationHistory = () => {
    setCurrentView('Notifications');
    setIsProfileOpen(false);
    setHighlightTarget(undefined);
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
        const now = new Date().getTime();

        // 🗄️ Past = explicitly archived OR its expiry has lapsed. Kept IN the
        // regular bulletin (not a separate tab) — still important, just tagged
        // so residents can tell it's historical. Only drafts are ever hidden.
        // ⏰ Compare against the END of the expiry day (not the raw timestamp) so
        // a "valid until June 18" notice doesn't vanish at midnight.
        const isPastNews = (news: any) => {
          const isArchivedStatus = String(news.status || '').toLowerCase() === 'archived';
          let isExpired = false;
          if (news.expires_at) {
            const exp = new Date(news.expires_at);
            if (!isNaN(exp.getTime())) {
              exp.setHours(23, 59, 59, 999);
              isExpired = exp.getTime() < now;
            }
          }
          return isArchivedStatus || isExpired;
        };

        // 🧟 Belt-and-suspenders for ZOMBIE rows discarded BEFORE the 'Discarded'
        // status existed — those got saved with status: 'Archived' (the old,
        // buggy behavior) and the modal's own placeholder text, so status alone
        // can't catch them. Content-sniff the exact auto-save placeholders.
        const isPlaceholderDraft = (news: any) =>
          String(news.content || '').trim() === '(draft in progress)' ||
          String(news.title || '').trim() === '(Untitled draft)';

        const filteredNews = rawNews.filter((news: any) => {
          // 📝 Drafts AND discarded drafts (thrown away — never actually
          // published) are always hidden from residents. "Discarded" is a
          // distinct status from "Archived" precisely so a never-live draft
          // can never masquerade as a real past announcement.
          const status = String(news.status || '').toLowerCase();
          if (status === 'draft' || status === 'discarded' || isPlaceholderDraft(news)) {
            return false;
          }

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
                      {isPastNews(news) && (
                        <span
                          className="NEWS_CAT_TAG"
                          style={{ right: 'auto', left: '1.25rem', background: 'rgba(100,116,139,0.9)' }}
                        >
                          ARCHIVED
                        </span>
                      )}
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
            highlightId={highlightTarget}
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
            highlightId={highlightTarget}
          />
        );

      case 'Notifications':
        return (
          <Community_Notification_History
            onBack={() => navigateTo('Announcements')}
            onNavigate={handleNotifNavigate}
          />
        );

      default:
        return null;
    }
  }, [currentView, isProfileOpen, loading, resident, blotters, documents, newsList, activeTab, fetchData, setActiveTab, bulletinCategory, mustResetPassword, highlightTarget]);

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
                onNavigate={handleNotifNavigate}
                onOpenHistory={openNotificationHistory}
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