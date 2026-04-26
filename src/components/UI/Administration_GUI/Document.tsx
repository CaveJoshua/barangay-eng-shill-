import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Document_view from '../../forms/Document_view'; 
import Document_modal from '../../buttons/Document_modal'; 
import Data_Analytics_modal from '../../buttons/Data_Analytics_modal'; 
import './styles/Document.css';
import { ApiService } from '../api'; 

// ─────────────────────────────────────────────────────────────────────────────
// FIX: Import updateDocumentStatus from the API layer.
//
// ⚠️  PATH: Adjust this import path to match where Doc_data_api.ts lives
//   relative to this file. Common patterns:
//     './Types/Doc_data_api'          ← if same folder level
//     '../Documents/Types/Doc_data_api' ← if one folder up
// ─────────────────────────────────────────────────────────────────────────────
import { updateDocumentStatus } from '../../buttons/Tools/Document_tools/Types/Doc_data_api';

export interface IDocRequest {
  id: string;
  referenceNo: string;
  residentName: string;
  type: string;
  purpose: string;
  otherPurpose?: string;
  dateRequested: string;
  status: 'Pending' | 'Processing' | 'Ready' | 'Completed' | 'Rejected';
  price: number;
  requestMethod?: 'Online' | 'Walk-in'; 
}

const ITEMS_PER_PAGE = 10;

interface DocumentPageProps {
  highlightId?: string;
}

export default function DocumentsPage({ highlightId }: DocumentPageProps) {
  // ── STATE MANAGEMENT ──
  const [requests, setRequests] = useState<IDocRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Pipeline Tabs
  const [activeTab, setActiveTab] = useState<'Pending' | 'Processing' | 'Ready' | 'History'>('Pending');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  
  // Modals & Menus
  const [selectedDoc, setSelectedDoc] = useState<IDocRequest | null>(null);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false); 
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  
  const [rejectModal, setRejectModal] = useState({
    isOpen: false, docId: '', reason: ''
  });

  // Notifications
  const prevCountRef = useRef(0);
  const [newRequestCount, setNewRequestCount] = useState(0);

  // ─── Glowing Highlight ───
  const [activeHighlight, setActiveHighlight] = useState<string | null>(null);

  useEffect(() => {
    if (highlightId) {
      setActiveHighlight(highlightId);
      if (highlightId.toUpperCase().includes('WK-IN')) {
          setActiveTab('History');
      }
      const timer = setTimeout(() => setActiveHighlight(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [highlightId]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const closeMenu = () => setOpenDropdownId(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  // ── DATA FETCHING ──
  const fetchRequests = useCallback(async (silent = false, signal?: AbortSignal) => {
    if (!silent) setLoading(true);
    
    try {
      const rawData = await ApiService.getDocuments(signal);
      if (rawData === null) return; 

      const mappedData: IDocRequest[] = rawData.map((d: any) => {
        const ref = d.reference_no || d.referenceNo || 'REF-N/A';
        const methodStr = d.request_method || d.requestMethod || '';
        
        const isWalkIn = methodStr.toLowerCase() === 'walk-in' || ref.toUpperCase().includes('WK-IN');
        
        let currentStatus = d.status || 'Pending';

        if (isWalkIn && currentStatus.toLowerCase() !== 'rejected') {
          currentStatus = 'Completed';
        }

        const normalizedStatus = currentStatus.charAt(0).toUpperCase() + currentStatus.slice(1).toLowerCase();

        return {
          id: d.id || d.record_id, 
          referenceNo: ref,
          residentName: d.resident_name || d.residentName || 'Unknown Resident',
          type: d.type,
          purpose: d.purpose,
          otherPurpose: d.other_purpose || d.otherPurpose,
          dateRequested: d.date_requested || d.dateRequested || new Date().toISOString(),
          status: normalizedStatus,
          price: d.price || 0,
          requestMethod: isWalkIn ? 'Walk-in' : 'Online' 
        };
      });

      const sortedData = mappedData.sort((a, b) => 
        new Date(b.dateRequested).getTime() - new Date(a.dateRequested).getTime()
      );

      setRequests(sortedData);

      if (sortedData.length > prevCountRef.current && prevCountRef.current !== 0) {
        const diff = sortedData.length - prevCountRef.current;
        if (diff > 0) {
           setNewRequestCount(diff);
           setTimeout(() => setNewRequestCount(0), 5000);
        }
      }
      prevCountRef.current = sortedData.length;
      setError('');
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error("Document Sync Error:", err);
        setError('Connection lost. Sync failed.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // ── LIFECYCLES ──
  useEffect(() => {
    const valve = new AbortController();
    fetchRequests(false, valve.signal);
    
    const interval = setInterval(() => fetchRequests(true, valve.signal), 15000);
    return () => { valve.abort(); clearInterval(interval); };
  }, [fetchRequests]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchTerm]);

  // ── FILTERING LOGIC ──
  const filteredDocs = useMemo(() => {
    return requests.filter(doc => {
      const searchMatch = 
        (doc.residentName || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
        (doc.referenceNo || '').toLowerCase().includes(searchTerm.toLowerCase());

      if (!searchMatch) return false;

      if (activeTab === 'History') {
        return doc.status === 'Completed' || doc.status === 'Rejected';
      } else {
        return doc.status === activeTab;
      }
    });
  }, [requests, activeTab, searchTerm]);

  const totalPages = Math.ceil(filteredDocs.length / ITEMS_PER_PAGE);
  const paginatedDocs = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredDocs.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredDocs, currentPage]);

  const handleRefresh = () => {
    fetchRequests(true);
    setIsViewModalOpen(false);
    setIsManualModalOpen(false);
    setSelectedDoc(null);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // FIX: handleStatusUpdate
  //
  // ROOT CAUSE (before fix):
  //   Called ApiService.saveDocumentRecord({ id, status }) which hits the
  //   POST /documents/save endpoint — an INSERT-only route. The backend never
  //   looked at the `id` field for updates, so every status click was silently
  //   trying (and failing) to INSERT a new duplicate row. Nothing was saved.
  //
  // FIX:
  //   Now calls updateDocumentStatus(id, status, reason) which issues a
  //   PATCH /documents/:id/status request — the correct update endpoint that
  //   the backend router already exposes and handles properly.
  // ─────────────────────────────────────────────────────────────────────────
  const handleStatusUpdate = async (id: string, newStatus: string, reason?: string) => {
    try {
      await updateDocumentStatus(id, newStatus, reason);
      handleRefresh();
    } catch (err: any) {
      console.error("Status Update Error:", err);
      alert(`Failed to update status: ${err.message}`);
    }
  };

  const submitRejection = () => {
    if (!rejectModal.reason.trim()) return alert("Statement of reason is required.");
    handleStatusUpdate(rejectModal.docId, 'Rejected', rejectModal.reason);
    setRejectModal({ isOpen: false, docId: '', reason: '' });
  };

  return (
    <div className="DOC_PAGE_LAYOUT">
      
      {/* HEADER SECTION */}
      <div className="DOC_TOP_BAR">
        <div className="DOC_TITLE_GROUP">
          <h1>Document Pipeline</h1>
          <p>Process, review, and finalize resident clearances and certificates.</p>
        </div>
        <button 
          className="DOC_MANUAL_CREATE_BTN" 
          onClick={() => { setSelectedDoc(null); setIsManualModalOpen(true); }}
        >
          <i className="fas fa-plus-circle"></i> Create Manually
        </button>
      </div>

      {/* KPI STATS PANEL */}
      <div className="DOC_STATS_GRID">
        {['Pending', 'Processing', 'Ready'].map(status => {
          const count = requests.filter(r => r.status === status).length;
          return (
            <div key={status} className="DOC_STAT_CARD">
              <span className="DOC_STAT_VAL">{count}</span>
              <span className="DOC_STAT_LABEL">{status.toUpperCase()}</span>
            </div>
          );
        })}
        
        <div className="DOC_STAT_CARD DOC_ANALYTICS_TRIGGER" onClick={() => setIsAnalyticsOpen(true)}>
          <span className="DOC_STAT_VAL"><i className="fas fa-chart-pie" style={{ color: '#3b82f6' }}></i></span>
          <span className="DOC_STAT_LABEL">VIEW ANALYTICS</span>
        </div>
      </div>

      {/* SEARCH & WORKFLOW TABS */}
      <div className="DOC_CONTROLS_BAR">
        <div className="DOC_TAB_GROUP">
          {['Pending', 'Processing', 'Ready', 'History'].map(tab => (
            <button 
              key={tab} 
              className={`DOC_TAB_ITEM ${activeTab === tab ? 'ACTIVE' : ''}`} 
              onClick={() => setActiveTab(tab as any)}
            >
              {tab}
            </button>
          ))}
        </div>
        
        <div className="DOC_SEARCH_FIELD">
          <i className="fas fa-search"></i>
          <input 
            type="text" 
            placeholder="Search resident name or REF #..." 
            value={searchTerm} 
            onChange={e => setSearchTerm(e.target.value)} 
          />
        </div>
      </div>

      {/* MAIN DATA TABLE */}
      <div className="DOC_TABLE_CONTAINER">
        <div className="DOC_TABLE_SCROLL_WRAP">
          <table className="DOC_TABLE_CORE">
            <thead>
              <tr>
                <th>REF ID</th>
                <th>RESIDENT</th>
                <th>DOCUMENT TYPE</th>
                <th>DATE REQUESTED</th>
                <th>PIPELINE STAGE</th>
                {activeTab !== 'History' && <th style={{textAlign: 'right'}}>ACTION</th>}
              </tr>
            </thead>
            <tbody>
              {loading && !requests.length ? (
                <tr><td colSpan={activeTab === 'History' ? 5 : 6} className="MSG_ROW">Syncing records...</td></tr>
              ) : error ? (
                <tr><td colSpan={activeTab === 'History' ? 5 : 6} className="MSG_ROW ERROR">{error}</td></tr>
              ) : paginatedDocs.length === 0 ? (
                <tr><td colSpan={activeTab === 'History' ? 5 : 6} className="MSG_ROW">No records found for this stage.</td></tr>
              ) : (
                paginatedDocs.map(doc => {
                  const isGlowing = activeHighlight === doc.referenceNo || activeHighlight === doc.id;

                  return (
                    <tr 
                      key={doc.id} 
                      className={`DOC_ROW_CLICK ${isGlowing ? 'HINT_HIGHLIGHT' : ''}`}
                      onClick={() => { 
                        setSelectedDoc(doc); 
                        setIsViewModalOpen(true); 
                        setOpenDropdownId(null);
                      }} 
                    >
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                          <span className="DOC_REF_BADGE">{doc.referenceNo}</span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--doc-text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                            {doc.requestMethod === 'Walk-in' ? (
                              <><i className="fas fa-walking" style={{marginRight: '4px', color: '#10b981'}}></i> Walk-in</>
                            ) : (
                              <><i className="fas fa-globe" style={{marginRight: '4px', color: '#3b82f6'}}></i> Online</>
                            )}
                          </span>
                        </div>
                      </td>
                      <td><strong>{doc.residentName}</strong></td>
                      <td>{doc.type}</td>
                      <td>{new Date(doc.dateRequested).toLocaleDateString()}</td>
                      <td><span className={`DOC_STATUS_PILL ${doc.status}`}>{doc.status}</span></td>
                      
                      {/* ACTION DROPDOWN */}
                      {activeTab !== 'History' && (
                        <td className="DOC_ACTION_CELL">
                          <button 
                            className="DOC_ACTION_MENU_BTN"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenDropdownId(openDropdownId === doc.id ? null : doc.id);
                            }}
                          >
                            Manage <i className="fas fa-chevron-down"></i>
                          </button>

                          {/* SMART DROPDOWN MENU */}
                          {openDropdownId === doc.id && (
                            <div className="DOC_DROPDOWN_MENU" onClick={(e) => e.stopPropagation()}>
                              <button onClick={() => { setSelectedDoc(doc); setIsViewModalOpen(true); setOpenDropdownId(null); }}>
                                <i className="fas fa-search"></i> Review Details
                              </button>

                              {doc.status === 'Pending' && (
                                <button className="PRIMARY" onClick={() => { handleStatusUpdate(doc.id, 'Processing'); setOpenDropdownId(null); }}>
                                  <i className="fas fa-check-circle"></i> Approve Request
                                </button>
                              )}

                              {doc.status === 'Processing' && (
                                <button className="SUCCESS" onClick={() => { handleStatusUpdate(doc.id, 'Ready'); setOpenDropdownId(null); }}>
                                  <i className="fas fa-print"></i> Mark as Ready
                                </button>
                              )}

                              {doc.status === 'Ready' && (
                                <button className="SUCCESS" onClick={() => { handleStatusUpdate(doc.id, 'Completed'); setOpenDropdownId(null); }}>
                                  <i className="fas fa-clipboard-check"></i> Mark Completed
                                </button>
                              )}

                              {(doc.status === 'Pending' || doc.status === 'Processing') && (
                                <button className="DANGER" onClick={() => { setRejectModal({ isOpen: true, docId: doc.id, reason: '' }); setOpenDropdownId(null); }}>
                                  <i className="fas fa-ban"></i> Reject Request
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* PAGINATION BAR */}
        <div className="DOC_PAGINATION_BAR">
          <div className="DOC_PAGINATION_INFO">
            Showing {filteredDocs.length > 0 ? (currentPage - 1) * ITEMS_PER_PAGE + 1 : 0} to {Math.min(currentPage * ITEMS_PER_PAGE, filteredDocs.length)} of {filteredDocs.length} entries
          </div>
          <div className="DOC_NAV_GROUP">
            <button 
              className="DOC_NAV_BTN" 
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
            >
              <i className="fas fa-chevron-left"></i> Previous
            </button>
            <span className="DOC_PAGE_INDICATOR">
              Page {currentPage} of {totalPages || 1}
            </span>
            <button 
              className="DOC_NAV_BTN" 
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              disabled={currentPage >= totalPages || totalPages === 0}
            >
              Next <i className="fas fa-chevron-right"></i>
            </button>
          </div>
        </div>
      </div>

      {/* RENDER MODALS */}
      {selectedDoc && (
        <Document_view 
          isOpen={isViewModalOpen} 
          onClose={() => setIsViewModalOpen(false)} 
          onUpdate={handleRefresh} 
          onGenerate={(docData: any) => {
            setSelectedDoc({
              ...docData,
              requestMethod: docData.requestMethod || 'Online'
            });
            setIsManualModalOpen(true);
          }}
          data={selectedDoc} 
        />
      )}
      
      <Document_modal 
        isOpen={isManualModalOpen} 
        onClose={() => setIsManualModalOpen(false)} 
        onSuccess={handleRefresh} 
        requestData={selectedDoc} 
      />

      <Data_Analytics_modal 
        isOpen={isAnalyticsOpen}
        onClose={() => setIsAnalyticsOpen(false)}
      />

      {/* 🛡️ REJECTION MODAL */}
      {rejectModal.isOpen && (
        <div className="DOC_MODAL_OVERLAY" onClick={() => setRejectModal({ isOpen: false, docId: '', reason: '' })}>
          <div className="DOC_SIMPLE_MODAL" onClick={e => e.stopPropagation()}>
            <h3 className="DOC_MODAL_TITLE">Reject Document Request</h3>
            
            <label className="DOC_MODAL_LABEL">Statement of Reason</label>
            <textarea 
              className="DOC_MODAL_TEXTAREA"
              rows={4} 
              placeholder="Provide an official reason for rejecting this request..."
              value={rejectModal.reason} 
              onChange={e => setRejectModal(prev => ({ ...prev, reason: e.target.value }))} 
            />
            
            <div className="DOC_MODAL_ACTIONS">
              <button 
                className="DOC_PAGE_BTN"
                onClick={() => setRejectModal({ isOpen: false, docId: '', reason: '' })}
              >
                Cancel
              </button>
              <button 
                className="DOC_ADD_BTN"
                onClick={submitRejection} 
              >
                <i className="fas fa-ban"></i> Confirm Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NEW REQUEST NOTIFICATION */}
      {newRequestCount > 0 && (
        <div className="DOC_ALARM_TOAST">
          <i className="fas fa-bell"></i> {newRequestCount} New Document Request(s)
        </div>
      )}
    </div>
  );
}