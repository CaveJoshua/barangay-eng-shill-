import React from 'react';
import './styles/Community_Document_view.css';

interface DocItem {
  id: string;
  type: string;
  date: string;
  status: string;
  details: string;
  price?: string; // Made optional as Incident Reports usually don't have prices
  isIncident?: boolean; // New flag to distinguish between Docs and Blotters
}

interface Props {
  data: DocItem[];
  onSelect?: (item: DocItem) => void;
}

const Community_Document_view: React.FC<Props> = ({ data = [], onSelect }) => {
  if (!data || data.length === 0) {
    return (
      <div className="DOC_EMPTY_STATE">
        <i className="fas fa-folder-open" />
        <p>No active records or reports found.</p>
      </div>
    );
  }

  return (
    <>
      <div className="DOC_SECTION_LABEL">Recent Activities & Reports</div>
      {data.map((req) => {
        const isHearing = req.status?.toLowerCase() === 'hearing';

        return (
          <div 
            key={req.id} 
            className={`DOC_CARD_ITEM ${isHearing ? 'STATUS_HEARING_BORDER' : ''}`} 
            onClick={() => onSelect?.(req)}
          >
            <div className="DOC_HEADER">
              <div className="DOC_ID_GROUP">
                {/* Dynamic Label: Show 'Incident' tag if it's a blotter */}
                {req.isIncident && <span className="INCIDENT_TAG">INCIDENT</span>}
                <strong>{req.type}</strong>
                <span className="DOC_REF">#{req.id}</span>
              </div>
              
              {/* Status Badge with dynamic class */}
              <div className={`DOC_STATUS ${req.status?.toUpperCase().replace(/\s/g, '_')}`}>
                {isHearing && <i className="fas fa-gavel pulse-icon" style={{ marginRight: '6px' }} />}
                {req.status}
              </div>
            </div>

            <div className="DOC_BODY">
              <div className="DOC_ICON_BOX">
                {/* Change icon based on type */}
                <i className={req.isIncident ? "fas fa-shield-alt" : "fas fa-file-alt"} />
              </div>
              
              <div className="DOC_INFO">
                <h4>{req.type}</h4>
                <p className="DOC_DESC">{req.details}</p>
                
                {/* Special highlight for Hearing Date if applicable */}
                {isHearing ? (
                  <p className="HEARING_NOTICE">
                    <i className="fas fa-calendar-check" /> Next Hearing: {req.date}
                  </p>
                ) : (
                  <p className="DOC_DATE">{req.date}</p>
                )}
              </div>

              {/* Only show price if it's a document request */}
              {!req.isIncident && req.price && (
                <div className="DOC_PRICE_TAG">{req.price}</div>
              )}
            </div>
            
            {/* Visual Indicator for 'Hearing' stage */}
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

export default Community_Document_view;