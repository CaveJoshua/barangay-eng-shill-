import React, { useState, useMemo, useEffect } from 'react';
import Document_view from '../../forms/Community_Document_view'; 
import Community_Document_Request from '../../buttons/Community_Document_Request'; 
import "./C-Styles/Community_Document.css";
import "./C-Styles/Community_Document_mobile.css";

interface DocumentProps {
  data: any[]; 
  activeTab: string;
  setActiveTab: (tab: string) => void;
  resident: any;
  refresh: () => void;
}

// 🎯 THE FIX: Expanded the pipeline to 4 distinct stages
const statusTabs = [
  { id: 'Pending', label: 'Pending Request', icon: 'fas fa-inbox' },
  { id: 'Processing', label: 'Processing', icon: 'fas fa-cog' },
  { id: 'Ready', label: 'Ready for Pickup', icon: 'fas fa-check-circle' },
  { id: 'Released', label: 'History', icon: 'fas fa-history' },
];

const Community_Document: React.FC<DocumentProps> = ({ 
  data, 
  activeTab, 
  setActiveTab,
  resident,
  refresh 
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<any>(null);

  // ── 🛡️ SELF-HEALING STATE ──
  useEffect(() => {
    const validDocTabs = statusTabs.map(t => t.id);
    if (!validDocTabs.includes(activeTab)) {
      setActiveTab('Pending');
    }
  }, [activeTab, setActiveTab]);

  // ── 🔄 DATA SYNC ──
  useEffect(() => {
    if (resident?.record_id) {
      refresh();
    }
  }, [resident?.record_id, refresh]);

  // ── 🔍 DATA MAPPING & FILTERING (Expanded for New Pipeline) ──
  const processedData = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();

    return data.filter(doc => {
      const docStatus = (doc.status || 'Pending').toLowerCase();
      const tabStatus = activeTab.toLowerCase();
      
      // 🎯 Smart matching logic for the new pipeline
      let matchesTab = false;
      if (tabStatus === 'pending') {
          matchesTab = ['pending', 'new'].includes(docStatus);
      } else if (tabStatus === 'processing') {
          // If admin "accepts" or "approves", it counts as processing
          matchesTab = ['processing', 'accepted', 'approved'].includes(docStatus);
      } else if (tabStatus === 'ready') {
          matchesTab = ['ready', 'ready for pickup', 'for pickup'].includes(docStatus);
      } else if (tabStatus === 'released') {
          matchesTab = ['completed', 'released', 'picked-up', 'history'].includes(docStatus);
      } else {
          matchesTab = docStatus === tabStatus;
      }
      
      if (!matchesTab) return false;
      if (!query) return true;

      const typeStr = (doc.type || '').toLowerCase();
      const refStr = (doc.reference_no || doc.control_no || '').toLowerCase();
      const purposeStr = (doc.purpose || '').toLowerCase();

      return typeStr.includes(query) || refStr.includes(query) || purposeStr.includes(query);
    }).map(item => ({
      ...item,
      id: item.id,
      displayId: item.reference_no || item.control_no || 'PENDING',
      type: item.type || 'Document Request',
      date: item.date_requested ? new Date(item.date_requested).toLocaleDateString() : 'Pending',
      status: item.status || 'Pending',
      purpose: item.purpose || 'No details provided',
      priceDisplay: item.price && item.price > 0 ? `₱${parseFloat(item.price).toFixed(2)}` : 'To be assessed'
    }));
  }, [data, activeTab, searchQuery]);

  return (
    <div className="CM_DOC_VIEW_CONTAINER">
      
      {/* ── 1. HEADER SECTION ── */}
      <header className="CM_DOC_HEADER_CARD">
        <div className="CM_DOC_HEADER_TEXT">
          <h1>Document Requests</h1>
          <p>Manage and track your barangay certifications and permits.</p>
        </div>
        <button className="CM_DOC_BTN_REQUEST_NEW" onClick={() => setIsRequestModalOpen(true)}>
          <i className="fas fa-plus" />
          <span>New Request</span>
        </button>
      </header>

      {/* ── 2. TOOLBAR ── */}
      <div className="CM_DOC_TOOLBAR">
        <div className="CM_DOC_TABS_WRAPPER">
          {statusTabs.map((tab) => {
            // 🎯 Smart counter logic mirroring the filter logic
            const count = data.filter(doc => {
              const docStatus = (doc.status || 'Pending').toLowerCase();
              const tabStatus = tab.id.toLowerCase();
              
              if (tabStatus === 'pending') return ['pending', 'new'].includes(docStatus);
              if (tabStatus === 'processing') return ['processing', 'accepted', 'approved'].includes(docStatus);
              if (tabStatus === 'ready') return ['ready', 'ready for pickup', 'for pickup'].includes(docStatus);
              if (tabStatus === 'released') return ['completed', 'released', 'picked-up', 'history'].includes(docStatus);
              return docStatus === tabStatus;
            }).length;

            return (
              <button
                key={tab.id}
                className={`CM_DOC_TAB_ITEM ${activeTab === tab.id ? 'ACTIVE' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <i className={tab.icon} />
                <div className="CM_DOC_TAB_INFO">
                  <span className="CM_DOC_LBL">{tab.label}</span>
                  <span className="CM_DOC_CNT">({count})</span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="CM_DOC_SEARCH_BOX">
          <i className="fas fa-search" />
          <input 
            type="text" 
            placeholder="Search documents..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* ── 3. MAIN LIST STAGE ── */}
      <div className="CM_DOC_MAIN_LAYOUT">
        {processedData.length > 0 ? (
          <Document_view 
              data={processedData} 
              onSelect={(item) => setSelectedDoc(item)} 
          />
        ) : (
          <div className="CM_DOC_EMPTY_STATE">
            <i className="fas fa-folder-open" />
            <p>No records found in {activeTab}.</p>
          </div>
        )}
      </div>

      {/* ── 4. SLIDE DRAWER (Fixed Overlay) ── */}
      <div 
        className={`CM_DOC_DRAWER_OVERLAY ${selectedDoc ? 'SHOW' : ''}`} 
        onClick={() => setSelectedDoc(null)} 
      />

      <aside className={`CM_DOC_SLIDE_DRAWER ${selectedDoc ? 'OPEN' : ''}`}>
        {selectedDoc && (
          <div className="CM_DOC_DRAWER_CONTENT">
            <header className="CM_DOC_DRAWER_HEADER">
               <button className="CM_DOC_CLOSE_DRAWER" onClick={() => setSelectedDoc(null)}>
                <i className="fas fa-times" />
              </button>
              <div className="CM_DOC_HEADER_META">
                <span className="CM_DOC_SIDEBAR_ID">{selectedDoc.displayId}</span>
                <div className={`CM_DOC_SIDEBAR_STATUS STATUS_${selectedDoc.status.toUpperCase().replace(/\s+/g, '_')}`}>
                   {selectedDoc.status}
                </div>
              </div>
            </header>
            
            <div className="CM_DOC_SIDEBAR_INFO">
              <h2 className="CM_DOC_DRAWER_TITLE">{selectedDoc.type}</h2>
              
              <div className="CM_DOC_INFO_GROUP">
                <label>Document Fee</label>
                <p style={{ color: selectedDoc.priceDisplay.includes('assess') ? '#f59e0b' : '#10b981', fontWeight: 800 }}>
                  {selectedDoc.priceDisplay}
                </p>
              </div>
              
              <div className="CM_DOC_INFO_GROUP">
                <label>Date of Request</label>
                <p>{selectedDoc.date}</p>
              </div>

              <div className="CM_DOC_INFO_GROUP">
                <label>Purpose of Request</label>
                <div className="CM_DOC_SUMMARY_BOX">
                  <p>{selectedDoc.purpose}</p>
                </div>
              </div>
              
              <div className="CM_DOC_INFO_GROUP">
                <label>Tracking Reference</label>
                <p className="CM_DOC_SIDEBAR_ID">{selectedDoc.displayId}</p>
              </div>
            </div>

            <footer className="CM_DOC_DRAWER_FOOTER" style={{ padding: '20px', borderTop: '1px solid var(--c--p--border-subtle)', background: 'var(--c--p--bg-card)' }}>
               <button 
                 className="CM_DOC_FOOTER_BTN" 
                 onClick={() => setSelectedDoc(null)}
                 style={{
                   width: '100%',
                   padding: '12px 20px',
                   borderRadius: '10px',
                   border: '1px solid var(--c--p--border-subtle)',
                   backgroundColor: 'var(--c--p--bg-switcher)',
                   color: 'var(--c--p--text-primary)',
                   fontSize: '0.95rem',
                   fontWeight: 700,
                   cursor: 'pointer',
                   transition: 'all 0.2s',
                   display: 'flex',
                   alignItems: 'center',
                   justifyContent: 'center',
                   gap: '8px'
                 }}
               >
                 <i className="fas fa-times-circle"></i> Close View
               </button>
            </footer>
          </div>
        )}
      </aside>

      {/* ── REQUEST MODAL ── */}
      <Community_Document_Request 
        isOpen={isRequestModalOpen}
        onClose={() => setIsRequestModalOpen(false)}
        residentId={resident?.record_id}
        residentName={resident?.formattedName || 'Resident'}
        onSuccess={() => {
          setIsRequestModalOpen(false);
          refresh(); 
        }}
      />
      
    </div>
  );
};

export default Community_Document;