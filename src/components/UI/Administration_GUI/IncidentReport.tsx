import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { FileComponent } from '../../buttons/Tools/Admin_Incident_Report'; 
import './styles/IncidentReport.css';
import { ApiService } from '../api'; 

interface IIncidentCase {
  id: string;
  case_number: string;
  complainant_name: string;
  complainant_id?: string;
  respondent: string;
  incident_type: string;
  status: 'Pending' | 'Active' | 'Hearing' | 'Settled' | 'Archived' | 'Rejected'; 
  origin: 'Walk-in' | 'Online';
  date_filed: string;
  time_filed?: string;
  narrative?: string;
  hearing_date?: string;
  hearing_time?: string;
  rejection_reason?: string;
}

const ITEMS_PER_PAGE = 10;

interface IncidentPageProps {
  highlightId?: string;
}

export default function IncidentReportPage({ highlightId }: IncidentPageProps) {
  const [cases, setCases] = useState<IIncidentCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  
  // 🛡️ PIPELINE TABS: Exclusively Active States
  const [activeTab, setActiveTab] = useState<'Pending' | 'Active' | 'Hearing'>('Active');
  
  const [currentPage, setCurrentPage] = useState(1);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedCase, setSelectedCase] = useState<IIncidentCase | null>(null);

  const [hearingModal, setHearingModal] = useState({
    isOpen: false, caseId: '', date: '', time: '09:00'
  });

  const [rejectModal, setRejectModal] = useState({
    isOpen: false, caseId: '', reason: ''
  });

  const [activeHighlight, setActiveHighlight] = useState<string | null>(null);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  const isFetchingCases = useRef(false);
  const isMounted = useRef(true);
  const processedHighlightId = useRef<string | null>(null);

  const fetchCases = useCallback(async (silent = false, signal?: AbortSignal) => {
    if (!isMounted.current || isFetchingCases.current) return;
    
    if (!silent) setLoading(true);
    isFetchingCases.current = true;

    try {
      const rawData = await ApiService.getBlotters(signal);
      
      if (isMounted.current && rawData !== null) {
        const mappedData = rawData.map((c: any) => {
          let rawStatus = c.status || 'Pending';
          const normalizedStatus = rawStatus.charAt(0).toUpperCase() + rawStatus.slice(1).toLowerCase();
          
          const caseNum = c.case_number || '';
          let docOrigin: 'Walk-in' | 'Online' = 'Walk-in';

          if (caseNum.startsWith('ON-INC')) {
            docOrigin = 'Online';
          } else if (caseNum.startsWith('WK-INC')) {
            docOrigin = 'Walk-in';
          } else {
            docOrigin = (c.complainant_id === 'WALK-IN' || !c.complainant_id) ? 'Walk-in' : 'Online';
          }

          return {
            ...c,
            id: c.id || c.record_id || c.case_id || c.blotter_id || c.incident_id || caseNum || 'UNKNOWN_ID',
            case_number: caseNum || 'PENDING_REG',
            complainant_name: c.complainant_name || 'Unknown Complainant',
            status: normalizedStatus,
            origin: docOrigin,
            date_filed: c.date_filed || c.created_at || new Date().toISOString()
          };
        });

        setCases(mappedData);
        setError('');
      }
    } catch (fetchError: any) {
      if (fetchError.name !== 'AbortError' && isMounted.current) {
        console.error("[INCIDENT SYNC ERROR]:", fetchError);
        setError("Failed to sync with local database registry.");
      }
    } finally {
      isFetchingCases.current = false;
      if (isMounted.current) setLoading(false);
    }
  }, []);

  // 🛡️ THE TARGETING ENGINE (With Archive Guard)
  useEffect(() => {
    if (highlightId && processedHighlightId.current !== highlightId && cases.length > 0) {
      const targetCase = cases.find(c => String(c.id) === String(highlightId) || c.case_number === highlightId);
      
      if (targetCase) {
        processedHighlightId.current = highlightId; 

        // 🛡️ THE FIX: Ignore notifications for cases that have already been vanished
        if (['Settled', 'Rejected', 'Archived'].includes(targetCase.status)) {
            console.warn("Targeted case is already in the Archive Vault.");
            return;
        }

        const validTabs = ['Pending', 'Active', 'Hearing'];
        if (validTabs.includes(targetCase.status)) {
          setActiveTab(targetCase.status as any);
        }

        setSearchTerm(targetCase.case_number);
        setCurrentPage(1);

        setActiveHighlight(highlightId);
        const timer = setTimeout(() => setActiveHighlight(null), 3000);
        return () => clearTimeout(timer);
      }
    }
  }, [highlightId, cases]);

  useEffect(() => {
    const handleClickOutside = () => setOpenDropdownId(null);
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

  useEffect(() => {
    isMounted.current = true;
    const valve = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout>;

    const runPulse = async () => {
      if (!isMounted.current) return;
      if (document.visibilityState === 'visible') {
        await fetchCases(true, valve.signal);
      }
      if (isMounted.current) {
        timeoutId = setTimeout(runPulse, 30000); 
      }
    };

    fetchCases(false, valve.signal).then(() => {
      if (isMounted.current) timeoutId = setTimeout(runPulse, 1000);
    });

    return () => {
      isMounted.current = false;
      valve.abort();
      clearTimeout(timeoutId);
    };
  }, [fetchCases]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchTerm]);

  const stats = useMemo(() => ({
    pending: cases.filter(c => c.status === 'Pending').length,
    active: cases.filter(c => c.status === 'Active').length,
    hearing: cases.filter(c => c.status === 'Hearing').length
  }), [cases]);

  const filteredCases = useMemo(() => {
    return cases.filter((c) => {
      // 🛡️ THE GHOST PROTOCOL: Instantly drop terminal states to clear the pipeline
      if (['Settled', 'Rejected', 'Archived'].includes(c.status)) return false;

      const matchSearch = `${c.case_number} ${c.complainant_name} ${c.respondent}`.toLowerCase().includes(searchTerm.toLowerCase());
      return matchSearch && c.status === activeTab;
    });
  }, [cases, activeTab, searchTerm]);

  const totalPages = Math.ceil(filteredCases.length / ITEMS_PER_PAGE);
  const paginatedCases = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredCases.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredCases, currentPage]);

  const handleStatusUpdate = async (caseId: string, payloadUpdates: any) => {
    if (!caseId || caseId === 'UNKNOWN_ID' || caseId === 'undefined') {
        alert("Registry Error: Missing valid Case ID. Cannot perform update.");
        return;
    }

    try {
      const result = await ApiService.saveBlotter(caseId, payloadUpdates);
      if (result.success) {
        fetchCases(true); 
      } else {
        alert(`Registry Refused: ${result.error || 'Check server logs.'}`);
      }
    } catch (err) { 
      alert("Network handshake failed. Retrying sync..."); 
    }
  };

  const submitHearing = () => {
    if (!hearingModal.date) return alert("Select a date.");
    handleStatusUpdate(hearingModal.caseId, {
        status: 'Hearing', 
        hearing_date: hearingModal.date, 
        hearing_time: hearingModal.time 
    });
    setHearingModal(prev => ({ ...prev, isOpen: false }));
  };

  const submitRejection = () => {
    if (!rejectModal.reason.trim()) return alert("Official reason required.");
    handleStatusUpdate(rejectModal.caseId, {
        status: 'Rejected', 
        rejection_reason: rejectModal.reason 
    });
    setRejectModal(prev => ({ ...prev, isOpen: false }));
  };

  return (
    <div className="AD-BLOT_PAGE_WRAP">
      <div className="AD-BLOT_MAIN_CONTAINER">

        <header className="AD-BLOT_HEADER_FLEX">
          <div>
            <h1 className="AD-BLOT_PAGE_TITLE">Incident Reports</h1>
            <p className="AD-BLOT_PAGE_SUB">Managing active <strong>WK-INC</strong> (Walk-in) and <strong>ON-INC</strong> (Online) registries.</p>
          </div>
          <button className="AD-BLOT_ADD_BTN" onClick={() => { setSelectedCase(null); setIsModalOpen(true); }}>
            <i className="fas fa-file-signature"></i> File Walk-in Report
          </button>
        </header>

        {/* ── KPI METRICS (Active Only) ── */}
        <section className="AD-BLOT_STATS_GRID">
          <div className={`AD-BLOT_STAT_CARD AD-BLOT_CLICKABLE ${activeTab === 'Pending' ? 'AD-BLOT_ACTIVE_CARD' : ''}`} onClick={() => setActiveTab('Pending')}>
            <div className="AD-BLOT_STAT_INFO">
              <span className="AD-BLOT_STAT_NUM">{stats.pending}</span>
              <span className="AD-BLOT_STAT_LABEL">Pending Online</span>
            </div>
            <div className="AD-BLOT_STAT_ICON_WRAP AD-BLOT_ICON_YELLOW"><i className="fas fa-globe"></i></div>
          </div>

          <div className={`AD-BLOT_STAT_CARD AD-BLOT_CLICKABLE ${activeTab === 'Active' ? 'AD-BLOT_ACTIVE_CARD' : ''}`} onClick={() => setActiveTab('Active')}>
            <div className="AD-BLOT_STAT_INFO">
              <span className="AD-BLOT_STAT_NUM">{stats.active}</span>
              <span className="AD-BLOT_STAT_LABEL">Active Registry</span>
            </div>
            <div className="AD-BLOT_STAT_ICON_WRAP AD-BLOT_ICON_RED"><i className="fas fa-folder-open"></i></div>
          </div>

          <div className={`AD-BLOT_STAT_CARD AD-BLOT_CLICKABLE ${activeTab === 'Hearing' ? 'AD-BLOT_ACTIVE_CARD' : ''}`} onClick={() => setActiveTab('Hearing')}>
            <div className="AD-BLOT_STAT_INFO">
              <span className="AD-BLOT_STAT_NUM">{stats.hearing}</span>
              <span className="AD-BLOT_STAT_LABEL">Scheduled</span>
            </div>
            <div className="AD-BLOT_STAT_ICON_WRAP AD-BLOT_ICON_BLUE"><i className="fas fa-gavel"></i></div>
          </div>
        </section>

        {/* ── FILTER TOOLS ── */}
        <section className="AD-BLOT_SEARCH_ROW">
          <div className="AD-BLOT_TABS_ROW">
            {(['Pending', 'Active', 'Hearing'] as const).map(tab => (
              <button key={tab} className={`AD-BLOT_TAB_BTN ${activeTab === tab ? 'AD-BLOT_ACTIVE' : ''}`} onClick={() => setActiveTab(tab)}>
                {tab}
              </button>
            ))}
          </div>

          <div className="AD-BLOT_SEARCH_WRAP">
             <i className="fas fa-search AD-BLOT_SEARCH_ICON"></i>
             <input
              className="AD-BLOT_SEARCH_INPUT"
              placeholder="Search active cases or prefix (WK/ON)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </section>

        {/* ── DATA CORE ── */}
        <main className="AD-BLOT_TABLE_CONTAINER">
          <div className="AD-BLOT_TABLE_WRAP">
            <table className="AD-BLOT_TABLE_MAIN">
              <thead>
                <tr>
                  <th>INCIDENT REGISTRY</th>
                  <th>COMPLAINANT</th>
                  <th>RESPONDENT</th>
                  <th>TYPE</th>
                  <th>{activeTab === 'Hearing' ? 'HEARING SCHEDULE' : 'FILED DATE'}</th>
                  <th>STATUS</th>
                  <th style={{ textAlign: 'right', paddingRight: '2rem' }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {loading && cases.length === 0 ? (
                  <tr><td colSpan={7} className="AD-BLOT_TABLE_EMPTY"><div className="AD-BLOT_SYNC_SPINNER"></div>Updating registry...</td></tr>
                ) : error ? (
                  <tr><td colSpan={7} className="AD-BLOT_TABLE_EMPTY" style={{color: 'var(--AD-BLOT-clr-danger)'}}>{error}</td></tr>
                ) : paginatedCases.length === 0 ? (
                  <tr><td colSpan={7} className="AD-BLOT_TABLE_EMPTY" style={{ textAlign: 'center', padding: '4rem' }}>No active records found in {activeTab.toUpperCase()} queue.</td></tr>
                ) : (
                  paginatedCases.map((c) => {
                    const isGlowing = activeHighlight === String(c.id) || activeHighlight === String(c.case_number);

                    return (
                      <tr 
                        key={c.id} 
                        className={`AD-BLOT_CLICKABLE_ROW ${isGlowing ? 'AD-BLOT_HINT_HIGHLIGHT' : ''}`}
                        onClick={() => { setSelectedCase(c); setIsModalOpen(true); setOpenDropdownId(null); }}
                      >
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-start' }}>
                            <span className="AD-BLOT_CASE_NUMBER">{c.case_number}</span>
                            <span className={`AD-BLOT_ORIGIN_BADGE ${c.origin === 'Online' ? 'ONLINE' : 'WALKIN'}`}>
                              <i className={c.origin === 'Online' ? 'fas fa-globe' : 'fas fa-walking'}></i> {c.origin.toUpperCase()}
                            </span>
                          </div>
                        </td>
                        <td><strong>{c.complainant_name}</strong></td>
                        <td>{c.respondent}</td>
                        <td>{c.incident_type}</td>
                        <td className="AD-BLOT_DATE_CELL">
                          {activeTab === 'Hearing'
                            ? `${c.hearing_date ? new Date(c.hearing_date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : 'NOT SET'} @ ${c.hearing_time || '—'}`
                            : new Date(c.date_filed).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
                          }
                        </td>
                        <td><span className={`AD-BLOT_STATUS_BADGE AD-BLOT_STATUS_${c.status.toUpperCase()}`}>{c.status}</span></td>
                        
                        <td style={{ position: 'relative', textAlign: 'right', paddingRight: '1rem' }}>
                          <button 
                            className="AD-BLOT_ACTION_MENU_BTN"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenDropdownId(openDropdownId === c.id ? null : c.id);
                            }}
                          >
                            Manage <i className="fas fa-chevron-down" style={{ marginLeft: '6px', fontSize: '0.7rem' }}></i>
                          </button>

                          {openDropdownId === c.id && (
                            <div className="AD-BLOT_DROPDOWN_MENU" onClick={(e) => e.stopPropagation()}>
                              <button onClick={() => { setSelectedCase(c); setIsModalOpen(true); setOpenDropdownId(null); }}>
                                <i className="fas fa-file-invoice"></i> View Full Dossier
                              </button>

                              {c.status === 'Pending' && (
                                <button className="PRIMARY" onClick={() => { handleStatusUpdate(c.id, { status: 'Active' }); setOpenDropdownId(null); }}>
                                  <i className="fas fa-check-double"></i> Accept & Activate
                                </button>
                              )}

                              {(c.status === 'Active' || c.status === 'Hearing') && (
                                <button onClick={() => { setHearingModal({ isOpen: true, caseId: c.id, date: c.hearing_date || '', time: c.hearing_time || '09:00' }); setOpenDropdownId(null); }}>
                                  <i className="fas fa-calendar-check"></i> {c.status === 'Hearing' ? 'Update Schedule' : 'Schedule Hearing'}
                                </button>
                              )}

                              {/* 🛡️ Explicitly marked as Archive actions */}
                              {c.status === 'Hearing' && (
                                <button className="SUCCESS" onClick={() => { handleStatusUpdate(c.id, { status: 'Settled' }); setOpenDropdownId(null); }}>
                                  <i className="fas fa-handshake"></i> Mark as Settled (Archive)
                                </button>
                              )}

                              {(c.status === 'Pending' || c.status === 'Active') && (
                                <button className="DANGER" onClick={() => { setRejectModal({ isOpen: true, caseId: c.id, reason: '' }); setOpenDropdownId(null); }}>
                                  <i className="fas fa-trash-alt"></i> Deny Entry (Archive)
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="AD-BLOT_PAGINATION_BAR">
            <div className="AD-BLOT_PAGINATION_INFO">
              Viewing {paginatedCases.length > 0 ? (currentPage - 1) * ITEMS_PER_PAGE + 1 : 0} to {Math.min(currentPage * ITEMS_PER_PAGE, filteredCases.length)} of {filteredCases.length} active entries
            </div>
            <div className="AD-BLOT_NAV_GROUP">
              <button className="AD-BLOT_NAV_BTN" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}><i className="fas fa-chevron-left"></i> Previous</button>
              <span className="AD-BLOT_PAGE_INDICATOR">Page {currentPage} of {totalPages || 1}</span>
              <button className="AD-BLOT_NAV_BTN" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}>Next <i className="fas fa-chevron-right"></i></button>
            </div>
          </div>
        </main>
      </div>

      {/* ── MODAL OVERLAYS ── */}
      {isModalOpen && (
        <FileComponent
          onClose={() => setIsModalOpen(false)}
          onRefresh={() => fetchCases(true)}
          selectedCase={selectedCase}
        />
      )}

      {hearingModal.isOpen && (
        <div className="AD-BLOT_MODAL_OVERLAY" onClick={() => setHearingModal(p => ({ ...p, isOpen: false }))}>
          <div className="AD-BLOT_SIMPLE_MODAL" onClick={e => e.stopPropagation()}>
            <h3 className="AD-BLOT_MODAL_TITLE">Schedule Case Hearing</h3>
            <label className="AD-BLOT_MODAL_LABEL">Meeting Date</label>
            <input type="date" value={hearingModal.date} onChange={e => setHearingModal(p => ({ ...p, date: e.target.value }))} />
            <label className="AD-BLOT_MODAL_LABEL">Meeting Time</label>
            <input type="time" value={hearingModal.time} onChange={e => setHearingModal(p => ({ ...p, time: e.target.value }))} />
            <div className="AD-BLOT_MODAL_ACTIONS">
              <button className="AD-BLOT_PAGE_BTN" onClick={() => setHearingModal(p => ({ ...p, isOpen: false }))}>Dismiss</button>
              <button className="AD-BLOT_ADD_BTN" onClick={submitHearing}>Apply Schedule</button>
            </div>
          </div>
        </div>
      )}

      {rejectModal.isOpen && (
        <div className="AD-BLOT_MODAL_OVERLAY" onClick={() => setRejectModal(p => ({ ...p, isOpen: false }))}>
          <div className="AD-BLOT_SIMPLE_MODAL" onClick={e => e.stopPropagation()}>
            <h3 className="AD-BLOT_MODAL_TITLE" style={{ color: 'var(--AD-BLOT-clr-danger)' }}>Decline Incident Report</h3>
            <label className="AD-BLOT_MODAL_LABEL">Official Statement of Refusal</label>
            <textarea rows={4} value={rejectModal.reason} placeholder="State why this report is being rejected..." onChange={e => setRejectModal(p => ({ ...p, reason: e.target.value }))} />
            <div className="AD-BLOT_MODAL_ACTIONS">
              <button className="AD-BLOT_PAGE_BTN" onClick={() => setRejectModal(p => ({ ...p, isOpen: false }))}>Cancel</button>
              <button className="AD-BLOT_ADD_BTN" onClick={submitRejection} style={{ backgroundColor: 'var(--AD-BLOT-clr-danger)' }}>Reject & Archive</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}