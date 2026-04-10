import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { FileComponent } from '../../buttons/Tools/Blotter_File'; 
import './styles/Blotter.css';
// 🛡️ ZERO TRUST: Use the Mastermind Service
import { ApiService } from '../api'; 

// 1. Data Structure for Incident Cases matching the SQL Schema
interface IIncidentCase {
  id: string;
  case_number: string;
  complainant_name: string;
  complainant_id?: string;
  respondent: string;
  incident_type: string;
  status: 'Pending' | 'Active' | 'Hearing' | 'Settled' | 'Archived' | 'Rejected'; 
  date_filed: string;
  time_filed?: string;
  narrative?: string;
  hearing_date?: string;
  hearing_time?: string;
  rejection_reason?: string;
}

const ITEMS_PER_PAGE = 10;

// ─── 🛡️ THE FIX: Define the props so TypeScript knows to expect highlightId ───
interface IncidentPageProps {
  highlightId?: string;
}

export default function IncidentReportPage({ highlightId }: IncidentPageProps) {
  // --- STATE MANAGEMENT ---
  const [cases, setCases] = useState<IIncidentCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Tab State
  const [activeTab, setActiveTab] = useState<'Pending' | 'Active' | 'Hearing' | 'Settled' | 'Rejected'>('Pending');
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);

  // Modal Controls
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedCase, setSelectedCase] = useState<IIncidentCase | null>(null);

  // Scheduling Modal State
  const [hearingModal, setHearingModal] = useState({
    isOpen: false, caseId: '', date: '', time: '09:00'
  });

  // Rejection Modal State
  const [rejectModal, setRejectModal] = useState({
    isOpen: false, caseId: '', reason: ''
  });

  // ─── 🛡️ THE FIX: State for the Glowing Highlight ───
  const [activeHighlight, setActiveHighlight] = useState<string | null>(null);

  // ── SAFE REFS FOR THE HANDSHAKE ──
  const isFetchingCases = useRef(false);
  const isMounted = useRef(true);

  // ─── 🛡️ THE FIX: Effect to trigger and remove the highlight glow ───
  useEffect(() => {
    if (highlightId) {
      setActiveHighlight(highlightId);
      // Automatically clear the highlight after 2.5 seconds
      const timer = setTimeout(() => setActiveHighlight(null), 2500);
      return () => clearTimeout(timer);
    }
  }, [highlightId]);

  // --- DATA FETCHING (The Smart Pulse Handshake) ---
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

          return {
            ...c,
            id: c.id || c.record_id || c.case_id,
            case_number: c.case_number || 'PENDING',
            complainant_name: c.complainant_name || 'Unknown',
            status: normalizedStatus,
            date_filed: c.date_filed || c.created_at || new Date().toISOString()
          };
        });

        setCases(mappedData);
        setError('');
      }
    } catch (err: any) {
      if (err.name !== 'AbortError' && isMounted.current) {
        console.error("[INCIDENT REPORT] Sync Error:", err);
        setError("Database Sync Failed. Please check your connection.");
      }
    } finally {
      isFetchingCases.current = false;
      if (isMounted.current) setLoading(false);
    }
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
        timeoutId = setTimeout(runPulse, 20000); 
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

  // --- RESET PAGE ON FILTER CHANGE ---
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchTerm]);

  // --- FILTERING & SEARCH ---
  const stats = useMemo(() => ({
    pending: cases.filter(c => c.status === 'Pending').length,
    active: cases.filter(c => c.status === 'Active').length,
    hearing: cases.filter(c => c.status === 'Hearing').length,
    settled: cases.filter(c => c.status === 'Settled').length,
  }), [cases]);

  const filteredCases = useMemo(() => {
    return cases.filter((c) => {
      const matchSearch = `${c.case_number} ${c.complainant_name} ${c.respondent}`.toLowerCase().includes(searchTerm.toLowerCase());
      return matchSearch && c.status === activeTab;
    });
  }, [cases, activeTab, searchTerm]);

  // --- PAGINATION CALCULATION ---
  const totalPages = Math.ceil(filteredCases.length / ITEMS_PER_PAGE);
  const paginatedCases = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredCases.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredCases, currentPage]);

  // ─── 🛡️ THE FIX: PURE PARTIAL UPDATES ───
  const handleStatusUpdate = async (caseId: string, payloadUpdates: any) => {
    try {
      // Send only the exact fields that need to change directly to the API
      const result = await ApiService.saveBlotter(caseId, payloadUpdates);
      
      if (result.success) {
        fetchCases(true); // Silently refresh the table to move the row to the new tab
      } else {
        alert(`Action failed: ${result.error || 'Backend rejected the update.'}`);
      }
    } catch { 
      alert("Network error. Please try again."); 
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
    if (!rejectModal.reason.trim()) return alert("Reason required.");
    
    handleStatusUpdate(rejectModal.caseId, {
        status: 'Rejected', 
        rejection_reason: rejectModal.reason 
    });
    
    setRejectModal(prev => ({ ...prev, isOpen: false }));
  };

  return (
    <div className="BLOT_PAGE_WRAP">
      <div className="BLOT_MAIN_CONTAINER">

        {/* HEADER SECTION */}
        <header className="BLOT_HEADER_FLEX">
          <div>
            <h1 className="BLOT_PAGE_TITLE">Incident Reports</h1>
            <p className="BLOT_PAGE_SUB">Manage incident workflows and official hearings.</p>
          </div>
          <button className="BLOT_ADD_BTN" onClick={() => { setSelectedCase(null); setIsModalOpen(true); }}>
            <i className="fas fa-file-signature"></i> File Report
          </button>
        </header>

        {/* TOP STAT CARDS */}
        <section className="BLOT_STATS_GRID">
          <div className={`BLOT_STAT_CARD clickable ${activeTab === 'Pending' ? 'ACTIVE_CARD' : ''}`} onClick={() => setActiveTab('Pending')}>
            <div className="BLOT_STAT_INFO">
              <span className="BLOT_STAT_NUM">{stats.pending}</span>
              <span className="BLOT_STAT_LABEL">Requests</span>
            </div>
            <div className="BLOT_STAT_ICON_WRAP ICON_YELLOW"><i className="fas fa-clock"></i></div>
          </div>

          <div className={`BLOT_STAT_CARD clickable ${activeTab === 'Active' ? 'ACTIVE_CARD' : ''}`} onClick={() => setActiveTab('Active')}>
            <div className="BLOT_STAT_INFO">
              <span className="BLOT_STAT_NUM">{stats.active}</span>
              <span className="BLOT_STAT_LABEL">Active Cases</span>
            </div>
            <div className="BLOT_STAT_ICON_WRAP ICON_RED"><i className="fas fa-exclamation-circle"></i></div>
          </div>

          <div className={`BLOT_STAT_CARD clickable ${activeTab === 'Hearing' ? 'ACTIVE_CARD' : ''}`} onClick={() => setActiveTab('Hearing')}>
            <div className="BLOT_STAT_INFO">
              <span className="BLOT_STAT_NUM">{stats.hearing}</span>
              <span className="BLOT_STAT_LABEL">Scheduled</span>
            </div>
            <div className="BLOT_STAT_ICON_WRAP ICON_BLUE"><i className="fas fa-calendar-alt"></i></div>
          </div>

          <div className={`BLOT_STAT_CARD clickable ${activeTab === 'Settled' ? 'ACTIVE_CARD' : ''}`} onClick={() => setActiveTab('Settled')}>
            <div className="BLOT_STAT_INFO">
              <span className="BLOT_STAT_NUM">{stats.settled}</span>
              <span className="BLOT_STAT_LABEL">Settled</span>
            </div>
            <div className="BLOT_STAT_ICON_WRAP ICON_GREEN"><i className="fas fa-check-circle"></i></div>
          </div>
        </section>

        {/* TABS & SEARCH BAR */}
        <section className="BLOT_SEARCH_ROW">
          <div className="BLOT_TABS_ROW">
            {(['Pending', 'Active', 'Hearing', 'Settled', 'Rejected'] as const).map(tab => (
              <button key={tab} className={`BLOT_TAB_BTN ${activeTab === tab ? 'ACTIVE' : ''}`} onClick={() => setActiveTab(tab)}>
                {tab}
              </button>
            ))}
          </div>

          <div className="BLOT_SEARCH_WRAP">
             <i className="fas fa-search BLOT_SEARCH_ICON"></i>
             <input
              className="BLOT_SEARCH_INPUT"
              placeholder="Search by name or case #..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </section>

        {/* MAIN DATA TABLE */}
        <main className="BLOT_TABLE_CONTAINER">
          <div className="BLOT_TABLE_WRAP">
            <table className="BLOT_TABLE_MAIN">
              <thead>
                <tr>
                  <th>Case #</th>
                  <th>Complainant</th>
                  <th>Respondent</th>
                  <th>Type</th>
                  <th>{activeTab === 'Hearing' ? 'Hearing Date' : 'Filed Date'}</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && cases.length === 0 ? (
                  <tr><td colSpan={7} className="BLOT_TABLE_EMPTY"><div className="SYNC_SPINNER"></div>Syncing records from database...</td></tr>
                ) : error ? (
                  <tr><td colSpan={7} className="BLOT_TABLE_EMPTY" style={{color: 'red'}}>{error}</td></tr>
                ) : paginatedCases.length === 0 ? (
                  <tr><td colSpan={7} className="BLOT_TABLE_EMPTY" style={{ textAlign: 'center', padding: '4rem' }}>No {activeTab.toLowerCase()} records found.</td></tr>
                ) : (
                  paginatedCases.map((c) => {
                    const isFinalized = ['Settled', 'Archived', 'Rejected'].includes(c.status);
                    
                    // ─── 🛡️ THE FIX: Check if this row matches the hint ID ───
                    const isGlowing = activeHighlight === String(c.id);

                    return (
                      <tr 
                        key={c.id} 
                        className={isGlowing ? 'HINT_HIGHLIGHT' : ''} 
                      >
                        <td><span className="BLOT_CASE_NUMBER">{c.case_number}</span></td>
                        <td>{c.complainant_name}</td>
                        <td>{c.respondent}</td>
                        <td>{c.incident_type}</td>
                        <td className="BLOT_DATE_CELL">
                          {activeTab === 'Hearing'
                            ? `${c.hearing_date ? new Date(c.hearing_date).toLocaleDateString() : 'N/A'} @ ${c.hearing_time || ''}`
                            : new Date(c.date_filed).toLocaleDateString()
                          }
                        </td>
                        <td><span className={`BLOT_STATUS_BADGE STATUS_${c.status.toUpperCase()}`}>{c.status}</span></td>
                        <td style={{ textAlign: 'right' }}>
                          {/* 🛡️ ADDED GAP & FLEX HERE */}
                          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', alignItems: 'center' }}>
                            {(c.status === 'Active' || c.status === 'Pending') && (
                              <button className="BLOT_ACTION_ICON" onClick={() => setHearingModal({ isOpen: true, caseId: c.id, date: '', time: '09:00' })} title="Schedule"><i className="fas fa-calendar-plus"></i></button>
                            )}
                            {(c.status === 'Active' || c.status === 'Pending') && (
                              <button className="BLOT_ACTION_ICON" onClick={() => setRejectModal({ isOpen: true, caseId: c.id, reason: '' })} title="Reject"><i className="fas fa-ban" style={{ color: '#ef4444' }}></i></button>
                            )}
                            {c.status === 'Hearing' && (
                              <button className="BLOT_ACTION_ICON" onClick={() => handleStatusUpdate(c.id, { status: 'Settled' })} title="Mark Settled"><i className="fas fa-handshake" style={{ color: '#10b981' }}></i></button>
                            )}
                            <button className="BLOT_ACTION_ICON" onClick={() => { setSelectedCase(c); setIsModalOpen(true); }} title="View Details">
                              {isFinalized ? <i className="fas fa-eye"></i> : <i className="fas fa-edit"></i>}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* PAGINATION CONTROLS */}
          <div className="BLOT_PAGINATION_BAR">
            <div className="BLOT_PAGINATION_INFO">
              Showing {paginatedCases.length > 0 ? (currentPage - 1) * ITEMS_PER_PAGE + 1 : 0} to {Math.min(currentPage * ITEMS_PER_PAGE, filteredCases.length)} of {filteredCases.length} entries
            </div>
            <div className="BLOT_NAV_GROUP">
              <button 
                className="BLOT_NAV_BTN" 
                disabled={currentPage === 1} 
                onClick={() => setCurrentPage(p => p - 1)}
              >
                <i className="fas fa-chevron-left"></i> Previous
              </button>
              <span className="BLOT_PAGE_INDICATOR">Page {currentPage} of {totalPages || 1}</span>
              <button 
                className="BLOT_NAV_BTN" 
                disabled={currentPage >= totalPages} 
                onClick={() => setCurrentPage(p => p + 1)}
              >
                Next <i className="fas fa-chevron-right"></i>
              </button>
            </div>
          </div>
        </main>
      </div>

      {/* RENDER DYNAMIC MODALS */}
      {isModalOpen && (
        <FileComponent
          onClose={() => setIsModalOpen(false)}
          onRefresh={() => fetchCases(true)}
          selectedCase={selectedCase}
          officials={[]}
        />
      )}

      {/* HEARING MODAL */}
      {hearingModal.isOpen && (
        <div className="BLOT_MODAL_OVERLAY" onClick={() => setHearingModal(p => ({ ...p, isOpen: false }))}>
          <div className="BLOT_SIMPLE_MODAL" onClick={e => e.stopPropagation()}>
            <h3 className="BLOT_MODAL_TITLE">Schedule Hearing</h3>
            <label className="BLOT_MODAL_LABEL">Date</label>
            <input type="date" value={hearingModal.date} onChange={e => setHearingModal(p => ({ ...p, date: e.target.value }))} />
            <label className="BLOT_MODAL_LABEL">Time</label>
            <input type="time" value={hearingModal.time} onChange={e => setHearingModal(p => ({ ...p, time: e.target.value }))} />
            
            {/* 🛡️ ADDED GAP HERE */}
            <div className="BLOT_MODAL_ACTIONS" style={{ display: 'flex', gap: '10px' }}>
              <button className="BLOT_PAGE_BTN" onClick={() => setHearingModal(p => ({ ...p, isOpen: false }))}>Cancel</button>
              <button className="BLOT_ADD_BTN" onClick={submitHearing}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* REJECTION MODAL */}
      {rejectModal.isOpen && (
        <div className="BLOT_MODAL_OVERLAY" onClick={() => setRejectModal(p => ({ ...p, isOpen: false }))}>
          <div className="BLOT_SIMPLE_MODAL" onClick={e => e.stopPropagation()}>
            <h3 className="BLOT_MODAL_TITLE" style={{ color: '#ef4444' }}>Reject Complaint</h3>
            <label className="BLOT_MODAL_LABEL">Provide reason for rejection</label>
            <textarea rows={3} value={rejectModal.reason} onChange={e => setRejectModal(p => ({ ...p, reason: e.target.value }))} />
            
            {/* 🛡️ ADDED GAP HERE */}
            <div className="BLOT_MODAL_ACTIONS" style={{ display: 'flex', gap: '10px' }}>
              <button className="BLOT_PAGE_BTN" onClick={() => setRejectModal(p => ({ ...p, isOpen: false }))}>Cancel</button>
              <button className="BLOT_ADD_BTN" onClick={submitRejection} style={{ backgroundColor: '#ef4444' }}>Confirm Reject</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}