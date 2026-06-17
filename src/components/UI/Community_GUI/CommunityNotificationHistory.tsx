import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ApiService } from '../api';
import type { CommunityNotifView } from './CommunityNotfication';
import './Styles/CommunityNotificationHistory.css';

// ─────────────────────────────────────────────────────────────────────────────
// Community "Notification Center" — full history with type navigation, mirroring
// the Administration NotificationSystem. Lets a resident review every alert and
// jump straight into the related Document or Incident (with the glow highlight).
// ─────────────────────────────────────────────────────────────────────────────
interface HistoryProps {
  onBack: () => void;
  /** Same handler the bell uses → switches view + glows the matching request card. */
  onNavigate: (view: CommunityNotifView, highlightRef: string) => void;
}

interface NotifRow {
  id: string | number;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  created_at: string;
}

type StatusFilter = 'ALL' | 'UNREAD';
type TypeFilter = 'ALL' | 'document' | 'blotter';

// Reference extractor + "most recent" sentinel — kept in lock-step with the bell.
const REF_REGEX = /(ON-INC|WK-INC|ON-LN|WK-IN|BLTR|INCD|BLT|TMP|REF|BL)-[A-Z0-9-]+/i;
const HL_LATEST = '__LATEST__';

const iconFor = (type: string): string => {
  const t = (type || '').toLowerCase();
  if (t === 'document') return 'fas fa-file-alt';
  if (t === 'blotter' || t === 'incident') return 'fas fa-gavel';
  return 'fas fa-bell';
};

const colorFor = (type: string): string => {
  const t = (type || '').toLowerCase();
  if (t === 'document') return '#10b981';
  if (t === 'blotter' || t === 'incident') return '#f59e0b';
  return '#3b82f6';
};

const Community_Notification_History: React.FC<HistoryProps> = ({ onBack, onNavigate }) => {
  const [rows, setRows] = useState<NotifRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const isFetching = useRef(false);

  const fetchAll = useCallback(async () => {
    if (isFetching.current) return;
    isFetching.current = true;
    try {
      const data = await ApiService.getNotifications();
      if (Array.isArray(data)) {
        setRows(
          data.map((n: any) => ({
            id: n.id,
            title: n.title || 'System Alert',
            message: n.message || '',
            type: (n.type || 'system').toLowerCase(),
            is_read: !!n.is_read,
            created_at: n.created_at || new Date().toISOString(),
          })),
        );
      }
    } catch {
      /* silent — keeps whatever is already on screen */
    } finally {
      setLoading(false);
      isFetching.current = false;
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const unreadCount = useMemo(() => rows.filter(n => !n.is_read).length, [rows]);

  const filtered = useMemo(() => rows.filter(n => {
    const okStatus = statusFilter === 'ALL' || !n.is_read;
    const t = n.type;
    const okType =
      typeFilter === 'ALL' ||
      (typeFilter === 'document' && t === 'document') ||
      (typeFilter === 'blotter' && (t === 'blotter' || t === 'incident'));
    return okStatus && okType;
  }), [rows, statusFilter, typeFilter]);

  // ── HANDLERS ────────────────────────────────────────────────────────────────
  const handleOpen = (n: NotifRow) => {
    if (!n.is_read) {
      setRows(prev => prev.map(r => (r.id === n.id ? { ...r, is_read: true } : r)));
      ApiService.markNotificationRead(String(n.id)).catch(() => {});
    }

    const t = n.type;
    if (t !== 'document' && t !== 'blotter' && t !== 'incident') return; // system → no jump

    const view: CommunityNotifView = t === 'document' ? 'Documents' : 'Blotter';
    const ref = (`${n.title} ${n.message}`.match(REF_REGEX)?.[0] || `${HL_LATEST}:${n.id}`).toUpperCase();
    onNavigate(view, ref);
  };

  const handleMarkAll = () => {
    if (unreadCount === 0) return;
    setRows(prev => prev.map(r => ({ ...r, is_read: true })));
    ApiService.markAllNotificationsRead().catch(() => {});
  };

  const handleDelete = (e: React.MouseEvent, id: string | number) => {
    e.stopPropagation();
    setRows(prev => prev.filter(r => r.id !== id));
    ApiService.deleteNotification(String(id)).catch(() => fetchAll());
  };

  const handleClearAll = () => {
    if (rows.length === 0) return;
    if (!window.confirm('Clear your entire notification history? This cannot be undone.')) return;
    setRows([]);
    ApiService.clearAllNotifications().catch(() => fetchAll());
  };

  const isJumpable = (t: string) => t === 'document' || t === 'blotter' || t === 'incident';

  // ── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div className="CM_NH_CONTAINER">

      <header className="CM_NH_HEADER_CARD">
        <button className="CM_NH_BACK_BTN" onClick={onBack} title="Back to bulletin">
          <i className="fas fa-arrow-left" />
        </button>
        <div className="CM_NH_HEADER_TEXT">
          <h1>Notification History</h1>
          <p>Review every update and open the related document or incident directly.</p>
        </div>
        {rows.length > 0 && (
          <button className="CM_NH_CLEAR_BTN" onClick={handleClearAll} title="Clear all history">
            <i className="fas fa-trash-alt" /> <span>Clear All</span>
          </button>
        )}
      </header>

      {/* ── TOOLBAR: STATUS + TYPE FILTERS ── */}
      <div className="CM_NH_TOOLBAR">
        <div className="CM_NH_FILTER_GROUP CM_NH_STATUS_GROUP">
          <button
            className={`CM_NH_FILTER_BTN ${statusFilter === 'ALL' ? 'ACTIVE' : ''}`}
            onClick={() => setStatusFilter('ALL')}
          >
            All History
          </button>
          <button
            className={`CM_NH_FILTER_BTN ${statusFilter === 'UNREAD' ? 'ACTIVE' : ''}`}
            onClick={() => setStatusFilter('UNREAD')}
          >
            Unread {unreadCount > 0 && `(${unreadCount})`}
          </button>
        </div>

        <div className="CM_NH_DIVIDER" />

        <div className="CM_NH_FILTER_GROUP CM_NH_TYPE_GROUP">
          <button
            className={`CM_NH_TYPE_BTN ${typeFilter === 'ALL' ? 'ACTIVE' : ''}`}
            onClick={() => setTypeFilter('ALL')}
          >
            All Types
          </button>
          <button
            className={`CM_NH_TYPE_BTN ${typeFilter === 'document' ? 'ACTIVE' : ''}`}
            onClick={() => setTypeFilter('document')}
          >
            <i className="fas fa-file-invoice" /> Documents
          </button>
          <button
            className={`CM_NH_TYPE_BTN ${typeFilter === 'blotter' ? 'ACTIVE' : ''}`}
            onClick={() => setTypeFilter('blotter')}
          >
            <i className="fas fa-gavel" /> Incidents
          </button>
        </div>

        {unreadCount > 0 && (
          <button className="CM_NH_MARKALL_BTN" onClick={handleMarkAll}>
            <i className="fas fa-check-double" /> Mark All as Seen
          </button>
        )}
      </div>

      {/* ── LIST ── */}
      <div className="CM_NH_LIST">
        {loading ? (
          <div className="CM_NH_STATE">
            <i className="fas fa-circle-notch fa-spin" />
            <p>Loading your notification history…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="CM_NH_STATE">
            <i className="fas fa-bell-slash" />
            <h3>Nothing to show here</h3>
            <p>No notifications match the selected filters.</p>
          </div>
        ) : (
          filtered.map((n) => {
            const color = colorFor(n.type);
            return (
              <div
                key={n.id}
                className={`CM_NH_ITEM ${n.is_read ? 'READ' : 'UNREAD'} ${isJumpable(n.type) ? 'JUMPABLE' : ''}`}
                onClick={() => handleOpen(n)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleOpen(n)}
                title={isJumpable(n.type) ? `Open related ${n.type === 'document' ? 'document' : 'incident'}` : undefined}
              >
                <div className="CM_NH_ICON" style={{ backgroundColor: `${color}1A`, color }}>
                  <i className={iconFor(n.type)} />
                </div>

                <div className="CM_NH_BODY">
                  <div className="CM_NH_TOP">
                    <strong>{n.title}</strong>
                    <span className="CM_NH_DATE">
                      {new Date(n.created_at).toLocaleString('en-PH', {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <p>{n.message}</p>
                  {isJumpable(n.type) && (
                    <span className="CM_NH_JUMP_HINT">
                      Open {n.type === 'document' ? 'document' : 'incident'} <i className="fas fa-arrow-right" />
                    </span>
                  )}
                </div>

                {!n.is_read && <span className="CM_NH_UNREAD_DOT" aria-label="Unread" />}

                <button
                  className="CM_NH_DELETE_BTN"
                  onClick={(e) => handleDelete(e, n.id)}
                  title="Delete this notification"
                  aria-label="Delete notification"
                >
                  <i className="fas fa-times" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default Community_Notification_History;
