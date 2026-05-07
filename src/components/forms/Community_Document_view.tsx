import React from 'react';
import './styles/Community_Document_view.css';

interface DocItem {
  id: string;
  displayId: string;   
  type: string;
  date: string;
  status: string;
  purpose: string;     
  priceDisplay: string; 
  rejectionReason?: string;
}

interface Props {
  data: DocItem[];
  onSelect: (item: DocItem) => void;
}

const Community_Document_view: React.FC<Props> = ({ data, onSelect }) => {
  if (!data || !Array.isArray(data) || data.length === 0) return null;

  return (
    <div className="CM_DOC_LIST_LAYOUT">
      {data.map((req) => {
        const statusUpper = (req.status || 'PENDING').toUpperCase();
        const safeStatusClass = statusUpper.replace(/\s+/g, '_');
        const isPendingPrice = !req.priceDisplay || req.priceDisplay.toLowerCase().includes('assess');
        
        // Status Flags
        const isRejected = statusUpper === 'REJECTED';
        const isReady = statusUpper === 'READY' || statusUpper === 'READY_FOR_PICKUP';

        return (
          <div key={req.id || Math.random().toString()} className="CM_DOC_LONG_PANEL" onClick={() => onSelect(req)}>
            
            {/* ── TOP SECTION: Icon, Title, Status ── */}
            <div className="CM_DOC_PANEL_TOP">
              <div className="CM_DOC_PANEL_LEFT">
                <div className="CM_DOC_PANEL_ICON">
                  <i className="fas fa-file-invoice"></i>
                </div>
                <div className="CM_DOC_PANEL_TITLES">
                  <span className="CM_DOC_PANEL_ID">{req.displayId || 'GENERATING...'}</span>
                  <h3 className="CM_DOC_PANEL_HEADING">{req.type || 'DOCUMENT REQUEST'}</h3>
                </div>
              </div>
              <div className={`CM_DOC_PANEL_STATUS ${safeStatusClass}`}>
                {req.status || 'PENDING'}
              </div>
            </div>

            {/* ── MIDDLE SECTION: Info Box ── */}
            <div className="CM_DOC_PANEL_INNER_BOX">
              <div className="CM_DOC_INNER_ROW">
                <i className="fas fa-calendar-day"></i>
                <span><strong>Date Requested:</strong> {req.date}</span>
              </div>
              
              <div className="CM_DOC_INNER_ROW">
                <i className="fas fa-money-bill-wave"></i>
                <span>
                  <strong>Document Fee:</strong>{' '}
                  <span className={isPendingPrice ? 'FEE_PENDING' : 'FEE_SET'}>
                    {req.priceDisplay}
                  </span>
                </span>
              </div>

              {/* ── 🛡️ REJECTED NOTICE ── */}
              {isRejected && (
                <div className="CM_DOC_STATUS_NOTICE NOTICE_REJECTED">
                  <div className="NOTICE_LABEL">
                    <i className="fas fa-exclamation-circle"></i> REASON FOR REJECTION
                  </div>
                  {req.rejectionReason && (
                    <p className="REJECTION_TEXT">"{req.rejectionReason}"</p>
                  )}
                  <p className="NOTICE_INSTRUCTION">
                    Please come to the Barangay Hall for more information.
                  </p>
                </div>
              )}

              {/* ── ✅ READY NOTICE ── */}
              {isReady && (
                <div className="CM_DOC_STATUS_NOTICE NOTICE_READY">
                  <div className="NOTICE_LABEL">
                    <i className="fas fa-check-circle"></i> DOCUMENT READY
                  </div>
                  <p className="NOTICE_INSTRUCTION">
                    Your document has been processed. Please visit the Barangay Hall to claim it.
                  </p>
                </div>
              )}
            </div>

            {/* ── BOTTOM SECTION: View Details ── */}
            <div className="CM_DOC_PANEL_FOOTER">
              <span className="CM_DOC_VIEW_LINK">
                View Details <i className="fas fa-arrow-right"></i>
              </span>
            </div>

          </div>
        );
      })}
    </div>
  );
};

export default Community_Document_view;