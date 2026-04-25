import React, { useState, useMemo, useEffect } from 'react';
import "./C-Styles/Community_blotter.css";
import Community_Blotter_Request from '../../buttons/Community_Blotter_Request'; 

interface BlotterProps {
  data: any[]; 
  activeTab: string;
  setActiveTab: (tab: string) => void;
  refresh: () => void;
}

// 🛡️ ENHANCED EXTRACTOR: Safely extracts both the clean text AND the actual image URL
const parseEvidence = (text: string) => {
  if (!text) return { cleanText: '', evidenceUrl: null };
  
  const marker = '[ATTACHED EVIDENCE]';
  const markerIndex = text.indexOf(marker);
  
  if (markerIndex !== -1) {
    return { 
      cleanText: text.substring(0, markerIndex).trim(), 
      evidenceUrl: text.substring(markerIndex + marker.length).trim() 
    };
  }
  
  return { cleanText: text, evidenceUrl: null };
};

// 🛡️ THE FIX: Added "Pending" tab so incoming reports aren't invisible!
const STATUS_TABS = [
  { id: 'Pending', label: 'Pending / New', icon: 'fas fa-inbox' },
  { id: 'Active', label: 'Active Cases', icon: 'fas fa-gavel' },
  { id: 'Hearing', label: 'Hearings', icon: 'fas fa-calendar-alt' },
  { id: 'Settled', label: 'Settled', icon: 'fas fa-handshake' },
  { id: 'Dismissed', label: 'Dismissed', icon: 'fas fa-times-circle' },
] as const;

// ── HELPER: GET ICON BASED ON INCIDENT TYPE ──
const getIncidentIcon = (type: string = '') => {
  const t = type.toLowerCase();
  if (t.includes('noise')) return 'fas fa-volume-up';
  if (t.includes('theft') || t.includes('robbery')) return 'fas fa-mask';
  if (t.includes('injury') || t.includes('physical')) return 'fas fa-user-injured';
  if (t.includes('threat')) return 'fas fa-exclamation-triangle';
  return 'fas fa-gavel'; // Default icon
};

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

  // ── 🔄 AUTO-FETCH TRIGGER ──
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      
      // 1. EXTRACT NAME 
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
    <div className="CM_INC_VIEW_CONTAINER"> 
      
      <header className="CM_INC_HEADER_CARD">
        <div className="CM_INC_HEADER_TEXT">
          <h1>Incident Report</h1>
          <p>Confidential records and incident tracking for Engineer's Hill.</p>
        </div>
        <button className="CM_INC_BTN_REQUEST_NEW" onClick={() => setIsModalOpen(true)}>
          <i className="fas fa-plus" /> <span>File Report</span>
        </button>
      </header>

      <Community_Blotter_Request 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        onSuccess={refresh} 
      />

      <div className="CM_INC_TOOLBAR">
        <div className="CM_INC_TABS_WRAPPER">
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
                className={`CM_INC_TAB_ITEM ${activeTab.toLowerCase() === tab.id.toLowerCase() ? 'ACTIVE' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <i className={tab.icon} />
                <div className="CM_INC_TAB_INFO">
                  <span className="CM_INC_LBL">{tab.label}</span>
                  <span className="CM_INC_CNT">({count})</span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="CM_INC_SEARCH_BOX">
          <i className="fas fa-search" />
          <input 
            type="text" 
            placeholder="Search cases by name or ID..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="CM_INC_MAIN_LAYOUT">
        <main className="CM_INC_GRID_LAYOUT">
          {processedData.length > 0 ? (
            processedData.map((caseItem) => (
              <div key={caseItem.id} className="CM_INC_CARD_ITEM" onClick={() => setSelectedCase(caseItem)}>
                
                <div className="CM_INC_CARD_HEADER">
                  <div className="CM_INC_TITLE_GROUP">
                    <div className="CM_INC_ICON_BOX">
                      <i className={getIncidentIcon(caseItem.incident_type)}></i>
                    </div>
                    <div className="CM_INC_TITLE_TEXT">
                      <span className="CM_INC_ID_LABEL">{caseItem.case_no}</span>
                      <h3>{caseItem.incident_type}</h3>
                    </div>
                  </div>
                  <div className={`CM_INC_STATUS_BADGE STATUS_${caseItem.status}`}>
                    {caseItem.status}
                  </div>
                </div>

                <div className="CM_INC_CARD_BODY">
                  <div className="CM_INC_INFO_ROW">
                    <i className="fas fa-calendar-day"></i>
                    <span><strong>Date Filed:</strong> {new Date(caseItem.incident_date).toLocaleDateString()}</span>
                  </div>
                  <div className="CM_INC_INFO_ROW">
                    <i className="fas fa-user-tag"></i>
                    <span><strong>Complainant:</strong> {caseItem.complainant}</span>
                  </div>
                </div>

                <div className="CM_INC_CARD_FOOTER">
                  <button className="CM_INC_ACTION_BTN">
                    View Details <i className="fas fa-arrow-right" />
                  </button>
                </div>

              </div>
            ))
          ) : (
            <div className="CM_INC_EMPTY_STATE">
              <i className="fas fa-folder-open" />
              <p>No records found in {activeTab}.</p>
            </div>
          )}
        </main>
      </div>

      {/* ── ISOLATED SLIDE DRAWER ── */}
      <div 
        className={`CM_INC_DRAWER_OVERLAY ${selectedCase ? 'SHOW' : ''}`} 
        onClick={() => setSelectedCase(null)} 
      />

      <aside className={`CM_INC_SLIDE_DRAWER ${selectedCase ? 'OPEN' : ''}`}>
        {selectedCase && (
          <div className="CM_INC_DRAWER_CONTENT">
            <header className="CM_INC_DRAWER_HEADER">
              <button className="CM_INC_CLOSE_DRAWER" onClick={() => setSelectedCase(null)}>
                <i className="fas fa-times" />
              </button>
              <div className="CM_INC_HEADER_META">
                <span className="CM_INC_SIDEBAR_ID">{selectedCase.case_no}</span>
                <div className={`CM_INC_SIDEBAR_STATUS STATUS_${selectedCase.status}`}>
                   {selectedCase.status}
                </div>
              </div>
            </header>
            
            <div className="CM_INC_SIDEBAR_INFO">
              <h2 className="CM_INC_DRAWER_TITLE">{selectedCase.incident_type}</h2>
              <div className="CM_INC_INFO_GROUP">
                <label>Complainant Name</label>
                <p>{selectedCase.complainant}</p>
              </div>
              <div className="CM_INC_INFO_GROUP">
                <label>Date & Time of Incident</label>
                <p>{new Date(selectedCase.incident_date).toLocaleString()}</p>
              </div>
              <div className="CM_INC_INFO_GROUP">
                <label>Incident Narrative / Summary</label>
                <div className="CM_INC_SUMMARY_BOX">
                  {(() => {
                    const { cleanText, evidenceUrl } = parseEvidence(selectedCase.narrative);
                    return (
                      <>
                        <p dangerouslySetInnerHTML={{ __html: cleanText }}></p>
                        
                        {evidenceUrl && (
                          <div style={{ marginTop: '20px', borderTop: '1px solid var(--c--p--border-subtle)', paddingTop: '15px' }}>
                            <span style={{ display: 'block', fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--c--p--brand-blue)', marginBottom: '10px' }}>
                              <i className="fas fa-paperclip"></i> ATTACHED EVIDENCE
                            </span>
                            <img 
                              src={evidenceUrl} 
                              alt="Attached Evidence" 
                              style={{ width: '100%', borderRadius: '8px', border: '1px solid var(--c--p--border-subtle)' }}
                            />
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>

            <footer className="CM_INC_DRAWER_FOOTER">
               <button 
                 className="CM_INC_FOOTER_BTN" 
                 onClick={() => setSelectedCase(null)}
               >
                 <i className="fas fa-times-circle"></i> Close View
               </button>
            </footer>
          </div>
        )}
      </aside>
    </div>
  );
};

export default Community_blotter;