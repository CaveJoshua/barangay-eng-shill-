import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiService } from '../api';
import "./Styles/CommunityNotification.css";

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE MAP — adjust paths to match your actual React Router routes
// ─────────────────────────────────────────────────────────────────────────────
const NOTIF_ROUTE_MAP: Record<string, string> = {
  document: '/documents',
  blotter:  '/blotter',
  default:  '/dashboard',
};

// ─────────────────────────────────────────────────────────────────────────────
// HIGHLIGHT HOOK — paste this call into Documents.tsx and Blotter.tsx:
//
//   import { useNotificationHighlight } from '../components/Community_Notification';
//   // inside the component (top level):
//   useNotificationHighlight();
//
// Also add  data-row-id={item.id}  to every table row / card in those pages.
// The hook reads sessionStorage, waits for the row to render, then scrolls
// to it and fires the  .notif-highlight-row  CSS animation.
// ─────────────────────────────────────────────────────────────────────────────
const _HL_KEY = '__notif_target__';

export const useNotificationHighlight = (): void => {
  useEffect(() => {
    const raw = sessionStorage.getItem(_HL_KEY);
    if (!raw) return;

    let target: { id: string; ts: number };
    try { target = JSON.parse(raw); } catch { return; }

    // Ignore if stale (user navigated manually, not via a notification click)
    if (Date.now() - target.ts > 5_000) {
      sessionStorage.removeItem(_HL_KEY);
      return;
    }
    sessionStorage.removeItem(_HL_KEY);

    // Retry until the row is in the DOM (async data loads), then scroll + pulse
    const tryHighlight = (attempt = 0) => {
      const el = document.querySelector<HTMLElement>(`[data-row-id="${target.id}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('notif-highlight-row');
        setTimeout(() => el.classList.remove('notif-highlight-row'), 2_800);
      } else if (attempt < 14) {
        setTimeout(() => tryHighlight(attempt + 1), 150); // retries up to ~2 s
      }
    };
    tryHighlight();
  }, []);
};

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────
interface NotificationProps {
  notifications?: any[];
  blotters:        any[];
  documents:       any[];
}

interface NotifItem {
  id:      string; // composed key e.g. "db-42", "doc-7"
  rawId:   string; // original DB / prop ID used for API calls & row matching
  type:    string;
  title:   string;
  message: string;
  time:    string;
  icon:    string;
  color:   string;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
const Community_Notification: React.FC<NotificationProps> = ({
  notifications: dbNotifications = [],
  blotters,
  documents,
}) => {
  const navigate = useNavigate();

  const [isOpen,            setIsOpen]       = useState(false);
  const [liveNotifications, setLiveNotifs]   = useState<any[]>([]);
  const [dismissedIds,      setDismissedIds] = useState<Set<string>>(new Set());
  const [isLoading,         setIsLoading]    = useState(true);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ── CLOSE ON CLICK OUTSIDE ──────────────────────────────────────────────────
  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node))
        setIsOpen(false);
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  // ── FAST FIRST FETCH ────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        setIsLoading(true);
        const data = await ApiService.getNotifications();
        if (data) setLiveNotifs(data);
      } catch (err) {
        console.error('[Notification] Fetch error:', err);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // ── SYNC WITH PARENT ────────────────────────────────────────────────────────
  useEffect(() => {
    if (dbNotifications?.length > 0) setLiveNotifs(dbNotifications);
  }, [dbNotifications]);

  // ── BUILD NOTIFICATION LIST ─────────────────────────────────────────────────
  const notificationsList = useMemo<NotifItem[]>(() => {
    const list: NotifItem[] = [];
    const now = new Date();

    // 1. Real DB notifications
    liveNotifications?.forEach((n) => {
      if (n.is_read || (n.expires_at && new Date(n.expires_at) < now)) return;
      const id = `db-${n.id}`;
      if (dismissedIds.has(id)) return;

      let icon = 'fas fa-bell', color = '#3b82f6';
      if (n.type === 'document') { icon = 'fas fa-file-alt';   color = '#10b981'; }
      if (n.type === 'blotter')  { icon = 'fas fa-shield-alt'; color = '#f59e0b'; }

      list.push({
        id, rawId: String(n.id), type: n.type,
        title:   n.title,
        message: n.message,
        time:    n.created_at ? new Date(n.created_at).toLocaleDateString() : 'New',
        icon, color,
      });
    });

    // 2. Document fallbacks (ready for pickup)
    documents?.forEach((doc, i) => {
      if (doc.status?.toLowerCase() !== 'ready') return;
      const id = `doc-${doc.id ?? doc.reference_no ?? i}`;
      if (dismissedIds.has(id)) return;
      list.push({
        id, rawId: String(doc.id ?? doc.reference_no ?? i), type: 'document',
        title:   'Document Ready',
        message: `Your ${doc.type} is ready for pickup at the barangay hall.`,
        time:    'Action Required', icon: 'fas fa-file-export', color: '#10b981',
      });
    });

    // 3. Blotter fallbacks (hearing scheduled)
    blotters?.forEach((c, i) => {
      if (c.status?.toLowerCase() !== 'hearing') return;
      const id = `blot-${c.id ?? c.case_no ?? c.case_number ?? i}`;
      if (dismissedIds.has(id)) return;
      list.push({
        id, rawId: String(c.id ?? c.case_no ?? c.case_number ?? i), type: 'blotter',
        title:   'Hearing Scheduled',
        message: `A hearing is scheduled for Case #${c.case_no ?? c.case_number ?? 'Pending'}.`,
        time:    'Check Schedule', icon: 'fas fa-gavel', color: '#f59e0b',
      });
    });

    return list;
  }, [liveNotifications, blotters, documents, dismissedIds]);

  const unreadCount = notificationsList.length;

  // ── HANDLERS ────────────────────────────────────────────────────────────────

  /**
   * Clicking a notification card:
   *  1. Optimistically removes it from the list.
   *  2. Calls markNotificationRead (fire-and-forget for DB items).
   *  3. Writes the target ID to sessionStorage so the destination page
   *     can scroll to and pulse the matching row.
   *  4. Navigates to the correct page.
   */
  const handleNotificationClick = (notif: NotifItem) => {
    // Optimistic removal
    if (notif.id.startsWith('db-')) {
      setLiveNotifs(prev => prev.filter(n => String(n.id) !== notif.rawId));
      ApiService.markNotificationRead(notif.rawId).catch(() => {});
    } else {
      setDismissedIds(prev => new Set(prev).add(notif.id));
    }

    // Signal destination page → scroll to & highlight this row
    sessionStorage.setItem(_HL_KEY, JSON.stringify({ id: notif.rawId, ts: Date.now() }));

    const path = NOTIF_ROUTE_MAP[notif.type] ?? NOTIF_ROUTE_MAP.default;
    navigate(path, { state: { highlightId: notif.rawId, highlightType: notif.type } });

    setIsOpen(false);
  };

  /**
   * × button: dismiss the notification in-place without navigating anywhere.
   * stopPropagation prevents the card's click handler from also firing.
   */
  const handleDismissOne = (e: React.MouseEvent, notif: NotifItem) => {
    e.stopPropagation();
    if (notif.id.startsWith('db-')) {
      setLiveNotifs(prev => prev.filter(n => String(n.id) !== notif.rawId));
      ApiService.markNotificationRead(notif.rawId).catch(() => {});
    } else {
      setDismissedIds(prev => new Set(prev).add(notif.id));
    }
  };

  /** "Clear All" button: wipe every visible notification at once. */
  const handleClearAll = () => {
    ApiService.clearAllNotifications().catch(() => {});
    setLiveNotifs([]);
    setDismissedIds(new Set(notificationsList.map(n => n.id)));
  };

  // ── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div className="CM_NOTIF_CONTAINER" ref={dropdownRef}>

      {/* BELL TRIGGER */}
      <button
        className={`CM_NOTIF_BELL_BTN ${isOpen ? 'ACTIVE' : ''}`}
        onClick={() => setIsOpen(p => !p)}
      >
        <i className="fas fa-bell" />
        {unreadCount > 0 && <span className="CM_NOTIF_BADGE">{unreadCount}</span>}
      </button>

      {/* DROPDOWN */}
      <div className={`CM_NOTIF_DROPDOWN ${isOpen ? 'OPEN' : ''}`}>

        <header className="NOTIF_DROPDOWN_HEADER">
          <h3>Notifications</h3>
          <div className="NOTIF_HEADER_RIGHT">
            {unreadCount > 0 && <span className="UNREAD_LBL">{unreadCount} New</span>}
            {unreadCount > 0 && (
              <button
                className="NOTIF_CLEAR_ALL_BTN"
                onClick={handleClearAll}
                title="Clear all notifications"
              >
                <i className="fas fa-trash-alt" />
                <span>Clear All</span>
              </button>
            )}
          </div>
        </header>

        <div className="NOTIF_LIST_AREA">
          {isLoading ? (
            <div className="NOTIF_EMPTY_STATE" style={{ opacity: 0.7 }}>
              <i className="fas fa-circle-notch fa-spin" />
              <p>Syncing updates...</p>
            </div>

          ) : notificationsList.length > 0 ? (
            notificationsList.map((notif) => (
              <div
                key={notif.id}
                className="NOTIF_ITEM"
                onClick={() => handleNotificationClick(notif)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleNotificationClick(notif)}
                title={`Go to ${notif.type}`}
              >
                <div
                  className="NOTIF_ICON_BOX"
                  style={{ backgroundColor: `${notif.color}15`, color: notif.color }}
                >
                  <i className={notif.icon} />
                </div>

                <div className="NOTIF_BODY">
                  <div className="NOTIF_TOP">
                    <strong>{notif.title}</strong>
                    <span className="NOTIF_TIME">{notif.time}</span>
                  </div>
                  <p>{notif.message}</p>
                </div>

                {/* Chevron: slides in on hover to indicate the item is navigable */}
                <i className="fas fa-chevron-right NOTIF_GOTO_ARROW" aria-hidden="true" />

                {/* × dismiss in-place without navigating */}
                <button
                  className="NOTIF_DISMISS_BTN"
                  onClick={(e) => handleDismissOne(e, notif)}
                  title="Dismiss"
                  aria-label="Dismiss notification"
                >
                  <i className="fas fa-times" />
                </button>
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
