import React from 'react';
import './styles/Community_Document_view.css';

interface DocItem {
  id: string;
  type: string;
  date: string;
  status: string;
  details: string;
  price: string;
}

interface Props {
  data: DocItem[]; // This is what the parent sends
  onSelect?: (item: DocItem) => void;
}

// ── ADD THE FALLBACK: { data = [] } ──
const Community_Document_view: React.FC<Props> = ({ data = [], onSelect }) => {
  // If data is undefined or null, it defaults to [] and won't crash
  if (!data || data.length === 0) {
    return (
      <div className="DOC_EMPTY_STATE">
        <i className="fas fa-folder-open" />
        <p>No records found.</p>
      </div>
    );
  }

  return (
    <>
      <div className="DOC_SECTION_LABEL">Document Requests</div>
      {data.map((req) => (
        <div key={req.id} className="DOC_CARD_ITEM" onClick={() => onSelect?.(req)}>
          <div className="DOC_HEADER">
            <div className="DOC_ID_GROUP">
              <strong>{req.type}</strong>
              <span className="DOC_REF">{req.id}</span>
            </div>
            <div className={`DOC_STATUS ${req.status?.toUpperCase()}`}>
              {req.status}
            </div>
          </div>
          <div className="DOC_BODY">
            <div className="DOC_ICON_BOX"><i className="fas fa-file-alt" /></div>
            <div className="DOC_INFO">
              <h4>{req.type}</h4>
              <p className="DOC_DESC">{req.details}</p>
              <p className="DOC_DATE">{req.date}</p>
            </div>
            <div className="DOC_PRICE_TAG">{req.price}</div>
          </div>
        </div>
      ))}
    </>
  );
};

export default Community_Document_view;