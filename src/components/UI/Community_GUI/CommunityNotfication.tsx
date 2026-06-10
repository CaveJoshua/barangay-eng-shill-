import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ApiService } from '../api';
import "./Styles/CommunityNotification.css";

// ─────────────────────────────────────────────────────────────────────────────
// TARGET VIEW MAP — the community dashboard is tab/view-based (not route-based),
// exactly like the Administration dashboard. A notification click hands the host
// dashboard the destination view + a target reference; the destination page then
// scrolls to / glows the matching card (mirrors the Admin "Documents → Notification"
// highlight effect).
// ─────────────────────────────────────────────────────────────────────────────
export type CommunityNotifView = 'Documents' | 'Blotter';

const NOTIF_VIEW_MAP: Record<string, CommunityNotifView> = {
  document: 'Documents',
  blotter:  'Blotter',
  incident: 'Blotter',
};

// Sentinel handed to the destination page when the notification carries no
// resolvable reference — the page then glows the resident's most recent request
// of that kind ("highlight the recent requested").
const HL_LATEST = '__LATEST__';

// Reference / case-number extractor (same family of prefixes the Admin feed uses):
//   Documents  → ON-LN-0042 / WK-IN-0042
//   Incidents  → ON-INC-… / WK-INC-…
const REF_REGEX = /(ON-INC|WK-INC|ON-LN|WK-IN|BLTR|INCD|BLT|TMP|REF|BL)-[A-Z0-9-]+/i;
const extractRef = (text = ''): string => (text.match(REF_REGEX)?.[0] || '').toUpperCase();

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────
interface NotificationProps {
  notifications?: any[];
  blotters:        any[];
  documents:       any[];
  /**
   * Host dashboard callback. Switches the visible view and passes the target
   * reference (record id, reference number, or the HL_LATEST sentinel) the
   * destination page uses to scroll to & highlight the matching request card.
   */
  onNavigate?: (view: CommunityNotifView, highlightRef: string) => void;
}

interface NotifItem {
  id:      string; // composed key e.g. "db-42", "doc-7"
  rawId:   string; // original DB / prop ID used for API calls & dismissal
  target:  string; // reference/id the destination page matches the row against
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
  onNavigate,
}) => {
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

      // Resident DB notifications rarely carry a reference in their text. Pull one
      // out when present (e.g. "Case #ON-INC-… is now Active"); otherwise fall back
      // to the most-recent matching request via the HL_LATEST sentinel.
      const ref = extractRef(`${n.title || ''} ${n.message || ''}`);

      // No embedded reference → fall back to "most recent", but keep the sentinel
      // unique per notification so clicking a different one always re-fires the glow.
      const target = ref || `${HL_LATEST}:${n.id}`;

      list.push({
        id, rawId: String(n.id), target, type: n.type,
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
        id, rawId: String(doc.id ?? doc.reference_no ?? i),
        target: String(doc.reference_no ?? doc.control_no ?? doc.id ?? HL_LATEST),
        type: 'document',
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
        id, rawId: String(c.id ?? c.case_no ?? c.case_number ?? i),
        target: String(c.case_no ?? c.case_number ?? c.id ?? HL_LATEST),
        type: 'blotter',
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
   *  3. Hands the host dashboard the destination view + target reference so the
   *     matching request card scrolls into view and pulses (same effect as the
   *     Administration "Documents ← Notification" highlighter).
   */
  const handleNotificationClick = (notif: NotifItem) => {
    // Optimistic removal
    if (notif.id.startsWith('db-')) {
      setLiveNotifs(prev => prev.filter(n => String(n.id) !== notif.rawId));
      ApiService.markNotificationRead(notif.rawId).catch(() => {});
    } else {
      setDismissedIds(prev => new Set(prev).add(notif.id));
    }

    // Hand off to the dashboard → switch view + highlight the target card.
    const view = NOTIF_VIEW_MAP[notif.type] ?? 'Documents';
    onNavigate?.(view, notif.target);

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
