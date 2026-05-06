import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ApiService } from '../api'; 

// Polling interval set to 10 seconds for real-time responsiveness
const NOTIF_POLL_INTERVAL = 10000; 

interface AdminNotifProps {
  onNavigate: (tabName: string, highlightId?: string) => void;
}

// Interface matching the Unified Live Feed from Notification.js
interface LiveNotification {
  id: string;        
  originalId: string; 
  title: string;
  message: string;
  type: string; 
  timestamp: string;
  status: string;
}

const AdministratorNotification: React.FC<AdminNotifProps> = ({ onNavigate }) => {
  const [notifications, setNotifications] = useState<LiveNotification[]>([]);
  
  // 💾 Memory for Read Notifications
  const [readIds, setReadIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('admin_read_notif_ids');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  // 💾 Memory for Cleared Notifications (hidden from dropdown)
  const [clearedIds, setClearedIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('admin_cleared_notif_ids');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const [showNotifs, setShowNotifs] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  
  const notifsControllerRef = useRef<AbortController | null>(null);
  const notifsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 💾 Sync read/cleared IDs to local storage
  useEffect(() => {
    localStorage.setItem('admin_read_notif_ids', JSON.stringify(readIds));
  }, [readIds]);

  useEffect(() => {
    localStorage.setItem('admin_cleared_notif_ids', JSON.stringify(clearedIds));
  }, [clearedIds]);

  // 🖱️ Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setShowNotifs(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ─── DIRECT FETCH LOGIC WITH STRICT ADMIN FILTERS ───
  const fetchLiveNotifs = useCallback(async () => {
    if (notifsControllerRef.current) notifsControllerRef.current.abort();
    notifsControllerRef.current = new AbortController();

    try {
      const liveData = await ApiService.getNotifications(notifsControllerRef.current.signal);
      
      if (liveData && Array.isArray(liveData)) {
        const mappedNotifs: LiveNotification[] = [];

        for (const item of liveData) {
          const rawMsg = item.message || '';
          const lowerMsg = rawMsg.toLowerCase();

          // 🛡️ 1. ADMIN FILTER: BLOCK ALL WALK-INS
          if (lowerMsg.includes('wk-in') || lowerMsg.includes('walk-in')) {
            continue; 
          }

          // 🛡️ 2. ADMIN FILTER: HIDE ALREADY PROCESSED ITEMS
          // If it says processing, completed, ready, or claimed, the admin doesn't need a bell notification.
          if (
            lowerMsg.includes('processing') || 
            lowerMsg.includes('completed') || 
            lowerMsg.includes('ready') || 
            lowerMsg.includes('claimed') ||
            lowerMsg.includes('rejected')
          ) {
            continue; 
          }

          // 🛡️ 3. ADMIN REWRITE: Fix the "Your Document" resident phrasing
          let adminMsg = rawMsg;
          if (adminMsg.toLowerCase().startsWith('your ')) {
            adminMsg = adminMsg.replace(/^Your /i, 'Incoming Online Request: ');
          }
          if (adminMsg.toLowerCase().includes('is now pending')) {
            adminMsg = adminMsg.replace(/is now pending/i, 'is awaiting review.');
          }

          const caseMatch = rawMsg.match(/(BLTR|BL|INCD|TMP|BLT|ON-LN|WK-IN|REF)-[A-Z0-9-]+/i);
          const extractedRef = caseMatch ? caseMatch[0] : String(item.id);

          mappedNotifs.push({
            id: String(item.id),
            originalId: extractedRef, 
            title: item.title === 'Document Alert' ? 'Online Request Alert' : (item.title || 'System Alert'),
            message: adminMsg,
            type: (item.type || 'system').toLowerCase(),
            timestamp: item.created_at || new Date().toISOString(),
            status: item.is_read ? 'read' : 'unread'
          });
        }

        setNotifications(mappedNotifs);

        // Sync backend read state
        const backendReadIds = mappedNotifs.filter(n => n.status === 'read').map(n => n.id);
        if (backendReadIds.length > 0) {
            setReadIds(prev => Array.from(new Set([...prev, ...backendReadIds])));
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') console.error("[NOTIFS] Sync Failure");
    } finally {
      if (document.visibilityState === 'visible') {
        notifsTimer.current = setTimeout(fetchLiveNotifs, NOTIF_POLL_INTERVAL);
      }
    }
  }, []);

  useEffect(() => {
    fetchLiveNotifs();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchLiveNotifs();
      } else if (notifsTimer.current) {
        clearTimeout(notifsTimer.current);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      if (notifsTimer.current) clearTimeout(notifsTimer.current);
      if (notifsControllerRef.current) notifsControllerRef.current.abort();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchLiveNotifs]);

  const visibleNotifications = notifications.filter(n => !clearedIds.includes(n.id));
  const unreadCount = visibleNotifications.filter(n => !readIds.includes(n.id)).length;

  const handleNotificationClick = (n: LiveNotification) => {
    setShowNotifs(false);

    const normalizedType = n.type.toLowerCase();
    if (normalizedType === 'document') {
      onNavigate('Document', n.originalId); 
    } else if (normalizedType === 'blotter' || normalizedType === 'incident') {
      onNavigate('Incident Reports', n.originalId); 
    } else {
      onNavigate('Notification Center'); 
    }

    if (!readIds.includes(n.id)) {
      setReadIds(prev => Array.from(new Set([...prev, n.id])));
      if (ApiService.markNotificationRead) {
        ApiService.markNotificationRead(n.id).catch(() => console.error("Could not update read status"));
      }
    }
  };

  const handleClearAll = () => {
    const allVisibleIds = visibleNotifications.map(n => n.id);
    setReadIds(prev => Array.from(new Set([...prev, ...allVisibleIds])));
    setClearedIds(prev => Array.from(new Set([...prev, ...allVisibleIds])));

    if (ApiService.clearAllNotifications) {
      ApiService.clearAllNotifications().catch(() => console.error("Global clear failed")); 
    }
  };

  const getIconClass = (type: string) => {
    const t = type.toLowerCase();
    if (t === 'document') return "fas fa-file-alt";
    if (t === 'blotter' || t === 'incident') return "fas fa-balance-scale";
    return "fas fa-info-circle";
  };

  return (
    <div className="FRAME_NOTIF_WRAP" ref={notifRef} style={{ position: 'relative', display: 'inline-block' }}>
      
      <button 
        className="FRAME_NOTIF_BTN" 
        onClick={() => setShowNotifs(!showNotifs)}
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', position: 'relative', padding: '8px' }}
      >
        <i className="fas fa-bell" style={{ fontSize: '1.4rem', color: '#475569' }}></i>
        {unreadCount > 0 && (
          <span 
            className="FRAME_NOTIF_BADGE animate-pulse" 
            style={{ position: 'absolute', top: '0', right: '0', background: '#ef4444', color: 'white', fontSize: '0.7rem', fontWeight: 'bold', padding: '2px 6px', borderRadius: '50%' }}
          >
            {unreadCount}
          </span>
        )}
      </button>

      {showNotifs && (
        <div 
          className="FRAME_NOTIF_DROPDOWN"
          style={{
            position: 'absolute',
            top: '120%',
            right: '0',
            width: '360px',
            backgroundColor: '#ffffff',
            boxShadow: '0px 10px 40px rgba(0, 0, 0, 0.15)',
            borderRadius: '8px',
            border: '1px solid #e2e8f0',
            zIndex: 9999,
            overflow: 'hidden'
          }}
        >
          <div className="FRAME_NOTIF_HEADER" style={{ display: 'flex', justifyContent: 'space-between', padding: '15px', borderBottom: '1px solid #e2e8f0', backgroundColor: '#f8fafc' }}>
            <h4 style={{ margin: 0, fontSize: '1rem', color: '#1e293b' }}>Online Requests Feed</h4>
            {visibleNotifications.length > 0 && (
              <button onClick={handleClearAll} style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontSize: '0.85rem' }}>
                Clear All
              </button>
            )}
          </div>
          
          <div className="FRAME_NOTIF_BODY" style={{ maxHeight: '400px', overflowY: 'auto' }}>
            {visibleNotifications.length === 0 ? (
              <div className="FRAME_NOTIF_EMPTY" style={{ padding: '40px 20px', textAlign: 'center', color: '#94a3b8' }}>
                <i className="fas fa-satellite-dish" style={{ fontSize: '3rem', marginBottom: '15px', opacity: 0.5 }}></i>
                <p style={{ margin: 0, fontSize: '0.95rem' }}>No active online requests.</p>
              </div>
            ) : (
              visibleNotifications.slice(0, 8).map((n) => {
                const isRead = readIds.includes(n.id);
                return (
                  <div 
                    key={n.id} 
                    className={`FRAME_NOTIF_ITEM ${isRead ? 'read' : 'unread'}`}
                    onClick={() => handleNotificationClick(n)}
                    style={{ 
                      display: 'flex', 
                      padding: '15px', 
                      borderBottom: '1px solid #f1f5f9', 
                      cursor: 'pointer',
                      backgroundColor: isRead ? '#ffffff' : '#f0f9ff',
                      transition: 'background-color 0.2s'
                    }}
                  >
                    <div className="FRAME_NOTIF_ICON" style={{ marginRight: '15px', fontSize: '1.2rem', color: isRead ? '#94a3b8' : '#3b82f6', paddingTop: '2px' }}>
                      <i className={getIconClass(n.type)}></i>
                    </div>
                    <div className="FRAME_NOTIF_CONTENT" style={{ flex: 1 }}>
                      <p className="FRAME_NOTIF_TITLE" style={{ margin: '0 0 5px 0', fontSize: '0.95rem', fontWeight: isRead ? 'normal' : 'bold', color: '#0f172a' }}>{n.title}</p>
                      <p className="FRAME_NOTIF_MSG" style={{ margin: '0 0 8px 0', fontSize: '0.85rem', color: '#475569', lineHeight: 1.4 }}>{n.message}</p>
                      <span className="FRAME_NOTIF_TIME" style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                        {new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    {!isRead && <div className="FRAME_NOTIF_DOT" style={{ width: '8px', height: '8px', backgroundColor: '#3b82f6', borderRadius: '50%', marginTop: '5px' }}></div>}
                  </div>
                );
              })
            )}
          </div>
          
          <div className="FRAME_NOTIF_FOOTER" style={{ padding: '10px', textAlign: 'center', borderTop: '1px solid #e2e8f0', backgroundColor: '#f8fafc' }}>
            <button onClick={() => { setShowNotifs(false); onNavigate('Notification Center'); }} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 'bold' }}>
              History <i className="fas fa-history" style={{ marginLeft: '5px' }}></i>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdministratorNotification;