import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ApiService } from '../api';

// IMPORT SUB-PAGES
import Profile from './Profile';
import HouseholdPage from './Household';
import ResidentsPage from './Resident';
import BlotterPage from './Blotter';
import DocumentsPage from './Document';
import OfficialsPage from './Officials';
import AuditlogPage from './Auditlog';
import AnnouncementPage from './Announcement';
import AccountManagementPage from './Account_Management';
import ArchivePage from './Archive';

import DashboardHome, { type DashboardData } from './Dashboard_Home';
import AdministratorNotification from './Administrator_Notification'; 
import NotificationSystem from './Notification_system'; 

import './styles/frame.css';
import './styles/Dashboard.css';

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface DashboardProps {
  onLogout: () => void;
  user: any;
}

const initialDashboardData: DashboardData = {
  stats: { totalPopulation: 0, documentsIssued: 0, blotterCases: 0, systemActivities: 0 },
  barangayName: "Barangay Engineer's Hill",
  systemName: "Smart Barangay",
  adminName: "Administrator",
};

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const STATS_POLL_INTERVAL = 120000; // 2 minutes

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

const Dashboard: React.FC<DashboardProps> = ({ onLogout, user }) => {
  const [data, setData] = useState<DashboardData>(initialDashboardData);
  const [loading, setLoading] = useState<boolean>(true);
  
  // ─── 🛡️ THE FIX: Navigation State ───
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem('admin_active_tab') || 'Dashboard');
  const [highlightId, setHighlightId] = useState<string | undefined>(undefined); // State to catch the ID for the yellow glow
  
  const statsControllerRef = useRef<AbortController | null>(null);
  const statsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persistence for the active tab
  useEffect(() => {
    localStorage.setItem('admin_active_tab', activeTab);
  }, [activeTab]);

  // ─── 🛡️ THE FIX: Custom Navigation Handler ───
  // This catches BOTH the tab name and the ID from your notification clicks
  const handleNavigation = (tabName: string, id?: string) => {
    setActiveTab(tabName);
    setHighlightId(id); // Save the ID so the target page knows what to highlight
  };

  // ─── THE SMART PULSE HANDSHAKE (Stats Only) ───
  const fetchStats = useCallback(async () => {
    if (statsControllerRef.current) statsControllerRef.current.abort();
    statsControllerRef.current = new AbortController();

    try {
      const realData = await ApiService.getStats(statsControllerRef.current.signal);
      
      if (realData) {
        const newData: DashboardData = {
          stats: {
            totalPopulation:  realData.stats?.totalPopulation  || 0,
            documentsIssued:  realData.stats?.documentsIssued  || 0,
            blotterCases:     realData.stats?.blotterCases     || 0,
            systemActivities: realData.stats?.systemActivities || 0,
          },
          barangayName: realData.barangayName || "Barangay Engineer's Hill",
          systemName:   realData.systemName   || 'Smart Barangay',
          adminName:    user?.profileName || user?.username || 'Administrator',
        };

        setData(prevData => {
          if (JSON.stringify(prevData) === JSON.stringify(newData)) return prevData;
          return newData; 
        });
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') console.error("[DASHBOARD] Stats Sync Error:", err);
    } finally {
      setLoading(false);
      if (document.visibilityState === 'visible') {
        statsTimer.current = setTimeout(fetchStats, STATS_POLL_INTERVAL); 
      }
    }
  }, [user]);

  useEffect(() => {
    fetchStats();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchStats();
      } else if (statsTimer.current) {
        clearTimeout(statsTimer.current);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (statsTimer.current) clearTimeout(statsTimer.current);
      if (statsControllerRef.current) statsControllerRef.current.abort();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchStats]);

  const menuItems = [
    { name: 'Dashboard',          icon: 'fas fa-th-large' },
    { name: 'Announcements',      icon: 'fas fa-bullhorn' },
    { name: 'Officials',          icon: 'fas fa-user-shield' },
    { name: 'Residents',          icon: 'fas fa-users' },
    { name: 'Household',          icon: 'fas fa-home' },
    { name: 'Document',           icon: 'fas fa-file-alt' },
    { name: 'Blotter Cases',      icon: 'fas fa-gavel' },
    { name: 'Archive',            icon: 'fas fa-archive' },
    { name: 'Audit Log',          icon: 'fas fa-clipboard-list' },
    { name: 'Account Management', icon: 'fas fa-user-cog' },
    { name: 'My Profile',         icon: 'fas fa-cog' },
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'Dashboard':           return <DashboardHome data={data} loading={loading} onNavigate={handleNavigation} />;
      
      // ─── 🛡️ THE FIX: String matching and Prop passing ───
      case 'Notification Center': return <NotificationSystem onNavigate={handleNavigation} />; 
      case 'Blotter Cases':       return <BlotterPage highlightId={highlightId} />;
      case 'Document':            return <DocumentsPage highlightId={highlightId} />;
      
      case 'My Profile':          return <div className="DS_CONTAINER"><Profile /></div>;
      case 'Household':           return <HouseholdPage />;
      case 'Residents':           return <ResidentsPage />;
      case 'Officials':           return <OfficialsPage />;
      case 'Audit Log':           return <AuditlogPage />;
      case 'Announcements':       return <AnnouncementPage />;
      case 'Archive':             return <ArchivePage />;
      case 'Account Management':  return <AccountManagementPage />;
      default:                    return <div className="DS_CONTAINER"><h2>{activeTab}</h2><p>Module initializing...</p></div>;
    }
  };

  return (
    <div className="FRAME_WRAPPER">
      {/* ─── SIDEBAR ─── */}
      <aside className="FRAME_SIDEBAR">
        <div className="FRAME_LOGO_AREA">
          <i className="fas fa-landmark FRAME_LOGO_ICON" />
          <h2 className="FRAME_LOGO_TEXT">Smart Barangay</h2>
        </div>
        <nav className="FRAME_NAV_AREA">
          {menuItems.map((item, index) => (
            <div 
              key={index} 
              className={`FRAME_MENU_ITEM ${activeTab === item.name ? 'FRAME_MENU_ACTIVE' : ''}`} 
              onClick={() => handleNavigation(item.name)} // Update sidebar clicks to clear highlightId
            >
              <i className={item.icon} />
              <span>{item.name}</span>
            </div>
          ))}
        </nav>
        <div className="FRAME_FOOTER">
          <span className="FRAME_VERSION_TEXT">v1.5.0 Engineers Hill</span>
        </div>
      </aside>

      {/* ─── MAIN CONTENT ─── */}
      <div className="FRAME_MAIN_COLUMN">
        <header className="FRAME_TOPBAR">
          <div className="FRAME_BREADCRUMB">Pages / <b>{activeTab}</b></div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
            
            {/* 🛡️ THE FIX: Use handleNavigation so dropdowns can pass the highlightId */}
            <AdministratorNotification onNavigate={handleNavigation} />

            {/* USER PROFILE */}
            <div className="FRAME_USER">
              <div className="FRAME_USER_TEXT">
                <span className="FRAME_USER_NAME">{loading ? '...' : data.adminName}</span>
                <span className="FRAME_USER_ROLE">{user?.role?.toUpperCase() || 'ADMIN'}</span>
              </div>
              <div className="FRAME_AVATAR"><i className="fas fa-user-tie" /></div>
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