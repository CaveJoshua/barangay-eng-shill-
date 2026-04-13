import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ApiService } from '../api';
import './styles/Notification_system.css';

// ─── INTERFACES ──────────────────────────────────────────────────────────────
interface DatabaseNotification {
  id: number | string; 
  user_id: string;
  title: string;
  message: string;
  type: string; 
  is_read: boolean;
  created_at: string;  
}

const NOTIF_POLL_INTERVAL = 30000; // Poll every 30 seconds

interface NotificationSystemProps {
  onNavigate?: (tabName: string, highlightId?: string) => void;
}

const NotificationSystem: React.FC<NotificationSystemProps> = ({ onNavigate }) => {
  const [notifications, setNotifications] = useState<DatabaseNotification[]>([]);
  const [loading, setLoading] = useState(true);
  
  // ─── FILTERS ───
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'UNREAD'>('ALL');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'document' | 'blotter'>('ALL');

  const controllerRef = useRef<AbortController | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── DATA FETCHING ─────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    if (controllerRef.current) controllerRef.current.abort();
    
    controllerRef.current = new AbortController();

    try {
      // Backend automatically applies the "Online Sensor" filter for Admin/Staff
      const data = await ApiService.getNotifications(controllerRef.current.signal);
      if (data && Array.isArray(data)) {
        setNotifications(data);
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') console.error("[NOTIFS] Database Sync Error:", error);
    } finally {
      setLoading(false);
      if (document.visibilityState === 'visible') {
        pollTimer.current = setTimeout(fetchData, NOTIF_POLL_INTERVAL);
      }
    }
  }, []);

  useEffect(() => {
    fetchData();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') fetchData(); 
      else if (pollTimer.current) clearTimeout(pollTimer.current); 
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
      if (controllerRef.current) controllerRef.current.abort();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchData]);

  // ─── EVENT HANDLERS ───────────────────────────────────────────────
  
  const handleNotificationClick = async (n: DatabaseNotification) => {
    if (!n.is_read) {
      try {
        setNotifications(prev => prev.map(notif => notif.id === n.id ? { ...notif, is_read: true } : notif));
        await ApiService.markNotificationRead(String(n.id));
      } catch (err) {
        console.error("Failed to mark read", err);
      }
    }

    if (onNavigate) {
      const normalizedType = (n.type || '').toLowerCase();
      // 🛡️ SYNC: Corrected destination names to match your Sidebar tabs
      const destination = normalizedType === 'document' ? 'Document' : 'Incident Reports';
      
      // 🛡️ SYNC: Pass the reference number hint if it exists in the message
      const refMatch = n.message.match(/Ref:\s*([A-Z0-9-]+)/i);
      onNavigate(destination, refMatch ? refMatch[1] : undefined); 
    }
  };

  const handleMarkAllRead = async () => {
    const unreadVisible = filteredNotifs.filter(n => !n.is_read);
    if (unreadVisible.length === 0) return;

    const unreadIds = unreadVisible.map(n => n.id);
    setNotifications(prev => prev.map(n => unreadIds.includes(n.id) ? { ...n, is_read: true } : n));

    try {
      await ApiService.markAllNotificationsRead();
    } catch (err) {
      console.error("Failed to mark all as read");
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: number | string) => {
    e.stopPropagation(); 
    if (!window.confirm("Permanently delete this notification record?")) return;

    try {
      setNotifications(prev => prev.filter(n => n.id !== id));
      await ApiService.deleteNotification(String(id));
    } catch (err) {
      alert("Database error: Record could not be removed.");
      fetchData();
    }
  };

  // ─── FILTER LOGIC ───
  const filteredNotifs = notifications.filter(n => {
    const matchesStatus = statusFilter === 'ALL' || !n.is_read;
    const safeType = (n.type || 'system').toLowerCase();
    const matchesType = typeFilter === 'ALL' || safeType === typeFilter;
    return matchesStatus && matchesType;
  });

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const getIconClass = (type: string) => {
    const t = (type || '').toLowerCase();
    if (t === 'document') return "fas fa-file-alt";
    if (t === 'blotter') return "fas fa-balance-scale";
    return "fas fa-info-circle";
  };

  return (
    <div className="DS_CONTAINER">
      <header className="DS_HEADER">
        <h1 className="DS_TITLE">Notification Center</h1>
        <p className="DS_SUBTITLE">Review live updates and online requests from the community portal.</p>
      </header>

      <div className="DS_SECTION_BOX NS_SECTION_BOX">
        
        <div className="DS_SECTION_HEADER NS_HEADER_CONTROLS">
          <div className="NS_FILTER_GROUP">
            
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

            <div className="NS_SUB_FILTER">
              <button onClick={() => setTypeFilter('ALL')} className={`NS_TYPE_BTN ${typeFilter === 'ALL' ? 'active' : ''}`}>
                All Types
              </button>
              <button onClick={() => setTypeFilter('document')} className={`NS_TYPE_BTN ${typeFilter === 'document' ? 'active' : ''}`}>
                <i className="fas fa-file-invoice"></i> Documents
              </button>
              <button onClick={() => setTypeFilter('blotter')} className={`NS_TYPE_BTN ${typeFilter === 'blotter' ? 'active' : ''}`}>
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

        <div className="NS_BODY">
          {loading ? (
            <div className="NS_STATE_MESSAGE">
              <i className="fas fa-spinner fa-spin fa-2x"></i>
              <p>Synchronizing with database...</p>
            </div>
          ) : filteredNotifs.length === 0 ? (
            <div className="NS_STATE_MESSAGE">
              <i className="fas fa-satellite-dish fa-3x"></i>
              <h3>No Online Requests Found</h3>
              <p>The sensor is active. New portal requests will appear here in real-time.</p>
            </div>
          ) : (
            <ul className="NS_LIST">
              {filteredNotifs.map((n) => (
                <li 
                  key={n.id} 
                  className={`NS_ITEM ${n.is_read ? 'NS_ITEM--read' : 'NS_ITEM--unread'}`}
                  onClick={() => handleNotificationClick(n)}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '15px', flex: 1 }}>
                    <div className={`NS_ITEM_ICON ${n.is_read ? 'NS_ITEM_ICON--read' : 'NS_ITEM_ICON--unread'} ${(n.type || '').toLowerCase()}`}>
                      <i className={getIconClass(n.type)}></i>
                    </div>
                    
                    <div className="NS_ITEM_CONTENT">
                      <div className="NS_ITEM_HEADER">
                        <span className="NS_ITEM_TITLE">{n.title}</span>
                        <span className="NS_ITEM_DATE">
                          {new Date(n.created_at).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="NS_ITEM_TEXT">{n.message}</p>
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '15px', paddingLeft: '15px' }}>
                    {!n.is_read && (
                      <div className="NS_UNREAD_INDICATOR">
                        <i className="fas fa-circle"></i>
                      </div>
                    )}
                    <button 
                      onClick={(e) => handleDelete(e, n.id)}
                      className="NS_DELETE_BTN"
                    >
                      <i className="fas fa-trash-alt"></i>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

      </div>
    </div>
  );
};

export default NotificationSystem;