import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ApiService } from '../api'; // 🎯 THE FIX: Import ApiService for direct fetching
import "./Styles/Community_Notification.css";

interface NotificationProps {
  notifications?: any[]; 
  blotters: any[];
  documents: any[];
}

const Community_Notification: React.FC<NotificationProps> = ({ notifications: dbNotifications = [], blotters, documents }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  // 🎯 THE FIX: Add local state to hold the instantly fetched notifications
  const [liveNotifications, setLiveNotifications] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // ── 🛡️ CLOSE ON CLICK OUTSIDE ──
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ── 🛡️ PRIORITIZED FIRST FETCH ──
  // This bypasses the parent dashboard and grabs notifications immediately on mount
  useEffect(() => {
    const fetchLatestNotifications = async () => {
      try {
        setIsLoading(true);
        const data = await ApiService.getNotifications();
        if (data) {
          setLiveNotifications(data);
        }
      } catch (err) {
        console.error("Fast Notification Fetch Error:", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchLatestNotifications();
  }, []);

  // 🛡️ SYNC WITH PARENT: If the parent dashboard eventually loads and sends new notifications, update the local state
  useEffect(() => {
    if (dbNotifications && dbNotifications.length > 0) {
      setLiveNotifications(dbNotifications);
    }
  }, [dbNotifications]);

  // ── 🔍 GENERATE NOTIFICATIONS FROM DATA ──
  const notificationsList = useMemo(() => {
    const list: any[] = [];
    const now = new Date(); // Current time to check against expirations

    // 1. 🛡️ REAL DATABASE NOTIFICATIONS (Using the instantly fetched state)
    liveNotifications?.forEach((notif) => {
      
      // EXPIRATION CHECK: If an expiration date exists and has passed, hide it immediately
      const isExpired = notif.expires_at ? new Date(notif.expires_at) < now : false;

      // Only show unread, non-expired notifications
      if (!notif.is_read && !isExpired) {
        let icon = 'fas fa-bell';
        let color = '#3b82f6'; // Default blue

        // Match the icon/color to the type
        if (notif.type === 'document') {
          icon = 'fas fa-file-alt';
          color = '#10b981'; // Green
        } else if (notif.type === 'blotter') {
          icon = 'fas fa-shield-alt';
          color = '#f59e0b'; // Orange
        }

        list.push({
          id: `db-${notif.id}`,
          type: notif.type,
          title: notif.title,
          message: notif.message,
          time: notif.created_at ? new Date(notif.created_at).toLocaleDateString() : 'New',
          icon: icon,
          color: color
        });
      }
    });

    // 2. CHECK DOCUMENTS (Fallback for Ready Pickup)
    documents?.forEach((doc, index) => {
      if (doc.status?.toLowerCase() === 'ready') {
        list.push({
          id: `doc-${doc.id || doc.reference_no || index}`, 
          type: 'document',
          title: 'Document Ready',
          message: `Your ${doc.type} is ready for pickup at the barangay hall.`,
          time: 'Action Required',
          icon: 'fas fa-file-export',
          color: '#10b981'
        });
      }
    });

    // 3. CHECK BLOTTERS (Fallback for Hearings)
    blotters?.forEach((caseItem, index) => {
      if (caseItem.status?.toLowerCase() === 'hearing') {
        list.push({
          id: `blot-${caseItem.id || caseItem.case_no || caseItem.case_number || index}`, 
          type: 'blotter',
          title: 'Hearing Scheduled',
          message: `A hearing is scheduled for Case #${caseItem.case_no || caseItem.case_number || 'Pending'}.`,
          time: 'Check Schedule',
          icon: 'fas fa-gavel',
          color: '#f59e0b'
        });
      }
    });

    return list;
  }, [liveNotifications, blotters, documents]);

  const unreadCount = notificationsList.length;

  return (
    <div className="CM_NOTIF_CONTAINER" ref={dropdownRef}>
      {/* ── BELL TRIGGER ── */}
      <button 
        className={`CM_NOTIF_BELL_BTN ${isOpen ? 'ACTIVE' : ''}`} 
        onClick={() => setIsOpen(!isOpen)}
      >
        <i className="fas fa-bell" />
        {unreadCount > 0 && <span className="CM_NOTIF_BADGE">{unreadCount}</span>}
      </button>

      {/* ── DROPDOWN MENU ── */}
      <div className={`CM_NOTIF_DROPDOWN ${isOpen ? 'OPEN' : ''}`}>
        <header className="NOTIF_DROPDOWN_HEADER">
          <h3>Notifications</h3>
          {unreadCount > 0 && <span className="UNREAD_LBL">{unreadCount} New</span>}
        </header>

        <div className="NOTIF_LIST_AREA">
          {isLoading ? (
            <div className="NOTIF_EMPTY_STATE" style={{ opacity: 0.7 }}>
               <i className="fas fa-circle-notch fa-spin" />
               <p>Syncing updates...</p>
            </div>
          ) : notificationsList.length > 0 ? (
            notificationsList.map((notif) => (
              <div key={notif.id} className="NOTIF_ITEM">
                <div className="NOTIF_ICON_BOX" style={{ backgroundColor: `${notif.color}15`, color: notif.color }}>
                  <i className={notif.icon} />
                </div>
                <div className="NOTIF_BODY">
                  <div className="NOTIF_TOP">
                    <strong>{notif.title}</strong>
                    <span className="NOTIF_TIME">{notif.time}</span>
                  </div>
                  <p>{notif.message}</p>
                </div>
              </div>
            ))
          ) : (
            <div className="NOTIF_EMPTY_STATE">
              <i className="fas fa-bell-slash" />
              <p>You're all caught up!</p>
              <span>No new updates at this time.</span>
            </div>
          )}
        </div>

        <footer className="NOTIF_DROPDOWN_FOOTER">
          <p>Engineer's Hill Digital Portal v2026</p>
        </footer>
      </div>
    </div>
  );
};

export default Community_Notification;