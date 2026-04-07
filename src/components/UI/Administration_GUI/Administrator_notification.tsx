import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ApiService } from '../api';

// Polling interval set to 10 seconds for that "Automatic" feel
const NOTIF_POLL_INTERVAL = 10000; 

interface AdminNotifProps {
  // 🛡️ THE FIX: Added highlightId to match your Notification System
  onNavigate: (tabName: string, highlightId?: string) => void;
}

// Interface matching the Unified Live Feed from Notification.js
interface LiveNotification {
  id: string;         // e.g., "doc-5" or "blt-12"
  originalId: string; // The actual ID in the database (used for hinting)
  title: string;
  message: string;
  type: 'document' | 'blotter'; 
  timestamp: string;
  status: string;
}

const AdministratorNotification: React.FC<AdminNotifProps> = ({ onNavigate }) => {
  const [notifications, setNotifications] = useState<LiveNotification[]>([]);
  const [readIds, setReadIds] = useState<string[]>(() => {
    // Load previously read IDs from browser memory
    const saved = localStorage.getItem('admin_read_notif_ids');
    return saved ? JSON.parse(saved) : [];
  });
  const [showNotifs, setShowNotifs] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  
  const notifsControllerRef = useRef<AbortController | null>(null);
  const notifsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 💾 Sync read IDs to local storage whenever they change
  useEffect(() => {
    localStorage.setItem('admin_read_notif_ids', JSON.stringify(readIds));
  }, [readIds]);

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

  // ─── DIRECT FETCH LOGIC ───
  const fetchLiveNotifs = useCallback(async () => {
    if (notifsControllerRef.current) notifsControllerRef.current.abort();
    notifsControllerRef.current = new AbortController();

    try {
      // Connects to your new GET /alerts/live endpoint via ApiService
      const liveData = await ApiService.getNotifications(notifsControllerRef.current.signal);
      
      if (liveData && Array.isArray(liveData)) {
        setNotifications(liveData);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') console.error("[NOTIFS] Direct Link Error:", err);
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

  // Calculate unread count by checking if ID exists in readIds array
  const unreadCount = notifications.filter(n => !readIds.includes(n.id)).length;

  // 🚀 HANDSHAKE: Mark as read locally and navigate with Highlight Hint
  const handleNotificationClick = (n: LiveNotification) => {
    if (!readIds.includes(n.id)) {
      setReadIds(prev => [...prev, n.id]);
    }

    setShowNotifs(false);

    // 🛡️ THE FIX: Pass the originalId so the target page can highlight the row
    if (n.type === 'document') {
      onNavigate('Document', String(n.originalId)); 
    } else if (n.type === 'blotter') {
      onNavigate('Blotter Cases', String(n.originalId)); 
    }
  };

  const handleMarkAllRead = () => {
    const allIds = notifications.map(n => n.id);
    setReadIds(prev => Array.from(new Set([...prev, ...allIds])));
  };

  const getIconClass = (type: string) => {
    return type === 'document' ? "fas fa-file-alt" : "fas fa-gavel";
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
            <h4>Live Feed</h4>
            {unreadCount > 0 && (
              <button onClick={handleMarkAllRead} className="FRAME_NOTIF_MARKALL">
                Clear All
              </button>
            )}
          </div>
          
          <div className="FRAME_NOTIF_BODY">
            {notifications.length === 0 ? (
              <div className="FRAME_NOTIF_EMPTY">
                <i className="fas fa-check-circle"></i>
                <p>No pending requests.</p>
              </div>
            ) : (
              // 🛡️ THE FIX: Slice to 5 so the dropdown doesn't become overwhelmingly long
              notifications.slice(0, 5).map((n) => {
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
            {/* 🛡️ THE FIX: Navigate to the full Notification Center History page */}
            <button onClick={() => { setShowNotifs(false); onNavigate('Notification Center'); }}>
              View All History <i className="fas fa-history" style={{ marginLeft: '5px' }}></i>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdministratorNotification;