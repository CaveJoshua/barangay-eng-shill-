import React, { useState, useMemo, useEffect, useRef } from 'react';
import "./Styles/CommunityIncident.css";
import Community_Blotter_Request from '../../buttons/Community_Incident_Request';

interface BlotterProps {
  data: any[];
  activeTab: string;
  setActiveTab: (tab: string) => void;
  refresh: () => void;
  /** Case number / id (or '__LATEST__') of a case to scroll to & glow, set by a notification click. */
  highlightId?: string;
}

// 🛡️ ENHANCED EXTRACTOR
// The narrative is a flat string that can carry MULTIPLE attachments, e.g.:
//   "<text> [ATTACHED EVIDENCE] url1 [ATTACHED EVIDENCE] url2 [ATTACHED VIDEO] vurl"
// The old parser grabbed everything after the FIRST marker and shoved the whole
// blob into one <img src> — which broke as soon as a 2nd image (or a video) was
// attached. This walks every marker, collecting each photo URL and the video URL
// separately, and returns only the human text that precedes the first marker.
const parseEvidence = (text: string): { cleanText: string; images: string[]; videoUrl: string | null } => {
  if (!text) return { cleanText: '', images: [], videoUrl: null };

  const markerRegex = /\[ATTACHED (EVIDENCE|VIDEO)\]\s*(\S+)/g;
  const images: string[] = [];
  let videoUrl: string | null = null;
  let firstMarkerIndex = text.length;

  let match: RegExpExecArray | null;
  while ((match = markerRegex.exec(text)) !== null) {
    if (match.index < firstMarkerIndex) firstMarkerIndex = match.index;
    const url = match[2];
    if (match[1] === 'VIDEO') videoUrl = url;
    else images.push(url);
  }

  return { cleanText: text.substring(0, firstMarkerIndex).trim(), images, videoUrl };
};

// 🛡️ TABS
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

// ── 🛡️ STATUS → TAB RESOLVER (mirrors the processedData tab-match rules) ──
const matchesStatusTab = (status: string = '', tabId: string): boolean => {
  const s = (status || 'pending').toLowerCase();
  const t = tabId.toLowerCase();
  return s === t ||
         (t === 'dismissed' && ['dismissed', 'rejected'].includes(s)) ||
         (t === 'settled' && ['settled', 'archived', 'closed'].includes(s));
};

const Community_blotter: React.FC<BlotterProps> = ({
  data,
  activeTab,
  setActiveTab,
  refresh,
  highlightId,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedCase, setSelectedCase] = useState<any>(null);
  const [zoomImage, setZoomImage] = useState<string | null>(null); // 🔍 evidence lightbox

  // Close any open lightbox whenever the drawer opens/closes/switches cases.
  useEffect(() => { setZoomImage(null); }, [selectedCase]);

  // 🎯 NOTIFICATION HIGHLIGHTER — mirrors the Admin IncidentReport targeting engine.
  const [activeHighlight, setActiveHighlight] = useState<string | null>(null);
  const processedHighlightId = useRef<string | undefined>(undefined);

  // ── 🛡️ TAB NORMALIZATION ──
  useEffect(() => {
    const validTabs = STATUS_TABS.map(t => t.id.toLowerCase());
    if (!validTabs.includes(activeTab.toLowerCase())) {
      setActiveTab('Pending');
    }
  }, [activeTab, setActiveTab]);

  // 🎯 TARGETING ENGINE: when a notification hands us a case number/id, switch to
  // that case's status tab, isolate it via search, and pulse the card for ~3s.
  // Falls back to the resident's most recent case when nothing specific matches.
  useEffect(() => {
    if (!highlightId || processedHighlightId.current === highlightId || !data || data.length === 0) return;

    const wanted = String(highlightId).toUpperCase();
    const matches = (c: any) =>
      String(c.id ?? '').toUpperCase() === wanted ||
      String(c.record_id ?? '').toUpperCase() === wanted ||
      String(c.case_number ?? '').toUpperCase() === wanted ||
      String(c.case_no ?? '').toUpperCase() === wanted;

    const target = data.find(matches) || data[0];
    if (!target) return;

    processedHighlightId.current = highlightId;

    const tab = STATUS_TABS.find(tb => matchesStatusTab(target.status, tb.id));
    if (tab) setActiveTab(tab.id);

    const ref = target.case_number || target.case_no || '';
    setSearchQuery(ref ? String(ref) : '');

    setActiveHighlight(String(target.id ?? target.record_id));
    const timer = setTimeout(() => setActiveHighlight(null), 3000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightId, data]);

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
      
      let rawName = item.complainant_name || item.resident_name || (item.residents && item.residents.resident_name) || item.complainant || item.full_name || item.reporter || 'RESIDENT';
      let nameStr = String(rawName).trim();
      
      if (!nameStr || nameStr.toLowerCase().includes('anonymous')) {
          nameStr = 'RESIDENT';
      }

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

      {/* ── TOOLBAR & SCROLLABLE TABS ── */}
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

      {/* ── THE LONG HORIZONTAL PANEL LIST ── */}
      <div className="CM_INC_MAIN_LAYOUT">
        <div className="CM_INC_LIST_LAYOUT">
          {processedData.length > 0 ? (
            processedData.map((caseItem) => {
              const safeStatusClass = caseItem.status.replace(/\s+/g, '_');
              const isHighlighted = activeHighlight != null && String(caseItem.id) === String(activeHighlight);

              return (
                <div
                  key={caseItem.id}
                  data-row-id={caseItem.id}
                  ref={(el) => { if (el && isHighlighted) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}
                  className={`CM_INC_LONG_PANEL ${isHighlighted ? 'notif-highlight-row' : ''}`}
                  onClick={() => setSelectedCase(caseItem)}
                >
                  
                  {/* TOP: ICON, TITLE, STATUS */}
                  <div className="CM_INC_PANEL_TOP">
                    <div className="CM_INC_PANEL_LEFT">
                      <div className="CM_INC_PANEL_ICON">
                        <i className={getIncidentIcon(caseItem.incident_type)}></i>
                      </div>
                      <div className="CM_INC_PANEL_TITLES">
                        <span className="CM_INC_PANEL_ID">{caseItem.case_no}</span>
                        <h3 className="CM_INC_PANEL_HEADING">{caseItem.incident_type}</h3>
                      </div>
                    </div>
                    <div className={`CM_INC_PANEL_STATUS STATUS_${safeStatusClass}`}>
                      {caseItem.status}
                    </div>
                  </div>

                  {/* MIDDLE: GRAY INFO BOX */}
                  <div className="CM_INC_PANEL_INNER_BOX">
                    <div className="CM_INC_INNER_ROW">
                      <i className="fas fa-calendar-day"></i>
                      <span><strong>Date Filed:</strong> {new Date(caseItem.incident_date).toLocaleDateString()}</span>
                    </div>
                    <div className="CM_INC_INNER_ROW">
                      <i className="fas fa-user-tag"></i>
                      <span><strong>Complainant:</strong> {caseItem.complainant}</span>
                    </div>
                  </div>

                  {/* FOOTER: ACTION LINK */}
                  <div className="CM_INC_PANEL_FOOTER">
                    <span className="CM_INC_VIEW_LINK">
                      View Details <i className="fas fa-arrow-right"></i>
                    </span>
                  </div>

                </div>
              );
            })
          ) : (
            <div className="CM_INC_EMPTY_STATE">
              <i className="fas fa-folder-open" />
              <p>No records found in {activeTab}.</p>
            </div>
          )}
        </div>
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
                <div className={`CM_INC_SIDEBAR_STATUS STATUS_${selectedCase.status.replace(/\s+/g, '_')}`}>
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
                    const { cleanText, images, videoUrl } = parseEvidence(selectedCase.narrative);
                    return (
                      <>
                        <p dangerouslySetInnerHTML={{ __html: cleanText }}></p>

                        {/* 🖼️ PHOTO EVIDENCE — gallery; click any photo to zoom */}
                        {images.length > 0 && (
                          <div style={{ marginTop: '20px', borderTop: '1px solid var(--c--p--border-subtle)', paddingTop: '15px' }}>
                            <span style={{ display: 'block', fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--c--p--brand-blue)', marginBottom: '10px' }}>
                              <i className="fas fa-paperclip"></i> ATTACHED PHOTO EVIDENCE ({images.length})
                            </span>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '10px' }}>
                              {images.map((url, i) => (
                                <button
                                  key={i}
                                  type="button"
                                  title="Click to enlarge"
                                  onClick={(e) => { e.stopPropagation(); setZoomImage(url); }}
                                  style={{
                                    padding: 0, border: '1px solid var(--c--p--border-subtle)', borderRadius: '8px',
                                    overflow: 'hidden', cursor: 'zoom-in', background: 'none',
                                    position: 'relative', aspectRatio: '1 / 1',
                                  }}
                                >
                                  <img
                                    src={url}
                                    alt={`Attached Evidence ${i + 1}`}
                                    loading="lazy"
                                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                                  />
                                  <span style={{
                                    position: 'absolute', right: '6px', bottom: '6px',
                                    width: '24px', height: '24px', borderRadius: '50%',
                                    background: 'rgba(0,0,0,0.6)', color: '#fff',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem',
                                  }}>
                                    <i className="fas fa-search-plus"></i>
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* 🎥 VIDEO EVIDENCE — inline player */}
                        {videoUrl && (
                          <div style={{ marginTop: '20px', borderTop: '1px solid var(--c--p--border-subtle)', paddingTop: '15px' }}>
                            <span style={{ display: 'block', fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--c--p--brand-blue)', marginBottom: '10px' }}>
                              <i className="fas fa-video"></i> ATTACHED VIDEO EVIDENCE
                            </span>
                            <video
                              src={videoUrl}
                              controls
                              preload="metadata"
                              style={{ width: '100%', borderRadius: '8px', border: '1px solid var(--c--p--border-subtle)', background: '#000', display: 'block' }}
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

      {/* 🔍 EVIDENCE LIGHTBOX — full-screen zoom for a tapped photo */}
      {zoomImage && (
        <div
          onClick={() => setZoomImage(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 100000,
            background: 'rgba(0, 0, 0, 0.88)', backdropFilter: 'blur(2px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '24px', cursor: 'zoom-out',
          }}
        >
          <button
            type="button"
            aria-label="Close"
            onClick={(e) => { e.stopPropagation(); setZoomImage(null); }}
            style={{
              position: 'absolute', top: '18px', right: '22px',
              width: '44px', height: '44px', borderRadius: '50%', border: 'none',
              background: 'rgba(255, 255, 255, 0.15)', color: '#fff',
              fontSize: '1.3rem', cursor: 'pointer', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <i className="fas fa-times"></i>
          </button>
          <img
            src={zoomImage}
            alt="Evidence (enlarged)"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '95vw', maxHeight: '90vh', objectFit: 'contain',
              borderRadius: '8px', boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)', cursor: 'default',
            }}
          />
        </div>
      )}
    </div>
  );
};

export default Community_blotter;