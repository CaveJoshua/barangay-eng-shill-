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
import OfficialResetPasswordModal from '../../buttons/Official_Resetpassword_modal';
import { useRealtime } from '../useRealtime';

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

const STATS_POLL_INTERVAL = 8000;
const PENDING_POLL_INTERVAL = 15000; // refresh the Document/Incident request badges every 15s

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

    const avatarUrl = profile?.profile_picture || profile?.avatar || session?.avatar || session?.profile_picture || null;

    return {
      name:            fullName,
      position:        resolvedPosition,
      role:            rawRole, 
      initial:         fullName.charAt(0).toUpperCase(),
      profile_picture: avatarUrl
    };
  } catch (e) {
    console.error('[SESSION PARSER] Failed:', e);
    return { name: 'User', position: 'Official', role: 'official', initial: 'U', profile_picture: null };
  }
};

// ─── 🛡️ TAB NAME NORMALIZER ──────────────────────────────────────────────────
const normalizeTabName = (tabName: string): string => {
  const clean = (tabName || '').toLowerCase().replace(/[\s_-]+/g, '');
  if (clean === 'myprofile' || clean === 'profile' || clean === 'settings') return 'My Profile';
  if (clean === 'dashboard' || clean === 'home') return 'Dashboard';
  if (clean === 'announcements' || clean === 'announcement') return 'Announcements';
  if (clean === 'officials' || clean === 'official') return 'Officials';
  if (clean === 'residents' || clean === 'resident') return 'Residents';
  if (clean === 'household' || clean === 'households') return 'Household';
  if (clean === 'document' || clean === 'documents') return 'Document';
  if (clean === 'incidentreports' || clean === 'incidents' || clean === 'incident' || clean === 'blotter') return 'Incident Reports';
  if (clean === 'archive' || clean === 'archives') return 'Archive';
  if (clean === 'auditlog' || clean === 'auditlogs' || clean === 'audit') return 'Audit Log';
  if (clean === 'accountmanagement' || clean === 'accounts' || clean === 'account') return 'Account Management';
  if (clean === 'notificationcenter' || clean === 'notifications' || clean === 'notification') return 'Notification Center';
  return tabName;
};

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

const Dashboard: React.FC<DashboardProps> = ({ onLogout, user }) => {
  const [data, setData]         = useState<DashboardData>(initialDashboardData);
  const [loading, setLoading]   = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState(
    () => normalizeTabName(localStorage.getItem('admin_active_tab') || 'Dashboard')
  );
  const [highlightId, setHighlightId] = useState<string | undefined>(undefined);

  // 🔔 Count of pending (new) requests per module, shown as a red badge on the nav.
  const [pendingCounts, setPendingCounts] = useState<{ Document: number; 'Incident Reports': number }>({
    Document: 0,
    'Incident Reports': 0,
  });

  const [userInfo, setUserInfo] = useState(parseAdminSession);

  useEffect(() => {
    setUserInfo(parseAdminSession());
  }, [user]);

  // 🔒 Forced first-login reset — mirrors CommunityDashboard.tsx's
  // mustResetPassword pattern for the resident portal.
  const [mustResetPassword, setMustResetPassword] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('admin_session');
      if (raw) {
        const session = JSON.parse(raw);
        if (session.requires_reset === true || session.profile?.is_first_login === true) {
          setMustResetPassword(true);
        }
      }
    } catch {
      // best-effort; ignore parse failures
    }
  }, []);

  const statsControllerRef = useRef<AbortController | null>(null);
  const statsTimer         = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    localStorage.setItem('admin_active_tab', activeTab);
  }, [activeTab]);

  const handleNavigation = (tabName: string, id?: string) => {
    setActiveTab(normalizeTabName(tabName));
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

  // ─── 🔔 PENDING REQUEST BADGES (Document + Incident Reports) ──────────────────
  // Counts records whose status is "Pending" — i.e. new incoming requests that
  // still need admin action, matching the "Pending" tab in each module.
  const pendingControllerRef = useRef<AbortController | null>(null);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPendingCounts = useCallback(async () => {
    if (pendingControllerRef.current) pendingControllerRef.current.abort();
    pendingControllerRef.current = new AbortController();
    const signal = pendingControllerRef.current.signal;

    // Returns null on a failed/aborted fetch so we keep the previous count (no flicker to 0).
    // Excludes staff/walk-in-created records — these are handled on the spot, so they
    // shouldn't inflate the "new incoming request" badge (matches DashboardHome.tsx's
    // existing "Pending Requests" panel, which already excludes walk-in documents the
    // same way; this brings the sidebar/stat-card badges in line with it).
    const isPending = (x: any) => String(x?.status || 'Pending').toLowerCase() === 'pending';
    const countPendingDocs = (list: any): number | null =>
      Array.isArray(list)
        ? list.filter((x: any) => {
            if (!isPending(x)) return false;
            const method = String(x?.request_method || '').toLowerCase();
            const ref = String(x?.reference_no || x?.referenceNo || '').toUpperCase();
            return method !== 'walk-in' && !ref.includes('WK-IN');
          }).length
        : null;
    const countPendingBlotters = (list: any): number | null =>
      Array.isArray(list)
        ? list.filter((x: any) => {
            if (!isPending(x)) return false;
            const caseNo = String(x?.case_number || '').toUpperCase();
            return !caseNo.includes('WK-INC');
          }).length
        : null;

    try {
      const [docs, blotters] = await Promise.all([
        ApiService.getDocuments(signal).catch(() => null),
        ApiService.getBlotters(signal).catch(() => null),
      ]);
      const docCount = countPendingDocs(docs);
      const incCount = countPendingBlotters(blotters);
      setPendingCounts(prev => {
        const next = {
          Document: docCount === null ? prev.Document : docCount,
          'Incident Reports': incCount === null ? prev['Incident Reports'] : incCount,
        };
        return prev.Document === next.Document && prev['Incident Reports'] === next['Incident Reports']
          ? prev
          : next;
      });
    } catch (err: any) {
      if (err?.name !== 'AbortError') console.error('[DASHBOARD] Pending badge sync error:', err);
    } finally {
      if (document.visibilityState === 'visible') {
        pendingTimer.current = setTimeout(fetchPendingCounts, PENDING_POLL_INTERVAL);
      }
    }
  }, []);

  useEffect(() => {
    fetchPendingCounts();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') fetchPendingCounts();
      else if (pendingTimer.current) clearTimeout(pendingTimer.current);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
      if (pendingControllerRef.current) pendingControllerRef.current.abort();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchPendingCounts]);

  // ⚡ REAL-TIME WEBSOCKET SUBSCRIPTION (Live instant updates)
  const { subscribe } = useRealtime({ channels: ['admin', 'public'] });

  useEffect(() => {
    const unsubStats = subscribe('STATS_UPDATED', () => {
      fetchStats();
      fetchPendingCounts();
    });
    const unsubResidents = subscribe('RESIDENTS_UPDATED', () => {
      fetchStats();
    });
    const unsubDocs = subscribe('DOCUMENTS_UPDATED', () => {
      fetchStats();
      fetchPendingCounts();
    });
    const unsubBlotter = subscribe('BLOTTER_UPDATED', () => {
      fetchStats();
      fetchPendingCounts();
    });

    return () => {
      unsubStats();
      unsubResidents();
      unsubDocs();
      unsubBlotter();
    };
  }, [subscribe, fetchStats, fetchPendingCounts]);

  // Immediately refresh stats when switching back to Dashboard tab
  useEffect(() => {
    if (activeTab === 'Dashboard') {
      fetchStats();
      fetchPendingCounts();
    }
  }, [activeTab, fetchStats, fetchPendingCounts]);

  // ─── 🛡️ DYNAMIC MENU FILTERING (FIXED FOR PUNONG BARANGAY & BARANGAY HALL) ───
  const getVisibleMenuItems = () => {
    const role = userInfo.role;
    const pos = userInfo.position.toLowerCase();
    
    // Normalize to safely check without spaces
    const normalizedRole = role.replace(/\s+/g, '');
    const normalizedPos = pos.replace(/\s+/g, '');

    // Admins, Top Officials, and Barangay Hall get absolute access
    const isSysAdmin = role === 'admin' || role === 'superadmin' || normalizedRole === 'barangayhall';
    const isHighOfficial = pos === 'punong barangay' || pos === 'barangay secretary' || normalizedPos === 'barangayhall';

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
      // 1. Captains, Secretaries, System Admins, and Barangay Hall see EVERYTHING.
      if (isSysAdmin || isHighOfficial) return true;

      // 2. Hide sensitive modules from regular Kagawads/Staff
      if (item.name === 'Account Management' || item.name === 'Audit Log') return false;

      // 3. Officials Directory visibility for specific roles (Fallback)
      if (item.name === 'Officials') {
        return pos === 'barangay hall';
      }

      // Show everything else (Residents, Blotter, Profile, etc.)
      return true;
    });
  };

  const visibleMenuItems = getVisibleMenuItems();

  const renderContent = () => {
    const tab = normalizeTabName(activeTab);
    switch (tab) {
      case 'Dashboard':           return <DashboardHome data={{ ...data, adminName: userInfo.name }} loading={loading} onNavigate={handleNavigation} pendingCounts={pendingCounts} />;
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
      default: return <div className="DS_CONTAINER"><h2>{tab}</h2><p>Module initializing...</p></div>;
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
          {visibleMenuItems.map((item, index) => {
            const badgeCount = pendingCounts[item.name as keyof typeof pendingCounts] || 0;
            return (
              <div
                key={index}
                className={`FRAME_MENU_ITEM ${normalizeTabName(activeTab) === normalizeTabName(item.name) ? 'FRAME_MENU_ACTIVE' : ''}`}
                onClick={() => handleNavigation(item.name)}
              >
                <i className={item.icon} />
                <span>{item.name}</span>
                {badgeCount > 0 && (
                  <span
                    className="FRAME_MENU_BADGE"
                    title={`${badgeCount} pending request${badgeCount === 1 ? '' : 's'}`}
                    style={{
                      marginLeft: 'auto',
                      background: '#ef4444',
                      color: '#fff',
                      fontSize: '0.7rem',
                      fontWeight: 800,
                      minWidth: '20px',
                      height: '20px',
                      borderRadius: '999px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '0 6px',
                      lineHeight: 1,
                      boxShadow: '0 0 0 2px rgba(239,68,68,0.25)',
                    }}
                  >
                    {badgeCount > 99 ? '99+' : badgeCount}
                  </span>
                )}
              </div>
            );
          })}
        </nav>
        
        <div className="FRAME_FOOTER">
          <span className="FRAME_VERSION_TEXT">Smart Barangay</span>
        </div>
      </aside>

      <div className="FRAME_MAIN_COLUMN">
        <header className="FRAME_TOPBAR">
          <div className="FRAME_BREADCRUMB">Pages / <b>{normalizeTabName(activeTab)}</b></div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
            <AdministratorNotification onNavigate={handleNavigation} />

            <div className="FRAME_USER">
              <button 
                type="button" 
                className="FRAME_USER_TRIGGER" 
                onClick={() => handleNavigation('My Profile')}
                title="Go to My Profile"
              >
                <div className="FRAME_USER_TEXT">
                  <span className="FRAME_USER_NAME">{userInfo.name}</span>
                  <span className="FRAME_USER_ROLE" style={{ letterSpacing: '0.05em' }}>
                    {userInfo.position.toUpperCase()}
                  </span>
                </div>

                <div className="FRAME_AVATAR">
                  {userInfo.profile_picture ? (
                    <img 
                      src={userInfo.profile_picture} 
                      alt={userInfo.name} 
                      className="FRAME_AVATAR_IMG" 
                    />
                  ) : (
                    userInfo.initial
                  )}
                </div>
              </button>

              <button className="TB_LOGOUT_BTN" onClick={onLogout}>Logout</button>
            </div>
          </div>
        </header>

        <main className="FRAME_CONTENT_AREA">
          {renderContent()}
        </main>
      </div>

      <OfficialResetPasswordModal
        isOpen={mustResetPassword}
        accountId={localStorage.getItem('account_id') || ''}
        firstName={userInfo.name.split(' ')[0]}
        onSuccess={() => {
          setMustResetPassword(false);
          try {
            const raw = localStorage.getItem('admin_session');
            if (raw) {
              const session = JSON.parse(raw);
              session.requires_reset = false;
              if (session.profile) session.profile.is_first_login = false;
              localStorage.setItem('admin_session', JSON.stringify(session));
            }
          } catch {
            // best-effort; ignore parse failures
          }
        }}
      />
    </div>
  );
};

export default Dashboard;