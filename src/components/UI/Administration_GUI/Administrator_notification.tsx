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
  
  // 💾 Memory for Read Notifications - Wrapped in try/catch for safety
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

  // ─── DIRECT FETCH LOGIC WITH SMART SENSOR ───
  const fetchLiveNotifs = useCallback(async () => {
    if (notifsControllerRef.current) notifsControllerRef.current.abort();
    notifsControllerRef.current = new AbortController();

    try {
      const liveData = await ApiService.getNotifications(notifsControllerRef.current.signal);
      
      if (liveData && Array.isArray(liveData)) {
        // 🛡️ THE SMART SENSOR: Map backend fields and extract Case/Ref numbers for highlighting
        const mappedNotifs: LiveNotification[] = liveData.map((item: any) => {
          const msg = item.message || '';
          
          /**
           * 📡 ENHANCED REGEX SENSOR
           * Automatically detects all your case prefixes: BLTR, BL, INCD, TMP, ON-LN, WK-IN, or REF
           * This allows the "Highlight Glow" to work even if the message format changes slightly.
           */
          const caseMatch = msg.match(/(BLTR|BL|INCD|TMP|BLT|ON-LN|WK-IN|REF)-[A-Z0-9]+/i);
          const extractedRef = caseMatch ? caseMatch[0] : String(item.id);

          return {
            id: String(item.id),
            originalId: extractedRef, 
            title: item.title || 'System Alert',
            message: msg,
            type: (item.type || 'system').toLowerCase(),
            timestamp: item.created_at || new Date().toISOString(),
            status: item.is_read ? 'read' : 'unread'
          };
        });

        setNotifications(mappedNotifs);

        // Sync backend read state
        const backendReadIds = mappedNotifs.filter(n => n.status === 'read').map(n => n.id);
        if (backendReadIds.length > 0) {
            setReadIds(prev => Array.from(new Set([...prev, ...backendReadIds])));
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') console.error("[NOTIFS] Sync Failure:", err.message);
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

  // 🛡️ Hide cleared items
  const visibleNotifications = notifications.filter(n => !clearedIds.includes(n.id));
  
  // Count only unread visible items
  const unreadCount = visibleNotifications.filter(n => !readIds.includes(n.id)).length;

  // 🚀 HANDSHAKE: Mark read locally and navigate with Highlight Hint
  const handleNotificationClick = async (n: LiveNotification) => {
    if (!readIds.includes(n.id)) {
      setReadIds(prev => [...prev, n.id]);
      try { 
        if (ApiService.markNotificationRead) await ApiService.markNotificationRead(n.id); 
      } catch(e) { console.error("Could not update read status on server"); }
    }

    setShowNotifs(false);

    // 🛡️ Pipeline Routing
    const normalizedType = n.type.toLowerCase();
    if (normalizedType === 'document') {
      onNavigate('Document', n.originalId); 
    } else if (normalizedType === 'blotter' || normalizedType === 'incident') {
      onNavigate('Incident Reports', n.originalId); 
    }
  };

  // 🛡️ Clear entire feed for the current session
  const handleClearAll = async () => {
    const allVisibleIds = visibleNotifications.map(n => n.id);
    
    setReadIds(prev => Array.from(new Set([...prev, ...allVisibleIds])));
    setClearedIds(prev => Array.from(new Set([...prev, ...allVisibleIds])));

    try { 
      if (ApiService.clearAllNotifications) await ApiService.clearAllNotifications(); 
    } catch(e) { console.error("Global clear failed"); }
  };

  const getIconClass = (type: string) => {
    const t = type.toLowerCase();
    if (t === 'document') return "fas fa-file-alt";
    if (t === 'blotter' || t === 'incident') return "fas fa-balance-scale";
    return "fas fa-info-circle";
  };

  return (
    <div className="FRAME_NOTIF_WRAP" ref={notifRef}>
      <button className="FRAME_NOTIF_BTN" onClick={() => setShowNotifs(!showNotifs)}>
        <i className="fas fa-bell"></i>
        {unreadCount > 0 && (
          <span className="FRAME_NOTIF_BADGE animate-pulse">
            {unreadCount}
          </span>
        )}
      </button>

      {showNotifs && (
        <div className="FRAME_NOTIF_DROPDOWN">
          <div className="FRAME_NOTIF_HEADER">
            <h4>Notification Feed</h4>
            {visibleNotifications.length > 0 && (
              <button onClick={handleClearAll} className="FRAME_NOTIF_MARKALL">
                Clear All
              </button>
            )}
          </div>
          
          <div className="FRAME_NOTIF_BODY">
            {visibleNotifications.length === 0 ? (
              <div className="FRAME_NOTIF_EMPTY">
                <i className="fas fa-satellite-dish"></i>
                <p>No active online requests.</p>
              </div>
            ) : (
              visibleNotifications.slice(0, 8).map((n) => {
                const isRead = readIds.includes(n.id);
                return (
                  <div 
                    key={n.id} 
                    className={`FRAME_NOTIF_ITEM ${isRead ? 'read' : 'unread'}`}
                    onClick={() => handleNotificationClick(n)}
                  >
                    <div className={`FRAME_NOTIF_ICON ${n.type}`}>
                      <i className={getIconClass(n.type)}></i>
                    </div>
                    <div className="FRAME_NOTIF_CONTENT">
                      <p className="FRAME_NOTIF_TITLE">{n.title}</p>
                      <p className="FRAME_NOTIF_MSG">{n.message}</p>
                      <span className="FRAME_NOTIF_TIME">
                        {new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    {!isRead && <div className="FRAME_NOTIF_DOT"></div>}
                  </div>
                );
              })
            )}
          </div>
          
          <div className="FRAME_NOTIF_FOOTER">
            <button onClick={() => { setShowNotifs(false); onNavigate('Notification Center'); }}>
              View Archive <i className="fas fa-history" style={{ marginLeft: '5px' }}></i>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdministratorNotification;