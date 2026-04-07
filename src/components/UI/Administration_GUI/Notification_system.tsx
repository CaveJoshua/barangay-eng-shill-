import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ApiService } from '../api';
import './styles/Notification_system.css';

// ─── INTERFACES ──────────────────────────────────────────────────────────────

interface LiveNotification {
  id: string;         // Prefixed ID (e.g., 'doc-5' or 'blt-12')
  originalId: string; // The raw Database UUID or ID (used for the hint animation)
  title: string;
  message: string;
  type: 'document' | 'blotter'; 
  timestamp: string;  
  status: string;
}

const NOTIF_POLL_INTERVAL = 30000; // Poll every 30 seconds for the full page

interface NotificationSystemProps {
  // onNavigate now accepts an optional highlightId to trigger the animation
  onNavigate?: (tabName: string, highlightId?: string) => void;
}

const NotificationSystem: React.FC<NotificationSystemProps> = ({ onNavigate }) => {
  const [notifications, setNotifications] = useState<LiveNotification[]>([]);
  const [loading, setLoading] = useState(true);
  
  // ─── FILTERS ───
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'UNREAD'>('ALL');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'document' | 'blotter'>('ALL');
  
  // Local storage handshake: Track IDs that the admin has already "read"
  const [readIds, setReadIds] = useState<string[]>(() => {
    const saved = localStorage.getItem('admin_read_notif_ids');
    return saved ? JSON.parse(saved) : [];
  });

  const controllerRef = useRef<AbortController | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 💾 Persist read IDs to local storage whenever they change
  useEffect(() => {
    localStorage.setItem('admin_read_notif_ids', JSON.stringify(readIds));
  }, [readIds]);

  // ─── DATA FETCHING (HANDSHAKE) ─────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    // Abort previous hanging requests before starting a new pulse
    if (pollTimer.current) clearTimeout(pollTimer.current);
    if (controllerRef.current) controllerRef.current.abort();
    
    controllerRef.current = new AbortController();

    try {
      const data = await ApiService.getNotifications(controllerRef.current.signal);
      
      if (data && Array.isArray(data)) {
        setNotifications(data);
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') console.error("[NOTIFS] Direct Link Sync Error:", error);
    } finally {
      setLoading(false);
      
      // Re-queue the pulse only if the tab is currently active
      if (document.visibilityState === 'visible') {
        pollTimer.current = setTimeout(fetchData, NOTIF_POLL_INTERVAL);
      }
    }
  }, []);

  useEffect(() => {
    fetchData();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchData(); 
      } else if (pollTimer.current) {
        clearTimeout(pollTimer.current); 
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
      if (controllerRef.current) controllerRef.current.abort();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchData]);

  // ─── EVENT HANDLERS ────────────────────────────────────────────────────────
  const handleNotificationClick = (n: LiveNotification) => {
    // Mark as read locally if not already done
    if (!readIds.includes(n.id)) {
      setReadIds(prev => [...prev, n.id]);
    }

    // Smart Routing logic: Send the user to the correct page AND pass the ID for the animation
    if (onNavigate) {
      const destination = n.type === 'document' ? 'Document' : 'Blotter Cases';
      onNavigate(destination, n.originalId); 
    }
  };

  const handleMarkAllRead = () => {
    // Collect all visible notification IDs based on current filters
    const allVisibleIds = notifications.map(n => n.id);
    setReadIds(prev => Array.from(new Set([...prev, ...allVisibleIds])));
  };

  // ─── DUAL FILTER LOGIC ───
  const filteredNotifs = notifications.filter(n => {
    const matchesStatus = statusFilter === 'ALL' || !readIds.includes(n.id);
    const matchesType = typeFilter === 'ALL' || n.type === typeFilter;
    return matchesStatus && matchesType;
  });

  const unreadCount = notifications.filter(n => !readIds.includes(n.id)).length;

  const getIconClass = (type: string) => {
    return type === 'document' ? "fas fa-file-alt" : "fas fa-balance-scale";
  };

  return (
    <div className="DS_CONTAINER">
      <header className="DS_HEADER">
        <h1 className="DS_TITLE">Notification Center</h1>
        <p className="DS_SUBTITLE">Review live updates and history from Document and Blotter registries.</p>
      </header>

      <div className="DS_SECTION_BOX NS_SECTION_BOX">
        
        {/* ─── CONTROLS HEADER ─── */}
        <div className="DS_SECTION_HEADER NS_HEADER_CONTROLS">
          <div className="NS_FILTER_GROUP">
            
            {/* Status Filters */}
            <div className="NS_SUB_FILTER">
              <button 
                onClick={() => setStatusFilter('ALL')}
                className={`NS_FILTER_BTN ${statusFilter === 'ALL' ? 'NS_FILTER_BTN--active' : 'NS_FILTER_BTN--inactive'}`}
              >
                All History
              </button>
              <button 
                onClick={() => setStatusFilter('UNREAD')}
                className={`NS_FILTER_BTN ${statusFilter === 'UNREAD' ? 'NS_FILTER_BTN--active' : 'NS_FILTER_BTN--inactive'}`}
              >
                Unread {unreadCount > 0 && `(${unreadCount})`}
              </button>
            </div>

            <div className="NS_DIVIDER"></div>

            {/* Type Filters */}
            <div className="NS_SUB_FILTER">
              <button 
                onClick={() => setTypeFilter('ALL')} 
                className={`NS_TYPE_BTN ${typeFilter === 'ALL' ? 'active' : ''}`}
              >
                All Types
              </button>
              <button 
                onClick={() => setTypeFilter('document')} 
                className={`NS_TYPE_BTN ${typeFilter === 'document' ? 'active' : ''}`}
              >
                <i className="fas fa-file-invoice"></i> Documents
              </button>
              <button 
                onClick={() => setTypeFilter('blotter')} 
                className={`NS_TYPE_BTN ${typeFilter === 'blotter' ? 'active' : ''}`}
              >
                <i className="fas fa-gavel"></i> Incidents
              </button>
            </div>

          </div>
          
          {unreadCount > 0 && (
            <button onClick={handleMarkAllRead} className="NS_MARKALL_BTN">
              <i className="fas fa-check-double"></i> Mark All as Seen
            </button>
          )}
        </div>

        {/* ─── LIST BODY ─── */}
        <div className="NS_BODY">
          {loading ? (
            <div className="NS_STATE_MESSAGE">
              <i className="fas fa-spinner fa-spin fa-2x"></i>
              <p>Fetching live feed...</p>
            </div>
          ) : filteredNotifs.length === 0 ? (
            <div className="NS_STATE_MESSAGE">
              <i className="fas fa-inbox fa-3x"></i>
              <h3>No records found</h3>
              <p>Try adjusting your filters or checking back later.</p>
            </div>
          ) : (
            <ul className="NS_LIST">
              {filteredNotifs.map((n) => {
                const isRead = readIds.includes(n.id);
                return (
                  <li 
                    key={n.id} 
                    className={`NS_ITEM ${isRead ? 'NS_ITEM--read' : 'NS_ITEM--unread'}`}
                    onClick={() => handleNotificationClick(n)}
                    style={{ cursor: onNavigate ? 'pointer' : 'default' }}
                  >
                    <div className={`NS_ITEM_ICON ${isRead ? 'NS_ITEM_ICON--read' : 'NS_ITEM_ICON--unread'} ${n.type}`}>
                      <i className={getIconClass(n.type)}></i>
                    </div>
                    
                    <div className="NS_ITEM_CONTENT">
                      <div className="NS_ITEM_HEADER">
                        <span className="NS_ITEM_TITLE">{n.title}</span>
                        <span className="NS_ITEM_DATE">
                          {new Date(n.timestamp).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="NS_ITEM_TEXT">{n.message}</p>
                    </div>
                    
                    {!isRead && (
                      <div className="NS_UNREAD_INDICATOR">
                        <i className="fas fa-circle"></i>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

      </div>
    </div>
  );
};

export default NotificationSystem;