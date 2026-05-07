import React, { useState, useMemo, useEffect } from 'react';
import Document_view from '../../forms/Community_Document_view'; 
import Community_Document_Request from '../../buttons/Community_Document_Request'; 
import "./Styles/Community_Document.css";
import "./Styles/Community_Document_mobile.css";

interface DocumentProps {
  data: any[]; 
  activeTab: string;
  setActiveTab: (tab: string) => void;
  resident: any;
  refresh: () => void;
}

const statusTabs = [
  { id: 'Pending', label: 'Pending Request', icon: 'fas fa-inbox' },
  { id: 'Processing', label: 'Processing', icon: 'fas fa-cog' },
  { id: 'Ready', label: 'Ready for Pickup', icon: 'fas fa-check-circle' },
  { id: 'Released', label: 'History', icon: 'fas fa-history' },
  { id: 'Rejected', label: 'Rejected / Cancelled', icon: 'fas fa-times-circle' },
];

// ─────────────────────────────────────────────────────────────────────────────
// WALK-IN DETECTION & STATUS NORMALIZATION
// ─────────────────────────────────────────────────────────────────────────────

const isWalkInDoc = (doc: any): boolean => {
  const method = String(doc.request_method || doc.requestMethod || '').toLowerCase();
  const ref = String(doc.reference_no || doc.referenceNo || doc.control_no || '').toUpperCase();
  return method === 'walk-in' || ref.includes('WK-IN');
};

const getEffectiveStatus = (doc: any): string => {
  const rawStatus = String(doc.status || 'Pending').toLowerCase().trim();
  if (isWalkInDoc(doc) && rawStatus !== 'rejected') {
    return 'completed';
  }
  return rawStatus;
};

const statusMatchesTab = (effectiveStatus: string, tabId: string): boolean => {
  const t = tabId.toLowerCase();
  const s = effectiveStatus;
  if (t === 'pending')    return ['pending', 'new'].includes(s);
  if (t === 'processing') return ['processing', 'accepted', 'approved'].includes(s);
  if (t === 'ready')      return ['ready', 'ready for pickup', 'for pickup'].includes(s);
  if (t === 'released')   return ['completed', 'released', 'picked-up', 'history'].includes(s);
  if (t === 'rejected')   return ['rejected', 'cancelled', 'denied'].includes(s);
  return s === t;
};

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

  // 🛡️ SELF-HEALING TAB STATE
  useEffect(() => {
    const validDocTabs = statusTabs.map(t => t.id);
    if (!validDocTabs.includes(activeTab)) {
      setActiveTab('Pending');
    }
  }, [activeTab, setActiveTab]);

  // ───────────────────────────────────────────────────────────────────────────
  // PROCESSED DATA
  // ───────────────────────────────────────────────────────────────────────────
  const processedData = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();

    return data.filter(doc => {
      const effective = getEffectiveStatus(doc);
      if (!statusMatchesTab(effective, activeTab)) return false;
      if (!query) return true;

      const typeStr = (doc.type || '').toLowerCase();
      const refStr = (doc.reference_no || doc.control_no || '').toLowerCase();
      const purposeStr = (doc.purpose || '').toLowerCase();

      return typeStr.includes(query) || refStr.includes(query) || purposeStr.includes(query);
    }).map(item => {
      const rawReason = item.rejection_reason || item.rejectionReason || item.reason || item.rejection_message || '';
      
      const isWalkIn = isWalkInDoc(item);
      const effective = getEffectiveStatus(item);

      const displayStatus = isWalkIn && effective === 'completed'
        ? 'Completed'
        : (item.status || 'Pending');

      // 🎯 THE FIX: Bulletproof Price Extraction & Display Logic
      const rawStatusStr = String(item.status || 'Pending').toLowerCase();
      const isPendingPhase = ['pending', 'new'].includes(rawStatusStr);
      
      // Safely strip any letters or currency symbols out so we get a pure number
      const cleanPriceStr = String(item.price || item.fee || 0).replace(/[^0-9.]/g, '');
      const numericPrice = parseFloat(cleanPriceStr);

      let finalPriceDisplay = 'To be assessed';
      
      // If the hook already sent a perfectly formatted string, trust it
      if (item.priceDisplay && item.priceDisplay !== 'To be assessed') {
          finalPriceDisplay = item.priceDisplay;
      } else {
          // If not, calculate it based on status and actual numeric value
          if (!isPendingPhase) {
              finalPriceDisplay = !isNaN(numericPrice) && numericPrice > 0 ? `₱${numericPrice.toFixed(2)}` : 'To be assessed';
          }
      }

      return {
        ...item,
        id: item.id,
        displayId: item.reference_no || item.control_no || 'PENDING',
        type: item.type || 'Document Request',
        date: item.date_requested ? new Date(item.date_requested).toLocaleDateString() : 'Pending',
        status: displayStatus,
        rawStatus: item.status || 'Pending',  
        isWalkIn,
        requestMethod: isWalkIn ? 'Walk-in' : 'Online',
        purpose: item.purpose || 'No details provided',
        priceDisplay: finalPriceDisplay, // 🎯 Assigned the fixed price string here
        rejectionReason: rawReason.trim() !== '' ? rawReason : null
      };
    });
  }, [data, activeTab, searchQuery]);

  return (
    <div className="CM_DOC_VIEW_CONTAINER">
      
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

      <div className="CM_DOC_TOOLBAR">
        <div className="CM_DOC_TABS_WRAPPER">
          {statusTabs.map((tab) => {
            const count = data.filter(doc => 
              statusMatchesTab(getEffectiveStatus(doc), tab.id)
            ).length;

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

                {selectedDoc.isWalkIn && (
                  <span 
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      color: '#10b981',
                      backgroundColor: '#ecfdf5',
                      border: '1px solid #a7f3d0',
                      borderRadius: '999px',
                      padding: '2px 8px',
                      marginLeft: '8px',
                      letterSpacing: '0.5px',
                      textTransform: 'uppercase'
                    }}
                  >
                    <i className="fas fa-walking" /> Walk-in
                  </span>
                )}

                <div className={`CM_DOC_SIDEBAR_STATUS STATUS_${selectedDoc.status.toUpperCase().replace(/\s+/g, '_')}`}>
                   {selectedDoc.status}
                </div>
              </div>
            </header>
            
            <div className="CM_DOC_SIDEBAR_INFO">
              <h2 className="CM_DOC_DRAWER_TITLE">{selectedDoc.type}</h2>

              {selectedDoc.isWalkIn && selectedDoc.status.toUpperCase() !== 'REJECTED' && (
                <div 
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                    padding: '12px 14px',
                    marginBottom: '16px',
                    backgroundColor: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    borderRadius: '8px',
                    color: '#166534'
                  }}
                >
                  <i className="fas fa-info-circle" style={{ marginTop: '3px', fontSize: '14px' }} />
                  <div style={{ fontSize: '13px', lineHeight: '1.5' }}>
                    <strong style={{ display: 'block', marginBottom: '2px' }}>Walk-in Release</strong>
                    This document was processed and released to you in person at the
                    Barangay Hall. No further action is required.
                  </div>
                </div>
              )}
              
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
                <label>Request Method</label>
                <p style={{ fontWeight: 700, color: selectedDoc.isWalkIn ? '#10b981' : '#3b82f6' }}>
                  <i 
                    className={selectedDoc.isWalkIn ? 'fas fa-walking' : 'fas fa-globe'} 
                    style={{ marginRight: '6px' }} 
                  />
                  {selectedDoc.requestMethod}
                </p>
              </div>

              <div className="CM_DOC_INFO_GROUP">
                <label>Purpose of Request</label>
                <div className="CM_DOC_SUMMARY_BOX">
                  <p>{selectedDoc.purpose}</p>
                </div>
              </div>

              {selectedDoc.status.toUpperCase() === 'REJECTED' && (
                <div className="CM_DOC_INFO_GROUP">
                  <label style={{ color: '#ef4444' }}>Reason for Rejection</label>
                  <div className="CM_DOC_SUMMARY_BOX" style={{ borderColor: '#fecaca', backgroundColor: '#fef2f2', color: '#b91c1c' }}>
                    <p style={{ fontStyle: 'italic', margin: 0, fontWeight: 600 }}>
                      "{selectedDoc.rejectionReason || 'No official reason provided by the administration.'}"
                    </p>
                  </div>
                </div>
              )}
              
              <div className="CM_DOC_INFO_GROUP">
                <label>Tracking Reference</label>
                <p className="CM_DOC_SIDEBAR_ID">{selectedDoc.displayId}</p>
              </div>
            </div>

            <footer className="CM_DOC_DRAWER_FOOTER">
               <button className="CM_DOC_FOOTER_BTN" onClick={() => setSelectedDoc(null)}>
                 <i className="fas fa-times-circle"></i> Close View
               </button>
            </footer>
          </div>
        )}
      </aside>

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