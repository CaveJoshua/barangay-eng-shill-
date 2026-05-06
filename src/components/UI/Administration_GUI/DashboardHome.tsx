import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ApiService } from '../api';

export interface DashboardStats {
  totalPopulation: number;
  documentsIssued: number;
  blotterCases: number;
  systemActivities: number;
}

export interface DashboardData {
  stats: DashboardStats;
  barangayName: string;
  systemName: string;
  adminName: string;
}

export interface IDocRequest {
  id: string;
  referenceNo: string;
  residentName: string;
  type: string;
  dateRequested: string;
  status: string;
}

const TYPE_ABBR: Record<string, string> = {
  'Barangay Clearance':        'CLRNC',
  'Certificate of Residency':  'RESID',
  'Certificate of Indigency':  'INDGN',
  'Barangay Certification':    'BSPMT',
  'Certificate of Good Moral': 'GMCRT',
};

const typeAbbr = (t: string) => TYPE_ABBR[t] ?? t.slice(0, 5).toUpperCase();

// ─── 🛡️ BULLETPROOF SESSION PARSER (same logic as Dashboard.tsx) ─────────────
const parseAdminSession = () => {
  try {
    const sessionStr = localStorage.getItem('admin_session');
    if (!sessionStr) return { name: 'Administrator', position: 'Official' };

    const session  = JSON.parse(sessionStr);
    const profile  = session?.profile  || session?.user?.profile || {};
    const userNode = session?.user     || session || {};

    const firstName = profile?.first_name || userNode?.first_name || '';
    const lastName  = profile?.last_name  || userNode?.last_name  || '';
    const combined  = firstName && lastName ? `${firstName} ${lastName}` : '';

    const fullName =
      combined                 ||
      profile?.profileName     ||
      profile?.full_name       ||
      session?.full_name       ||
      userNode?.full_name      ||
      userNode?.username       ||
      session?.username        ||
      'Administrator';

    const rawRole  = userNode?.role || session?.role || '';
    const position =
      profile?.position ||
      session?.position ||
      (rawRole.toLowerCase() === 'superadmin' ? 'Superadmin' : '') ||
      'Official';

    const resolvedPosition =
      rawRole.toLowerCase() === 'superadmin' ? 'Superadmin' : position || 'Official';

    return { name: fullName, position: resolvedPosition };
  } catch (e) {
    return { name: 'Administrator', position: 'Official' };
  }
};

// ─── PENDING ROW ─────────────────────────────────────────────────────────────

const PendingRow: React.FC<{ doc: IDocRequest; index: number; onClick: () => void }> = ({
  doc, index, onClick,
}) => {
  const d        = new Date(doc.dateRequested);
  const datePart = isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
  const timePart = isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true });

  return (
    <li className="PR_ROW" onClick={onClick} style={{ animationDelay: `${index * 55}ms` }}>
      <div className="PR_ROW__INDEX">{index + 1}</div>
      <div className="PR_ROW__BADGE">{typeAbbr(doc.type)}</div>
      <div className="PR_ROW__MAIN">
        <span className="PR_ROW__NAME">{doc.residentName}</span>
        <span className="PR_ROW__TYPE">{doc.type}</span>
      </div>
      <div className="PR_ROW__META">
        <span className="PR_ROW__DATE">{datePart}</span>
        <span className="PR_ROW__TIME">{timePart}</span>
      </div>
      <div className="PR_ROW__REF">{doc.referenceNo}</div>
    </li>
  );
};

// ─── MAIN HOME COMPONENT ─────────────────────────────────────────────────────

interface DashboardHomeProps {
  data: DashboardData;
  loading: boolean;
  onNavigate: (tabName: string) => void;
}

const DashboardHome: React.FC<DashboardHomeProps> = ({ data, loading, onNavigate }) => {

  // Parse identity once on mount — no async, no flicker
  const { name: sessionName, position: sessionRole } = parseAdminSession();

  const [pendingDocs, setPendingDocs] = useState<IDocRequest[]>(() => {
    try {
      const cached = localStorage.getItem('pr_queue_cache');
      return cached ? JSON.parse(cached) : [];
    } catch { return []; }
  });

  const [totalPending, setTotalPending] = useState(() => {
    const c = localStorage.getItem('pr_total_cache');
    return c ? parseInt(c, 10) : 0;
  });

  const [pendingLoading, setPendingLoading] = useState(
    () => !localStorage.getItem('pr_queue_cache')
  );

  const pollTimer      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerRef  = useRef<AbortController | null>(null);

  const hasDataChanged = (a: IDocRequest[], b: IDocRequest[]) =>
    a.length !== b.length || JSON.stringify(a) !== JSON.stringify(b);

  const fetchData = useCallback(async () => {
    if (controllerRef.current) controllerRef.current.abort();
    controllerRef.current = new AbortController();
    try {
      const rawDocs = await ApiService.getDocuments(controllerRef.current.signal);
      if (!rawDocs) return;

      const allPending = rawDocs.filter((d: any) => {
        const ref = d.reference_no || d.referenceNo || d.tracking_code || '';
        return d.status === 'Pending' && !ref.includes('WK-IN');
      });

      const sortedTop5: IDocRequest[] = allPending
        .sort((a: any, b: any) =>
          new Date(b.date_requested || b.dateRequested).getTime() -
          new Date(a.date_requested || a.dateRequested).getTime()
        )
        .slice(0, 5)
        .map((d: any) => ({
          id:            d.id || 'N/A',
          referenceNo:   d.reference_no || d.referenceNo || `UNKNOWN-${Math.random()}`,
          residentName:  d.resident_name || d.residentName || 'Unknown',
          type:          d.type,
          dateRequested: d.date_requested || d.dateRequested,
          status:        d.status,
        }));

      setPendingDocs(prev => {
        if (hasDataChanged(sortedTop5, prev)) {
          localStorage.setItem('pr_queue_cache', JSON.stringify(sortedTop5));
          return sortedTop5;
        }
        return prev;
      });

      setTotalPending(prev => {
        if (prev !== allPending.length) {
          localStorage.setItem('pr_total_cache', allPending.length.toString());
          return allPending.length;
        }
        return prev;
      });
    } catch (err: any) {
      if (err.name !== 'AbortError') console.error('[DASHBOARD] Sync Error:', err);
    } finally {
      setPendingLoading(false);
      if (document.visibilityState === 'visible') {
        pollTimer.current = setTimeout(fetchData, 8000);
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

  const stats = [
    { label: 'Total Population',  val: data.stats.totalPopulation,  icon: 'fas fa-users',        variant: 'DS_VAR_BLUE',   targetTab: 'Residents' },
    { label: 'Documents Issued',  val: data.stats.documentsIssued,  icon: 'fas fa-file-invoice', variant: 'DS_VAR_PINK',   targetTab: 'Document' },
    { label: 'Blotter Cases',     val: data.stats.blotterCases,     icon: 'fas fa-gavel',        variant: 'DS_VAR_YELLOW', targetTab: 'Blotter Cases' },
    { label: 'System Activities', val: data.stats.systemActivities, icon: 'fas fa-history',      variant: 'DS_VAR_RED',    targetTab: 'Audit Log' },
  ];

  return (
    <div className="DS_CONTAINER">
      <header className="DS_HEADER">
        <div className="DS_TITLE_GROUP">
          <h1 className="DS_TITLE">{data.barangayName}</h1>
          {sessionRole.toLowerCase() === 'superadmin' && (
            <span className="DS_SUPER_BADGE">SUPERADMIN ACCESS</span>
          )}
        </div>
        <p className="DS_SUBTITLE">
          Welcome back, <strong>{loading ? '...' : sessionName}</strong>.
          <span className="DS_ROLE_TEXT"> Logged in as {sessionRole}</span>
        </p>
      </header>

      <section className="DS_STATS_GRID">
        {stats.map((stat, i) => (
          <div key={i} className="DS_CARD" onClick={() => onNavigate(stat.targetTab)}>
            <div className="DS_CARD_HEADER">
              <div className="DS_CARD_INFO">
                <span className="DS_CARD_LABEL">{stat.label}</span>
                <h2 className="DS_CARD_VALUE">{loading ? '...' : stat.val.toLocaleString()}</h2>
              </div>
              <div className={`DS_ICON_BOX ${stat.variant}`}><i className={stat.icon} /></div>
            </div>
            <button className="DS_CARD_LINK">View Details <i className="fas fa-arrow-right" /></button>
          </div>
        ))}
      </section>

      <div className="DS_BOTTOM_GRID">
        <div className="DS_SECTION_BOX">
          <div className="DS_SECTION_HEADER"><h3><i className="fas fa-map-marked-alt" /> Barangay Map</h3></div>
          <div className="DS_MAP_VIEW">
            <iframe
              title="Map"
              src="https://www.google.com/maps?q=Engineer's+Hill+Barangay+Hall+Baguio&output=embed"
              width="100%" height="100%"
              style={{ border: 0 }}
              loading="lazy"
            />
          </div>
        </div>

        <div className="DS_SECTION_BOX">
          <div className="DS_SECTION_HEADER">
            <h3><i className="fas fa-clipboard-check" /> Pending Requests</h3>
            <div className="PR_BADGE_WRAP">
              <span className="PR_COUNT_BADGE">{totalPending}</span>
              <span className="PR_COUNT_LABEL">queued</span>
            </div>
          </div>

          <div className="DS_LIST_CONTAINER">
            {pendingLoading ? (
              <div className="PR_STATE"><div className="PR_SPINNER" /><span>Syncing queue...</span></div>
            ) : pendingDocs.length === 0 ? (
              <div className="PR_STATE PR_STATE--CLEAR"><i className="fas fa-check-circle" /><span>Queue is clear</span></div>
            ) : (
              <ul className="PR_LIST">
                {pendingDocs.map((doc, i) => (
                  <PendingRow key={doc.referenceNo} doc={doc} index={i} onClick={() => onNavigate('Document')} />
                ))}
              </ul>
            )}
          </div>

          {!pendingLoading && pendingDocs.length > 0 && (
            <button className="PR_VIEW_ALL" onClick={() => onNavigate('Document')}>
              View all {totalPending} pending <i className="fas fa-arrow-right" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default DashboardHome;