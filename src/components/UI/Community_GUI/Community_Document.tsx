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

const statusTabs = [
  { id: 'Pending', label: 'Processing', icon: 'fas fa-clock' },
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

  // ── 🔍 DATA MAPPING & FILTERING ──
  const processedData = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();

    return data.filter(doc => {
      const docStatus = (doc.status || 'Pending').toLowerCase();
      const tabStatus = activeTab.toLowerCase();
      
      const matchesTab = docStatus === tabStatus || 
                         (tabStatus === 'released' && ['completed', 'released', 'picked-up'].includes(docStatus));
      
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
    <div className="DOC_VIEW_CONTAINER">
      
      {/* ── 1. HEADER SECTION ── */}
      <header className="DOC_HEADER_CARD">
        <div className="HEADER_TEXT">
          <h1>Document Requests</h1>
          <p>Manage and track your barangay certifications and permits.</p>
        </div>
        <button className="BTN_REQUEST_NEW" onClick={() => setIsRequestModalOpen(true)}>
          <i className="fas fa-plus" />
          <span>New Request</span>
        </button>
      </header>

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

      {/* ── 2. TOOLBAR ── */}
      <div className="DOC_TOOLBAR">
        <div className="DOC_TABS_WRAPPER">
          {statusTabs.map((tab) => {
            const count = data.filter(doc => {
              const docStatus = (doc.status || 'Pending').toLowerCase();
              const tabStatus = tab.id.toLowerCase();
              return docStatus === tabStatus || (tabStatus === 'released' && ['completed', 'released', 'picked-up'].includes(docStatus));
            }).length;

            return (
              <button
                key={tab.id}
                className={`DOC_TAB_ITEM ${activeTab === tab.id ? 'ACTIVE' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <i className={tab.icon} />
                <div className="TAB_INFO">
                  <span className="LBL">{tab.label}</span>
                  <span className="CNT">({count})</span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="DOC_SEARCH_BOX">
          <i className="fas fa-search" />
          <input 
            type="text" 
            placeholder="Search documents..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* ── 3. LIST STAGE ── */}
      <div className="BLOTTER_MAIN_LAYOUT">
        <main className="DOC_LIST_STAGE">
          {processedData.length > 0 ? (
            /* 🎯 GINAMIT NA NATIN ANG COMPONENT: Dito mawawala ang warning */
            <Document_view 
                data={processedData} 
                onSelect={(item) => setSelectedDoc(item)} 
            />
          ) : (
            <div className="DOC_EMPTY_STATE">
              <i className="fas fa-folder-open" />
              <p>No records found in {activeTab}.</p>
            </div>
          )}
        </main>
      </div>

      {/* ── 4. SLIDE DRAWER (Fixed Overlay) ── */}
      <div 
        className={`DRAWER_OVERLAY ${selectedDoc ? 'SHOW' : ''}`} 
        onClick={() => setSelectedDoc(null)} 
      />

      <aside className={`SLIDE_DRAWER ${selectedDoc ? 'OPEN' : ''}`}>
        {selectedDoc && (
          <div className="DRAWER_CONTENT">
            <header className="DRAWER_HEADER">
               <button className="CLOSE_DRAWER" onClick={() => setSelectedDoc(null)}>
                <i className="fas fa-times" />
              </button>
              <div className="HEADER_META">
                <span className="SIDEBAR_ID">{selectedDoc.displayId}</span>
                <div className={`SIDEBAR_STATUS ${selectedDoc.status.toUpperCase()}`}>
                   {selectedDoc.status}
                </div>
              </div>
            </header>
            
            <div className="SIDEBAR_INFO">
              <h2 className="DRAWER_TITLE">{selectedDoc.type}</h2>
              
              <div className="INFO_GROUP">
                <label>Document Fee</label>
                <p style={{ color: selectedDoc.priceDisplay === 'To be assessed' ? '#f59e0b' : '#10b981', fontWeight: 800 }}>
                  {selectedDoc.priceDisplay}
                </p>
              </div>
              
              <div className="INFO_GROUP">
                <label>Date of Request</label>
                <p>{selectedDoc.date}</p>
              </div>

              <div className="INFO_GROUP">
                <label>Purpose of Request</label>
                <div className="SUMMARY_BOX">
                  <p>{selectedDoc.purpose}</p>
                </div>
              </div>
              
              <div className="INFO_GROUP">
                <label>Tracking Reference</label>
                <p className="SIDEBAR_ID">{selectedDoc.displayId}</p>
              </div>
            </div>

            <footer className="DRAWER_FOOTER">
               <button className="FOOTER_BTN" onClick={() => setSelectedDoc(null)}>Close View</button>
            </footer>
          </div>
        )}
      </aside>
      
    </div>
  );
};

export default Community_Document;