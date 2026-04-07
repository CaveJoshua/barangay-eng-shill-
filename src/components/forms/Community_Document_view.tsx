import React from 'react';
import './styles/Community_Document_view.css';

// ── 🛡️ INTERFACE ─────────────────────────────────────────────────────────
interface DocItem {
  id: string;
  displayId: string;   
  type: string;
  date: string;
  status: string;
  purpose: string;     
  priceDisplay: string; 
}

interface Props {
  data: DocItem[];
  onSelect: (item: DocItem) => void;
}

const Community_Document_view: React.FC<Props> = ({ data, onSelect }) => {
  // 1. THE FIX: Bulletproof Array Check
  // Prevents crashes if the parent passes null/undefined during a re-fetch
  if (!data || !Array.isArray(data) || data.length === 0) return null;

  return (
    <>
      <div className="DOC_SECTION_LABEL">Document Requests</div>
      <div className="DOC_GRID_LAYOUT">
        {data.map((req) => {
          
          // 2. THE FIX: Safe Status Formatting
          // Replaces spaces with underscores so "Ready for Pickup" becomes "READY_FOR_PICKUP"
          const safeStatusClass = req.status 
            ? req.status.replace(/\s+/g, '_').toUpperCase() 
            : 'PENDING';

          // 3. THE FIX: Flexible Price Checking
          // Checks if the string includes "assess" regardless of uppercase/lowercase
          const isPendingPrice = !req.priceDisplay || req.priceDisplay.toLowerCase().includes('assess');

          return (
            <div key={req.id || Math.random().toString()} className="DOC_CARD_ITEM" onClick={() => onSelect(req)}>
              
              <div className="DOC_HEADER">
                <div className="DOC_ID_GROUP">
                    <strong>{req.type || 'Document'}</strong>
                    {/* Added fallback text in case the ID hasn't registered yet */}
                    <span className="DOC_REF">{req.displayId || 'Generating ID...'}</span>
                </div>
                <div className={`DOC_STATUS ${safeStatusClass}`}>
                    {req.status || 'Pending'}
                </div>
              </div>

              <div className="DOC_BODY">
                <div className="DOC_ICON_BOX">
                    <i className="fas fa-file-invoice"></i>
                </div>
                <div className="DOC_INFO">
                  <h4>{req.type || 'Document Request'}</h4>
                  <p className="DOC_DESC">{req.purpose || 'Purpose not specified'}</p>
                  <p className="DOC_DATE">
                    <i className="far fa-calendar-alt"></i> {req.date || 'Processing Date...'}
                  </p>
                </div>
              </div>

              <div className="DOC_FOOTER">
                 <div className="DOC_PRICE_CONTAINER">
                    <span className="PRICE_LBL">Document Fee</span>
                    <span className={`PRICE_VAL ${isPendingPrice ? 'PENDING' : 'SET'}`}>
                      {req.priceDisplay || 'To be assessed'}
                    </span>
                 </div>
                 <button className="DOC_BTN_VIEW" onClick={(e) => {
                    e.stopPropagation(); 
                    onSelect(req);
                 }}>
                    View Details <i className="fas fa-chevron-right"></i>
                 </button>
              </div>

            </div>
          );
        })}
      </div>
    </>
  );
};

export default Community_Document_view;