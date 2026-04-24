import React from 'react';
import './styles/Community_Incident_view.css';

interface IncidentItem {
  id: string;
  type: string;
  date: string;
  status: string;
  details: string;
  price?: string; 
  isIncident?: boolean; 
}

interface Props {
  data: IncidentItem[];
  onSelect?: (item: IncidentItem) => void;
}

// 🛡️ ENHANCED EXTRACTOR: Safely extracts both the clean text AND the actual image URL
const parseEvidence = (text: string) => {
  if (!text) return { cleanText: '', evidenceUrl: null };
  
  const marker = '[ATTACHED EVIDENCE]';
  const markerIndex = text.indexOf(marker);
  
  if (markerIndex !== -1) {
    return { 
      // Text before the marker
      cleanText: text.substring(0, markerIndex).trim(), 
      // URL after the marker
      evidenceUrl: text.substring(markerIndex + marker.length).trim() 
    };
  }
  
  return { cleanText: text, evidenceUrl: null };
};

const Community_Incident_view: React.FC<Props> = ({ data = [], onSelect }) => {
  if (!data || data.length === 0) {
    return (
      <div className="INC_EMPTY_STATE">
        <i className="fas fa-folder-open" />
        <p>No active records or reports found.</p>
      </div>
    );
  }

  return (
    <>
      <div className="INC_SECTION_LABEL">Recent Activities & Reports</div>
      {data.map((req) => {
        const isHearing = req.status?.toLowerCase() === 'hearing';
        
        // 🛡️ Extract both the text and the actual image link
        const { cleanText, evidenceUrl } = parseEvidence(req.details);

        return (
          <div 
            key={req.id} 
            className={`INC_CARD_ITEM ${isHearing ? 'STATUS_HEARING_BORDER' : ''}`} 
            onClick={() => onSelect?.(req)}
          >
            <div className="INC_HEADER">
              <div className="INC_ID_GROUP">
                {req.isIncident && <span className="INCIDENT_TAG">INCIDENT</span>}
                <strong>{req.type}</strong>
                <span className="INC_REF">#{req.id}</span>
              </div>
              
              <div className={`INC_STATUS ${req.status?.toUpperCase().replace(/\s/g, '_')}`}>
                {isHearing && <i className="fas fa-gavel pulse-icon" style={{ marginRight: '6px' }} />}
                {req.status}
              </div>
            </div>

            <div className="INC_BODY">
              <div className="INC_ICON_BOX">
                <i className={req.isIncident ? "fas fa-shield-alt" : "fas fa-file-alt"} />
              </div>
              
              <div className="INC_INFO">
                <h4>{req.type}</h4>
                
                {/* Render the clean text without the messy URL */}
                <p className="INC_DESC">{cleanText}</p>
                
                {/* 🛡️ RENDER THE ACTUAL IMAGE IF IT EXISTS */}
                {evidenceUrl && (
                  <div style={{ marginTop: '12px', marginBottom: '8px' }}>
                    <div style={{ marginBottom: '6px', fontSize: '0.75rem', color: '#2563eb', fontWeight: 600 }}>
                      <i className="fas fa-paperclip" style={{ marginRight: '4px' }}></i> 
                      Attached Evidence:
                    </div>
                    <img 
                      src={evidenceUrl} 
                      alt="Attached Evidence" 
                      style={{
                        width: '100%',
                        maxWidth: '250px', // Keeps it from getting too huge in the list view
                        maxHeight: '150px',
                        objectFit: 'cover', // Ensures the image doesn't stretch weirdly
                        borderRadius: '8px',
                        border: '1px solid var(--c--p--border-subtle)',
                        backgroundColor: 'var(--c--p--bg-switcher)'
                      }}
                    />
                  </div>
                )}
                
                {isHearing ? (
                  <p className="HEARING_NOTICE" style={{ marginTop: '8px' }}>
                    <i className="fas fa-calendar-check" /> Next Hearing: {req.date}
                  </p>
                ) : (
                  <p className="INC_DATE" style={{ marginTop: '8px' }}>{req.date}</p>
                )}
              </div>

              {!req.isIncident && req.price && (
                <div className="INC_PRICE_TAG">{req.price}</div>
              )}
            </div>
            
            {isHearing && (
              <div className="HEARING_PROGRESS_TRACK">
                <div className="PROGRESS_BAR_HEARING" />
                <span>Case is currently in Mediation/Hearing</span>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
};

export default Community_Incident_view;