import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Document_view from '../../forms/Document_view'; 
import Document_modal from '../../buttons/Document_modal'; 
import Data_Analytics_modal from '../../buttons/Data_Analytics_modal'; 
import './styles/Document.css';
import { ApiService } from '../api'; 

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
}

const ITEMS_PER_PAGE = 10;

// ─── 🛡️ THE FIX: Define the props so TypeScript knows to expect highlightId ───
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
  
  // Modals
  const [selectedDoc, setSelectedDoc] = useState<IDocRequest | null>(null);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false); 

  // Notifications
  const prevCountRef = useRef(0);
  const [newRequestCount, setNewRequestCount] = useState(0);

  // ─── 🛡️ THE FIX: State for the Glowing Highlight ───
  const [activeHighlight, setActiveHighlight] = useState<string | null>(null);

  // ─── 🛡️ THE FIX: Effect to trigger and remove the highlight glow ───
  useEffect(() => {
    if (highlightId) {
      setActiveHighlight(highlightId);
      // Automatically clear the highlight after 2.5 seconds
      const timer = setTimeout(() => setActiveHighlight(null), 2500);
      return () => clearTimeout(timer);
    }
  }, [highlightId]);

  // ── DATA FETCHING (Universal Handshake) ──
  const fetchRequests = useCallback(async (silent = false, signal?: AbortSignal) => {
    if (!silent) setLoading(true);
    
    try {
      const rawData = await ApiService.getDocuments(signal);
      if (rawData === null) return; 

      const mappedData = rawData.map((d: any) => ({
        id: d.id || d.record_id, 
        referenceNo: d.reference_no || d.referenceNo || 'REF-N/A',
        residentName: d.resident_name || d.residentName || 'Unknown Resident',
        type: d.type,
        purpose: d.purpose,
        otherPurpose: d.other_purpose || d.otherPurpose,
        dateRequested: d.date_requested || d.dateRequested || new Date().toISOString(),
        status: d.status,
        price: d.price || 0
      }));

      // Sort by newest first
      const sortedData = mappedData.sort((a: IDocRequest, b: IDocRequest) => 
        new Date(b.dateRequested).getTime() - new Date(a.dateRequested).getTime()
      );

      setRequests(sortedData);

      // Trigger Notification Toast if new requests arrived
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
    
    // Sync every 15s
    const interval = setInterval(() => fetchRequests(true, valve.signal), 15000);
    return () => { valve.abort(); clearInterval(interval); };
  }, [fetchRequests]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchTerm]);

  // ── FILTERING ──
  const filteredDocs = useMemo(() => {
    return requests.filter(doc => {
      const searchMatch = 
        (doc.residentName || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
        (doc.referenceNo || '').toLowerCase().includes(searchTerm.toLowerCase());

      if (activeTab === 'History') {
        // History catches Completed or Rejected
        return searchMatch && (doc.status === 'Completed' || doc.status === 'Rejected');
      }
      return searchMatch && doc.status === activeTab;
    });
  }, [requests, activeTab, searchTerm]);

  // ── PAGINATION ENGINE ──
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
        {['Pending', 'Processing', 'Ready'].map(status => (
          <div key={status} className="DOC_STAT_CARD">
            <span className="DOC_STAT_VAL">{requests.filter(r => r.status === status).length}</span>
            <span className="DOC_STAT_LABEL">{status.toUpperCase()}</span>
          </div>
        ))}
        
        <div className="DOC_STAT_CARD DOC_ANALYTICS_TRIGGER" onClick={() => setIsAnalyticsOpen(true)}>
          <span className="DOC_STAT_VAL"><i className="fas fa-chart-pie"></i></span>
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
                <th style={{textAlign: 'right'}}>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {loading && !requests.length ? (
                <tr><td colSpan={6} className="MSG_ROW">Syncing records...</td></tr>
              ) : error ? (
                <tr><td colSpan={6} className="MSG_ROW ERROR">{error}</td></tr>
              ) : paginatedDocs.length === 0 ? (
                <tr><td colSpan={6} className="MSG_ROW">No records found for this stage.</td></tr>
              ) : (
                paginatedDocs.map(doc => {
                  // ─── 🛡️ THE FIX: Check if this row matches the hint ID ───
                  const isGlowing = activeHighlight === String(doc.id);

                  return (
                    <tr 
                      key={doc.id} 
                      // ─── 🛡️ THE FIX: Combine DOC_ROW_CLICK with HINT_HIGHLIGHT ───
                      className={`DOC_ROW_CLICK ${isGlowing ? 'HINT_HIGHLIGHT' : ''}`}
                      onClick={() => { setSelectedDoc(doc); setIsViewModalOpen(true); }} 
                    >
                      <td><span className="DOC_REF_BADGE">{doc.referenceNo}</span></td>
                      <td><strong>{doc.residentName}</strong></td>
                      <td>{doc.type}</td>
                      <td>{new Date(doc.dateRequested).toLocaleDateString()}</td>
                      <td><span className={`DOC_STATUS_PILL STATUS_${doc.status.toUpperCase()}`}>{doc.status}</span></td>
                      <td style={{textAlign: 'right'}}>
                          <button className="DOC_ACTION_BTN">
                              <i className="fas fa-chevron-right"></i>
                          </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* 10-ENTITY PAGINATION BAR */}
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
            <span className="DOC_PAGE_INDICATOR">Page {currentPage} of {totalPages || 1}</span>
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
          onGenerate={(docData) => {
            // Passes the doc data to the Document_modal for FINAL generation at the 'Ready' stage
            setSelectedDoc(docData);
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

      {/* NEW REQUEST NOTIFICATION */}
      {newRequestCount > 0 && (
        <div className="DOC_ALARM_TOAST">
          <i className="fas fa-bell"></i> {newRequestCount} New Document Request(s)
        </div>
      )}
    </div>
  );
}