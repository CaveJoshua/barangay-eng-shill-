import React, { useState, useMemo, useEffect } from 'react';
import "./C-Styles/Community_blotter.css";
import Community_Blotter_Request from '../../buttons/Community_Blotter_Request'; 

interface BlotterProps {
  data: any[]; 
  activeTab: string;
  setActiveTab: (tab: string) => void;
  refresh: () => void;
}

// 🛡️ THE FIX: Added "Pending" tab so incoming reports aren't invisible!
const STATUS_TABS = [
  { id: 'Pending', label: 'Pending / New', icon: 'fas fa-inbox' },
  { id: 'Active', label: 'Active Cases', icon: 'fas fa-gavel' },
  { id: 'Hearing', label: 'Hearings', icon: 'fas fa-calendar-alt' },
  { id: 'Settled', label: 'Settled', icon: 'fas fa-handshake' },
  { id: 'Dismissed', label: 'Dismissed', icon: 'fas fa-times-circle' },
] as const;

const Community_blotter: React.FC<BlotterProps> = ({ 
  data, 
  activeTab, 
  setActiveTab,
  refresh 
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedCase, setSelectedCase] = useState<any>(null);

  // ── 🛡️ TAB NORMALIZATION ──
  useEffect(() => {
    const validTabs = STATUS_TABS.map(t => t.id.toLowerCase());
    if (!validTabs.includes(activeTab.toLowerCase())) {
      setActiveTab('Pending'); // Default to Pending now
    }
  }, [activeTab, setActiveTab]);

  // ── 🔍 DATA TRANSFORMATION LOGIC (BULLETPROOFED) ──
  const processedData = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    
    return data.filter(item => {
      const docStatus = (item.status || 'Pending').toLowerCase();
      const tabStatus = activeTab.toLowerCase();
      
      const matchesTab = docStatus === tabStatus || 
                         (tabStatus === 'dismissed' && ['dismissed', 'rejected'].includes(docStatus)) ||
                         (tabStatus === 'settled' && ['settled', 'archived', 'closed'].includes(docStatus));
      
      if (!matchesTab) return false;
      if (!query) return true;

      // Safe search checking
      const searchName = item.complainant_name || item.resident_name || item.residents?.resident_name || item.complainant || item.full_name || '';
      return String(item.case_no || item.case_number || '').toLowerCase().includes(query) || 
             String(item.incident_type || '').toLowerCase().includes(query) ||
             String(searchName).toLowerCase().includes(query);

    }).map(item => {
      
      // 1. EXTRACT NAME (Aggressively check every possible database column including the new complainant_name)
      let rawName = item.complainant_name
                 || item.resident_name 
                 || (item.residents && item.residents.resident_name) 
                 || item.complainant 
                 || item.full_name 
                 || item.reporter 
                 || 'RESIDENT';

      // 2. CONVERT TO STRING FOR SAFETY
      let nameStr = String(rawName).trim();

      // 3. THE KILL SWITCH
      if (!nameStr || nameStr.toLowerCase().includes('anonymous')) {
          nameStr = 'RESIDENT';
      }

      // 4. ADMIN FORMATTING: Force strict CAPSLOCK
      const finalDisplayName = nameStr.toUpperCase();

      return {
        ...item,
        id: item.id || item.record_id,
        case_no: String(item.case_number || item.case_no || 'PENDING').toUpperCase(),
        complainant: finalDisplayName, 
        incident_type: String(item.incident_type || 'GENERAL COMPLAINT').toUpperCase(),
        incident_date: item.date_filed || item.incident_date || item.created_at || new Date().toISOString(),
        status: String(item.status || 'Pending').toUpperCase(),
        narrative: String(item.narrative || item.incident_narrative || "NO ADDITIONAL NARRATIVE PROVIDED.")
      };
    });
  }, [data, activeTab, searchQuery]);

  return (
    <div className="DOC_VIEW_CONTAINER"> 
      
      <header className="DOC_HEADER_CARD">
        <div className="HEADER_TEXT">
          <h1>Incident Report</h1>
          <p>Confidential records and incident tracking for Engineer's Hill.</p>
        </div>
        <button className="BTN_REQUEST_NEW" onClick={() => setIsModalOpen(true)}>
          <i className="fas fa-plus" /> <span>File Report</span>
        </button>
      </header>

      <Community_Blotter_Request 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        onSuccess={refresh} 
      />

      <div className="DOC_TOOLBAR">
        <div className="DOC_TABS_WRAPPER">
          {STATUS_TABS.map((tab) => {
            const count = data.filter(item => {
              const docStatus = (item.status || 'Pending').toLowerCase();
              const tabStatus = tab.id.toLowerCase();
              return docStatus === tabStatus || 
                     (tabStatus === 'dismissed' && ['dismissed', 'rejected'].includes(docStatus)) ||
                     (tabStatus === 'settled' && ['settled', 'archived', 'closed'].includes(docStatus));
            }).length;

            return (
              <button
                key={tab.id}
                className={`DOC_TAB_ITEM ${activeTab.toLowerCase() === tab.id.toLowerCase() ? 'ACTIVE' : ''}`}
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
            placeholder="Search cases by name or ID..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="BLOTTER_MAIN_LAYOUT">
        <main className="DOC_LIST_STAGE">
          {processedData.length > 0 ? (
            processedData.map((caseItem) => (
              <div key={caseItem.id} className="DOC_CARD_ITEM">
                <div className="DOC_HEADER">
                  <div className="DOC_ID_GROUP">
                    <strong>{caseItem.incident_type}</strong>
                    <span className="DOC_REF">{caseItem.case_no}</span>
                  </div>
                  <div className={`DOC_STATUS ${caseItem.status}`}>
                    {caseItem.status}
                  </div>
                </div>

                <div className="DOC_BODY">
                  <div className="DOC_ICON_BOX"><i className="fas fa-shield-alt" /></div>
                  <div className="DOC_INFO">
                    <h4>{caseItem.incident_type}</h4>
                    <p className="DOC_DESC">Complainant: <strong>{caseItem.complainant}</strong></p>
                    <p className="DOC_DATE">
                        <i className="far fa-calendar-alt" /> {new Date(caseItem.incident_date).toLocaleDateString()}
                    </p>
                  </div>
                  <button className="BTN_VIEW_DETAILS" onClick={() => setSelectedCase(caseItem)}>
                    View Details <i className="fas fa-arrow-right" />
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="DOC_EMPTY_STATE">
              <i className="fas fa-folder-open" />
              <p>No records found in {activeTab}.</p>
            </div>
          )}
        </main>
      </div>

      <div 
        className={`DRAWER_OVERLAY ${selectedCase ? 'SHOW' : ''}`} 
        onClick={() => setSelectedCase(null)} 
      />

      <aside className={`SLIDE_DRAWER ${selectedCase ? 'OPEN' : ''}`}>
        {selectedCase && (
          <div className="DRAWER_CONTENT">
            <header className="DRAWER_HEADER">
              <button className="CLOSE_DRAWER" onClick={() => setSelectedCase(null)}>
                <i className="fas fa-times" />
              </button>
              <div className="HEADER_META">
                <span className="SIDEBAR_ID">{selectedCase.case_no}</span>
                <div className={`SIDEBAR_STATUS ${selectedCase.status}`}>
                   {selectedCase.status}
                </div>
              </div>
            </header>
            
            <div className="SIDEBAR_INFO">
              <h2 className="DRAWER_TITLE">{selectedCase.incident_type}</h2>
              <div className="INFO_GROUP">
                <label>Complainant Name</label>
                <p>{selectedCase.complainant}</p>
              </div>
              <div className="INFO_GROUP">
                <label>Date & Time of Incident</label>
                <p>{new Date(selectedCase.incident_date).toLocaleString()}</p>
              </div>
              <div className="INFO_GROUP">
                <label>Incident Narrative / Summary</label>
                <div className="SUMMARY_BOX">
                  {/* 🛡️ THE FIX: Render HTML tags from the database correctly instead of literal string */}
                  <p dangerouslySetInnerHTML={{ __html: selectedCase.narrative }}></p>
                </div>
              </div>
            </div>
            <footer className="DRAWER_FOOTER">
               <button className="FOOTER_BTN" onClick={() => setSelectedCase(null)}>Close View</button>
            </footer>
          </div>
        )}
      </aside>
    </div>
  );
};

export default Community_blotter;