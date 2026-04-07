import React, { useState, useMemo, useRef, useEffect } from 'react';
import "./C-Styles/Community_Notification.css";

interface NotificationProps {
  blotters: any[];
  documents: any[];
}

const Community_Notification: React.FC<NotificationProps> = ({ blotters, documents }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  // ── 🔍 GENERATE NOTIFICATIONS FROM DATA ──
  const notifications = useMemo(() => {
    const list: any[] = [];

    // 1. Check for Documents Ready for Pickup
    documents?.forEach(doc => {
      if (doc.status?.toLowerCase() === 'ready') {
        list.push({
          id: `doc-${doc.id}`,
          type: 'document',
          title: 'Document Ready',
          message: `Your ${doc.type} is ready for pickup at the barangay hall.`,
          time: 'Action Required',
          icon: 'fas fa-file-export',
          color: '#10b981'
        });
      }
    });

    // 2. Check for Blotter Hearings
    blotters?.forEach(caseItem => {
      if (caseItem.status?.toLowerCase() === 'hearing') {
        list.push({
          id: `blot-${caseItem.id}`,
          type: 'blotter',
          title: 'Hearing Scheduled',
          message: `A hearing is scheduled for Case #${caseItem.case_no || 'Pending'}.`,
          time: 'Check Schedule',
          icon: 'fas fa-gavel',
          color: '#f59e0b'
        });
      }
    });

    return list;
  }, [blotters, documents]);

  const unreadCount = notifications.length;

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
          {notifications.length > 0 ? (
            notifications.map((notif) => (
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