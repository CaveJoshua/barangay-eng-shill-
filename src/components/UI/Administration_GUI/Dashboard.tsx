import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ApiService } from '../api';

import Profile from './Profile';
import HouseholdPage from './Household';
import ResidentsPage from './Resident';
import BlotterPage from './IncidentReport';
import DocumentsPage from './Document';
import OfficialsPage from './Officials';
import AuditlogPage from './AuditLog';
import AnnouncementPage from './Announcement';
import AccountManagementPage from './AccountManagement';
import ArchivePage from './Archive';

import DashboardHome, { type DashboardData } from './DashboardHome';
import AdministratorNotification from './AdministratorNotification';
import NotificationSystem from './NotificationSystem';

import './styles/Frame.css';
import './styles/Dashboard.css';

interface DashboardProps {
  onLogout: () => void;
  user: any;
}

const initialDashboardData: DashboardData = {
  stats: { totalPopulation: 0, documentsIssued: 0, blotterCases: 0, systemActivities: 0 },
  barangayName: "Barangay Engineer's Hill",
  systemName: "Smart Barangay",
  adminName: "Loading...",
};

const STATS_POLL_INTERVAL = 120000;

// ─── 🛡️ BULLETPROOF SESSION PARSER ───────────────────────────────────────────
const parseAdminSession = () => {
  try {
    const sessionStr = localStorage.getItem('admin_session');
    if (!sessionStr) return { name: 'User', position: 'Official', role: 'official', initial: 'U' };

    const session = JSON.parse(sessionStr);

    const profile   = session?.profile   || session?.user?.profile || {};
    const userNode  = session?.user      || session || {};

    // ── NAME ──
    const firstName = profile?.first_name || userNode?.first_name || '';
    const lastName  = profile?.last_name  || userNode?.last_name  || '';
    const combined  = firstName && lastName ? `${firstName} ${lastName}` : '';

    const fullName =
      combined                        ||
      profile?.profileName            ||  
      profile?.full_name              ||
      session?.full_name              ||
      userNode?.full_name             ||
      userNode?.username              ||
      session?.username               ||
      'User';

    // ── ROLE & POSITION FIX: Prioritize actual position over system role ──
    const rawRole     = (userNode?.role || session?.role || 'official').toLowerCase().trim();
    const rawPosition = (profile?.position || session?.position || '').trim();

    // If they have a real Barangay position, use it. Otherwise, use their system role.
    const resolvedPosition = rawPosition ? rawPosition : (rawRole === 'superadmin' ? 'Superadmin' : 'Official');

    return {
      name:     fullName,
      position: resolvedPosition,
      role:     rawRole, 
      initial:  fullName.charAt(0).toUpperCase(),
    };
  } catch (e) {
    console.error('[SESSION PARSER] Failed:', e);
    return { name: 'User', position: 'Official', role: 'official', initial: 'U' };
  }
};

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

const Dashboard: React.FC<DashboardProps> = ({ onLogout, user }) => {
  const [data, setData]         = useState<DashboardData>(initialDashboardData);
  const [loading, setLoading]   = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState(
    () => localStorage.getItem('admin_active_tab') || 'Dashboard'
  );
  const [highlightId, setHighlightId] = useState<string | undefined>(undefined);

  const [userInfo, setUserInfo] = useState(parseAdminSession);

  useEffect(() => {
    setUserInfo(parseAdminSession());
  }, [user]);

  const statsControllerRef = useRef<AbortController | null>(null);
  const statsTimer         = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    localStorage.setItem('admin_active_tab', activeTab);
  }, [activeTab]);

  const handleNavigation = (tabName: string, id?: string) => {
    setActiveTab(tabName);
    setHighlightId(id);
  };

  const fetchStats = useCallback(async () => {
    if (statsControllerRef.current) statsControllerRef.current.abort();
    statsControllerRef.current = new AbortController();
    try {
      const realData = await ApiService.getStats(statsControllerRef.current.signal);
      if (realData) {
        setData(prevData => {
          const newData: DashboardData = {
            stats: {
              totalPopulation:  realData.stats?.totalPopulation  || 0,
              documentsIssued:  realData.stats?.documentsIssued  || 0,
              blotterCases:     realData.stats?.blotterCases     || 0,
              systemActivities: realData.stats?.systemActivities || 0,
            },
            barangayName: realData.barangayName || "Barangay Engineer's Hill",
            systemName:   realData.systemName   || 'Smart Barangay',
            adminName:    userInfo.name,
          };
          if (JSON.stringify(prevData) === JSON.stringify(newData)) return prevData;
          return newData;
        });
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') console.error('[DASHBOARD] Stats Sync Error:', err);
    } finally {
      setLoading(false);
      if (document.visibilityState === 'visible') {
        statsTimer.current = setTimeout(fetchStats, STATS_POLL_INTERVAL);
      }
    }
  }, [userInfo.name]);

  useEffect(() => {
    fetchStats();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') fetchStats();
      else if (statsTimer.current) clearTimeout(statsTimer.current);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      if (statsTimer.current) clearTimeout(statsTimer.current);
      if (statsControllerRef.current) statsControllerRef.current.abort();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchStats]);

  // ─── 🛡️ DYNAMIC MENU FILTERING (FIXED FOR PUNONG BARANGAY) ─────────────────
  const getVisibleMenuItems = () => {
    const role = userInfo.role;
    const pos = userInfo.position.toLowerCase();

    // Admins and Top Officials get absolute access
    const isSysAdmin = role === 'admin' || role === 'superadmin';
    const isHighOfficial = pos === 'punong barangay' || pos === 'barangay secretary';

    const allItems = [
      { name: 'Dashboard',          icon: 'fas fa-th-large' },
      { name: 'Announcements',      icon: 'fas fa-bullhorn' },
      { name: 'Officials',          icon: 'fas fa-user-shield' },
      { name: 'Residents',          icon: 'fas fa-users' },
      { name: 'Household',          icon: 'fas fa-home' },
      { name: 'Document',           icon: 'fas fa-file-alt' },
      { name: 'Incident Reports',   icon: 'fas fa-gavel' },
      { name: 'Archive',            icon: 'fas fa-archive' },
      { name: 'Audit Log',          icon: 'fas fa-clipboard-list' },
      { name: 'Account Management', icon: 'fas fa-user-cog' },
      { name: 'My Profile',         icon: 'fas fa-cog' },
    ];

    return allItems.filter(item => {
      // 1. Captains, Secretaries, and System Admins see EVERYTHING.
      if (isSysAdmin || isHighOfficial) return true;

      // 2. Hide sensitive modules from regular Kagawads/Staff
      if (item.name === 'Account Management' || item.name === 'Audit Log') return false;

      // 3. Officials Directory visibility for specific roles
      if (item.name === 'Officials') {
        return pos === 'barangay hall';
      }

      // Show everything else (Residents, Blotter, Profile, etc.)
      return true;
    });
  };

  const visibleMenuItems = getVisibleMenuItems();

  const renderContent = () => {
    switch (activeTab) {
      case 'Dashboard':           return <DashboardHome data={{ ...data, adminName: userInfo.name }} loading={loading} onNavigate={handleNavigation} />;
      case 'Notification Center': return <NotificationSystem onNavigate={handleNavigation} />;
      case 'Incident Reports':    return <BlotterPage highlightId={highlightId} />;
      case 'Document':            return <DocumentsPage highlightId={highlightId} />;
      case 'My Profile':          return <Profile />;
      case 'Household':           return <HouseholdPage />;
      case 'Residents':           return <ResidentsPage />;
      case 'Officials':           return <OfficialsPage />;
      case 'Audit Log':           return <AuditlogPage />;
      case 'Announcements':       return <AnnouncementPage />;
      case 'Archive':             return <ArchivePage />;
      case 'Account Management':  return <AccountManagementPage />;
      default: return <div className="DS_CONTAINER"><h2>{activeTab}</h2><p>Module initializing...</p></div>;
    }
  };

  return (
    <div className="FRAME_WRAPPER">
      <aside className="FRAME_SIDEBAR">
        <div className="FRAME_LOGO_AREA">
          <h2 className="FRAME_LOGO_TEXT">Barangay Engineer's Hill</h2>
        </div>
        
        {/* ── Dynamic Nav Rendering ── */}
        <nav className="FRAME_NAV_AREA">
          {visibleMenuItems.map((item, index) => (
            <div
              key={index}
              className={`FRAME_MENU_ITEM ${activeTab === item.name ? 'FRAME_MENU_ACTIVE' : ''}`}
              onClick={() => handleNavigation(item.name)}
            >
              <i className={item.icon} />
              <span>{item.name}</span>
            </div>
          ))}
        </nav>
        
        <div className="FRAME_FOOTER">
          <span className="FRAME_VERSION_TEXT">Smart Barangay</span>
        </div>
      </aside>

      <div className="FRAME_MAIN_COLUMN">
        <header className="FRAME_TOPBAR">
          <div className="FRAME_BREADCRUMB">Pages / <b>{activeTab}</b></div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
            <AdministratorNotification onNavigate={handleNavigation} />

            <div className="FRAME_USER">
              <div className="FRAME_USER_TEXT">
                <span className="FRAME_USER_NAME">{userInfo.name}</span>
                <span className="FRAME_USER_ROLE" style={{ letterSpacing: '0.05em' }}>
                  {userInfo.position.toUpperCase()}
                </span>
              </div>

              <div className="FRAME_AVATAR" style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: '#eff6ff', color: '#3b82f6',
                fontWeight: '800', fontSize: '1.2rem',
                borderRadius: '50%', width: '40px', height: '40px',
              }}>
                {userInfo.initial}
              </div>

              <button className="TB_LOGOUT_BTN" onClick={onLogout}>Logout</button>
            </div>
          </div>
        </header>

        <main className="FRAME_CONTENT_AREA">
          {renderContent()}
        </main>
      </div>
    </div>
  );
};

export default Dashboard;