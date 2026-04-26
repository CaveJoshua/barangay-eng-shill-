import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { FileComponent } from '../../buttons/Tools/Blotter_File'; 
import './styles/Blotter.css';
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
  
  const [activeTab, setActiveTab] = useState<'Pending' | 'Active' | 'Hearing' | 'Settled' | 'Rejected'>('Pending');
  
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

  useEffect(() => {
    if (highlightId) {
      setActiveHighlight(highlightId);
      const timer = setTimeout(() => setActiveHighlight(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [highlightId]);

  useEffect(() => {
    const handleClickOutside = () => setOpenDropdownId(null);
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

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
          
          const docOrigin = c.origin || c.source || (c.is_online ? 'Online' : 'Walk-in');

          return {
            ...c,
            id: c.id || c.record_id || c.case_id,
            case_number: c.case_number || 'PENDING',
            complainant_name: c.complainant_name || 'Unknown',
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
        console.error("[INCIDENT REPORT] Sync Error:", fetchError);
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

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchTerm]);

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

  const totalPages = Math.ceil(filteredCases.length / ITEMS_PER_PAGE);
  const paginatedCases = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredCases.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredCases, currentPage]);

  const handleStatusUpdate = async (caseId: string, payloadUpdates: any) => {
    try {
      const result = await ApiService.saveBlotter(caseId, payloadUpdates);
      
      if (result.success) {
        fetchCases(true); 
      } else {
        alert(`Action failed: ${result.error || 'Backend rejected the update.'}`);
      }
    } catch (updateError) { 
      console.error("Status Update Error:", updateError);
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
    <div className="AD-BLOT_PAGE_WRAP">
      <div className="AD-BLOT_MAIN_CONTAINER">

        <header className="AD-BLOT_HEADER_FLEX">
          <div>
            <h1 className="AD-BLOT_PAGE_TITLE">Incident Reports</h1>
            <p className="AD-BLOT_PAGE_SUB">Manage incident workflows and official hearings.</p>
          </div>
          <button className="AD-BLOT_ADD_BTN" onClick={() => { setSelectedCase(null); setIsModalOpen(true); }}>
            <i className="fas fa-file-signature"></i> File Report
          </button>
        </header>

        <section className="AD-BLOT_STATS_GRID">
          <div className={`AD-BLOT_STAT_CARD AD-BLOT_CLICKABLE ${activeTab === 'Pending' ? 'AD-BLOT_ACTIVE_CARD' : ''}`} onClick={() => setActiveTab('Pending')}>
            <div className="AD-BLOT_STAT_INFO">
              <span className="AD-BLOT_STAT_NUM">{stats.pending}</span>
              <span className="AD-BLOT_STAT_LABEL">Requests</span>
            </div>
            <div className="AD-BLOT_STAT_ICON_WRAP AD-BLOT_ICON_YELLOW"><i className="fas fa-clock"></i></div>
          </div>

          <div className={`AD-BLOT_STAT_CARD AD-BLOT_CLICKABLE ${activeTab === 'Active' ? 'AD-BLOT_ACTIVE_CARD' : ''}`} onClick={() => setActiveTab('Active')}>
            <div className="AD-BLOT_STAT_INFO">
              <span className="AD-BLOT_STAT_NUM">{stats.active}</span>
              <span className="AD-BLOT_STAT_LABEL">Active Cases</span>
            </div>
            <div className="AD-BLOT_STAT_ICON_WRAP AD-BLOT_ICON_RED"><i className="fas fa-exclamation-circle"></i></div>
          </div>

          <div className={`AD-BLOT_STAT_CARD AD-BLOT_CLICKABLE ${activeTab === 'Hearing' ? 'AD-BLOT_ACTIVE_CARD' : ''}`} onClick={() => setActiveTab('Hearing')}>
            <div className="AD-BLOT_STAT_INFO">
              <span className="AD-BLOT_STAT_NUM">{stats.hearing}</span>
              <span className="AD-BLOT_STAT_LABEL">Scheduled</span>
            </div>
            <div className="AD-BLOT_STAT_ICON_WRAP AD-BLOT_ICON_BLUE"><i className="fas fa-calendar-alt"></i></div>
          </div>

          <div className={`AD-BLOT_STAT_CARD AD-BLOT_CLICKABLE ${activeTab === 'Settled' ? 'AD-BLOT_ACTIVE_CARD' : ''}`} onClick={() => setActiveTab('Settled')}>
            <div className="AD-BLOT_STAT_INFO">
              <span className="AD-BLOT_STAT_NUM">{stats.settled}</span>
              <span className="AD-BLOT_STAT_LABEL">Settled</span>
            </div>
            <div className="AD-BLOT_STAT_ICON_WRAP AD-BLOT_ICON_GREEN"><i className="fas fa-check-circle"></i></div>
          </div>
        </section>

        <section className="AD-BLOT_SEARCH_ROW">
          <div className="AD-BLOT_TABS_ROW">
            {(['Pending', 'Active', 'Hearing', 'Settled', 'Rejected'] as const).map(tab => (
              <button key={tab} className={`AD-BLOT_TAB_BTN ${activeTab === tab ? 'AD-BLOT_ACTIVE' : ''}`} onClick={() => setActiveTab(tab)}>
                {tab}
              </button>
            ))}
          </div>

          <div className="AD-BLOT_SEARCH_WRAP">
             <i className="fas fa-search AD-BLOT_SEARCH_ICON"></i>
             <input
              className="AD-BLOT_SEARCH_INPUT"
              placeholder="Search by name or case #..."
              value={searchTerm}
              onChange={(searchEvent) => setSearchTerm(searchEvent.target.value)}
            />
          </div>
        </section>

        <main className="AD-BLOT_TABLE_CONTAINER">
          <div className="AD-BLOT_TABLE_WRAP">
            <table className="AD-BLOT_TABLE_MAIN">
              <thead>
                <tr>
                  <th>Case Information</th>
                  <th>Complainant</th>
                  <th>Respondent</th>
                  <th>Type</th>
                  <th>{activeTab === 'Hearing' ? 'Hearing Date' : 'Filed Date'}</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right', paddingRight: '2rem' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && cases.length === 0 ? (
                  <tr><td colSpan={7} className="AD-BLOT_TABLE_EMPTY"><div className="AD-BLOT_SYNC_SPINNER"></div>Syncing records from database...</td></tr>
                ) : error ? (
                  <tr><td colSpan={7} className="AD-BLOT_TABLE_EMPTY" style={{color: 'red'}}>{error}</td></tr>
                ) : paginatedCases.length === 0 ? (
                  <tr><td colSpan={7} className="AD-BLOT_TABLE_EMPTY" style={{ textAlign: 'center', padding: '4rem' }}>No {activeTab.toLowerCase()} records found.</td></tr>
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
                              <i className={c.origin === 'Online' ? 'fas fa-globe' : 'fas fa-walking'}></i> {c.origin}
                            </span>
                          </div>
                        </td>
                        <td>{c.complainant_name}</td>
                        <td>{c.respondent}</td>
                        <td>{c.incident_type}</td>
                        <td className="AD-BLOT_DATE_CELL">
                          {activeTab === 'Hearing'
                            ? `${c.hearing_date ? new Date(c.hearing_date).toLocaleDateString() : 'N/A'} @ ${c.hearing_time || ''}`
                            : new Date(c.date_filed).toLocaleDateString()
                          }
                        </td>
                        <td><span className={`AD-BLOT_STATUS_BADGE AD-BLOT_STATUS_${c.status.toUpperCase()}`}>{c.status}</span></td>
                        
                        <td style={{ position: 'relative', textAlign: 'right', paddingRight: '2rem' }}>
                          <button 
                            className="AD-BLOT_ACTION_MENU_BTN"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenDropdownId(openDropdownId === c.id ? null : c.id);
                            }}
                            style={{
                              width: 'auto',
                              height: 'auto',
                              padding: '6px 14px',
                              border: '1px solid var(--AD-BLOT-clr-primary)',
                              borderRadius: '8px',
                              color: 'var(--AD-BLOT-text-heading)',
                              fontSize: '0.85rem',
                              fontWeight: 700,
                              gap: '8px'
                            }}
                          >
                            Manage <i className="fas fa-chevron-down" style={{ fontSize: '0.75rem' }}></i>
                          </button>

                          {openDropdownId === c.id && (
                            <div className="AD-BLOT_DROPDOWN_MENU" onClick={(e) => e.stopPropagation()}>
                              <button onClick={() => { setSelectedCase(c); setIsModalOpen(true); setOpenDropdownId(null); }}>
                                <i className="fas fa-file-alt"></i> Review Details
                              </button>

                              {(c.status === 'Pending' || c.status === 'Active' || c.status === 'Hearing') && (
                                <button onClick={() => { setHearingModal({ isOpen: true, caseId: c.id, date: c.hearing_date || '', time: c.hearing_time || '09:00' }); setOpenDropdownId(null); }}>
                                  <i className="fas fa-calendar-alt"></i> {c.status === 'Hearing' ? 'Reschedule Hearing' : 'Schedule Hearing'}
                                </button>
                              )}

                              {c.status === 'Hearing' && (
                                <button className="SUCCESS" onClick={() => { handleStatusUpdate(c.id, { status: 'Settled' }); setOpenDropdownId(null); }}>
                                  <i className="fas fa-handshake"></i> Mark as Settled
                                </button>
                              )}

                              {(c.status === 'Pending' || c.status === 'Active') && (
                                <button className="DANGER" onClick={() => { setRejectModal({ isOpen: true, caseId: c.id, reason: '' }); setOpenDropdownId(null); }}>
                                  <i className="fas fa-ban"></i> Reject Complaint
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
              Showing {paginatedCases.length > 0 ? (currentPage - 1) * ITEMS_PER_PAGE + 1 : 0} to {Math.min(currentPage * ITEMS_PER_PAGE, filteredCases.length)} of {filteredCases.length} entries
            </div>
            <div className="AD-BLOT_NAV_GROUP">
              <button 
                className="AD-BLOT_NAV_BTN" 
                disabled={currentPage === 1} 
                onClick={() => setCurrentPage(p => p - 1)}
              >
                <i className="fas fa-chevron-left"></i> Previous
              </button>
              <span className="AD-BLOT_PAGE_INDICATOR">Page {currentPage} of {totalPages || 1}</span>
              <button 
                className="AD-BLOT_NAV_BTN" 
                disabled={currentPage >= totalPages} 
                onClick={() => setCurrentPage(p => p + 1)}
              >
                Next <i className="fas fa-chevron-right"></i>
              </button>
            </div>
          </div>
        </main>
      </div>

      {isModalOpen && (
        <FileComponent
          onClose={() => setIsModalOpen(false)}
          onRefresh={() => fetchCases(true)}
          selectedCase={selectedCase}
          officials={[]}
        />
      )}

      {hearingModal.isOpen && (
        <div className="AD-BLOT_MODAL_OVERLAY" onClick={() => setHearingModal(p => ({ ...p, isOpen: false }))}>
          <div className="AD-BLOT_SIMPLE_MODAL" onClick={clickEvent => clickEvent.stopPropagation()}>
            <h3 className="AD-BLOT_MODAL_TITLE">Schedule Hearing</h3>
            <label className="AD-BLOT_MODAL_LABEL">Date</label>
            <input type="date" value={hearingModal.date} onChange={dateEvent => setHearingModal(p => ({ ...p, date: dateEvent.target.value }))} />
            <label className="AD-BLOT_MODAL_LABEL">Time</label>
            <input type="time" value={hearingModal.time} onChange={timeEvent => setHearingModal(p => ({ ...p, time: timeEvent.target.value }))} />
            
            <div className="AD-BLOT_MODAL_ACTIONS" style={{ display: 'flex', gap: '10px' }}>
              <button className="AD-BLOT_PAGE_BTN" onClick={() => setHearingModal(p => ({ ...p, isOpen: false }))}>Cancel</button>
              <button className="AD-BLOT_ADD_BTN" onClick={submitHearing}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {rejectModal.isOpen && (
        <div className="AD-BLOT_MODAL_OVERLAY" onClick={() => setRejectModal(p => ({ ...p, isOpen: false }))}>
          <div className="AD-BLOT_SIMPLE_MODAL" onClick={clickEvent => clickEvent.stopPropagation()}>
            <h3 className="AD-BLOT_MODAL_TITLE" style={{ color: '#ef4444' }}>Reject Complaint</h3>
            <label className="AD-BLOT_MODAL_LABEL">Provide reason for rejection</label>
            <textarea rows={3} value={rejectModal.reason} onChange={reasonEvent => setRejectModal(p => ({ ...p, reason: reasonEvent.target.value }))} />
            
            <div className="AD-BLOT_MODAL_ACTIONS" style={{ display: 'flex', gap: '10px' }}>
              <button className="AD-BLOT_PAGE_BTN" onClick={() => setRejectModal(p => ({ ...p, isOpen: false }))}>Cancel</button>
              <button className="AD-BLOT_ADD_BTN" onClick={submitRejection} style={{ backgroundColor: '#ef4444' }}>Confirm Reject</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}