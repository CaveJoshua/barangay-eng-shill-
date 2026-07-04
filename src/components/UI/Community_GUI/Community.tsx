import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Community_Preview, { type NewsItem } from '../../forms/Community_preview';
import CommunityLoginModal from '../../buttons/Community_login_modal';
import './Styles/Community.css';
import { API_BASE_URL } from '../api';

const CATEGORY_MAP: Record<string, { indicator: string; text: string }> = {
  'Public Advisory': { indicator: 'color-blue', text: 'text-blue' },
  'Senior Citizen': { indicator: 'color-purple', text: 'text-purple' },
  'Health & Safety': { indicator: 'color-green', text: 'text-green' },
  'Youth & Sports': { indicator: 'color-orange', text: 'text-orange' },
  'Community Project': { indicator: 'color-teal', text: 'text-teal' },
};

interface CommunityProps {
  onLoginSuccess?: (user: any) => void; 
}

const Community: React.FC<CommunityProps> = ({ onLoginSuccess }) => {
  const [activeFilter, setActiveFilter] = useState('All');
  const [selectedArticle, setSelectedArticle] = useState<NewsItem | null>(null);
  const [newsList, setNewsList] = useState<NewsItem[]>([]);
  const [showLogin, setShowLogin] = useState(false);
  const [loading, setLoading] = useState(true);

  const ANNOUNCEMENTS_URL = `${API_BASE_URL}/announcements`;

  const fetchNews = useCallback(async (controller?: AbortController) => {
    try {
      const res = await fetch(ANNOUNCEMENTS_URL, { 
        signal: controller?.signal 
      });
      if (res.ok) {
        const data = await res.json();
        setNewsList(data);
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') console.error("Sync Error:", e);
    } finally {
      setLoading(false);
    }
  }, [ANNOUNCEMENTS_URL]);

  useEffect(() => {
    const controller = new AbortController();
    fetchNews(controller);
    const interval = setInterval(() => fetchNews(), 300000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [fetchNews]);

  const filters = ['All', 'Public Advisory', 'Senior Citizen', 'Health & Safety', 'Youth & Sports', 'Community Project'];

  // 🧟 Belt-and-suspenders for ZOMBIE rows discarded BEFORE the 'Discarded'
  // status existed — those got saved with status: 'Archived' (the old, buggy
  // behavior) and the modal's own placeholder text, so status alone can't
  // catch them. Content-sniff the exact auto-save placeholders as a fallback.
  const isPlaceholderDraft = (n: any) =>
    String(n.content || '').trim() === '(draft in progress)' ||
    String(n.title || '').trim() === '(Untitled draft)';

  // 🗄️ Archived/expired notices stay IN the regular feed (not a separate tab) —
  // they're still important, so they show up alongside current ones, just
  // tagged so residents can tell them apart. Drafts AND discarded drafts (a
  // draft that was thrown away — never actually published) are always hidden;
  // "Discarded" is a distinct status from "Archived" precisely so a never-live
  // draft can never masquerade as a real past announcement.
  const filteredNews = useMemo(() => {
    return newsList.filter((n: any) => {
      const status = String(n.status || '').toLowerCase();
      if (status === 'draft' || status === 'discarded' || isPlaceholderDraft(n)) return false;
      return activeFilter === 'All' || n.category === activeFilter;
    });
  }, [newsList, activeFilter]);

  const isPastAnnouncement = (n: any) => {
    const now = new Date();
    return String(n.status || '').toLowerCase() === 'archived' || (n.expires_at ? new Date(n.expires_at) < now : false);
  };

  return (
    <div className="C_PAGE_WRAPPER">
      <div className="C_PAGE_STAGE">
        
        {/* NAVBAR */}
        <nav className="C_NAV_MAIN">
          <div className="C_NAV_LEFT">
            <div className="C_LOGO_SHIELD"><i className="fas fa-shield-alt"></i></div>
            <div className="C_BRAND_INFO">
              <strong>Barangay Portal</strong>
              <span>Citizen Services</span>
            </div>
          </div>
          <div className="C_NAV_RIGHT">
            {/* 🛡️ Intentionally left empty as requested */}
          </div>
        </nav>

        {/* HERO */}
        <header className="C_HERO_HERO">
          <h1>Welcome to Barangay Engineer's Hill</h1>
          <p>Stay informed with official community updates and resident services.</p>
        </header>

        {/* SIGN IN CTA */}
        <section className="C_SIGNIN_SECTION">
          <div className="C_SIGNIN_CONTENT">
            <h2>Sign up for more barangay services</h2>
            <p>
              Log in to your secure resident account to apply for official clearances, 
              view localized records, and access community alerts.
            </p>
            <button className="C_LOGIN_TRIGGER_BTN" onClick={() => setShowLogin(true)}>
              SIGN IN TO PORTAL
            </button>
          </div>
        </section>

        {/* COMMUNITY BULLETIN */}
        <main className="C_ANNOUNCEMENT_SECTION">
          <div className="C_ANNOUNCEMENT_HEADER">
            <h2>Latest Announcements</h2>
            <div className="C_FILTER_BAR">
              {filters.map(f => (
                <button 
                  key={f} 
                  className={`C_FILTER_TAB ${activeFilter === f ? 'ACTIVE' : ''}`}
                  onClick={() => setActiveFilter(f)}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="C_ANNOUNCEMENT_GRID">
            {loading ? (
              <div className="C_LOADING_STATE">Syncing Bulletin Board...</div>
            ) : filteredNews.length === 0 ? (
              <div className="C_EMPTY_STATE">No announcements available in this category.</div>
            ) : (
              filteredNews.map(news => {
                const colorMap = CATEGORY_MAP[news.category] || { indicator: 'color-default', text: '' };
                const isPast = isPastAnnouncement(news);

                return (
                  <article key={news.id} className="C_NEWS_ITEM" onClick={() => setSelectedArticle(news)}>
                    <div className={`C_CATEGORY_INDICATOR ${colorMap.indicator}`}></div>

                    <div className="C_NEWS_PREVIEW_IMG">
                      {news.image_url ? (
                        <img src={news.image_url} alt="announcement" />
                      ) : (
                        <div className="C_NEWS_PLACEHOLDER"><i className="fas fa-bullhorn"></i></div>
                      )}
                    </div>

                    <div className="C_NEWS_BODY">
                      <div className="C_NEWS_META">
                        <span className="C_NEWS_DATE">{new Date(news.created_at || '').toLocaleDateString()}</span>
                        <span className={`C_NEWS_CAT ${colorMap.text}`}>{news.category}</span>
                        {isPast && (
                          <span className="C_NEWS_CAT" style={{ color: '#94a3b8' }}>ARCHIVED</span>
                        )}
                      </div>
                      <h4>{news.title}</h4>
                      <p className="C_SNIPPET">{news.content?.substring(0, 120)}...</p>
                      <button className="C_NEWS_LINK">READ MORE <i className="fas fa-arrow-right"></i></button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </main>

        {/* MODALS */}
        {selectedArticle && (
          <Community_Preview article={selectedArticle} onBack={() => setSelectedArticle(null)} />
        )}

        <CommunityLoginModal 
          isOpen={showLogin} 
          onClose={() => setShowLogin(false)} 
          onLoginSuccess={onLoginSuccess || (() => {})} 
        />

      </div>
    </div>
  );
};

export default Community;