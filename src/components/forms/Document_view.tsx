import { useState } from 'react';
import './styles/Document_view.css'; 
import { ApiService } from '../UI/api'; 

export interface IDocRequest {
  id: string;
  referenceNo: string;
  residentName: string;
  dateRequested: string;
  type: string;
  price: number;
  purpose: string;
  otherPurpose?: string;
  status: 'Pending' | 'Processing' | 'Ready' | 'Completed' | 'Rejected'; 
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onUpdate: () => void;
  onGenerate?: (data: IDocRequest) => void; 
  onDownload?: (id: string, refNo: string) => void;
  data: IDocRequest;
}

export default function Document_view({ isOpen, onClose, onUpdate, onGenerate, onDownload, data }: Props) {
  const [isProcessing, setIsProcessing] = useState(false);

  if (!isOpen) return null;

  // --- 1. SECURE STATUS UPDATE ---
  const updateStatus = async (newStatus: string) => {
    setIsProcessing(true);
    try {
      const result = await ApiService.updateDocumentStatus(data.id, newStatus);

      if (result && result.success) {
        onUpdate(); 
      } else {
        alert(`Failed: ${result?.error || 'Server rejected status update.'}`);
      }
    } catch (err) {
      alert('Network Error: Check if your Backend is running.');
    } finally {
      setIsProcessing(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch(status) {
      case 'Pending': return '#f59e0b';
      case 'Processing': return '#3b82f6';
      case 'Ready': return '#a855f7';
      case 'Completed': return '#10b981';
      default: return '#64748b';
    }
  };

  // --- 2. PIPELINE ACTION HANDLERS ---
  const handleFinalizeAndDownload = async () => {
    if (onDownload) {
      onDownload(data.id, data.referenceNo);
    }
    await updateStatus('Completed');
  };

  return (
    <div className="DOC_VIEW_OVERLAY">
      <div className="DOC_VIEW_MODAL">
        
        {/* HEADER */}
        <div className="DOC_VIEW_HEADER">
          <div>
            <span className="DOC_VIEW_REF">{data.referenceNo}</span>
            <h3>Request Details</h3>
          </div>
          <button className="DOC_VIEW_CLOSE" onClick={onClose}>&times;</button>
        </div>

        {/* BODY */}
        <div className="DOC_VIEW_BODY">
          <div className="DOC_VIEW_STATUS_BAR" style={{borderColor: getStatusColor(data.status)}}>
            <span style={{color: getStatusColor(data.status)}}>CURRENT PIPELINE STAGE</span>
            <strong style={{color: getStatusColor(data.status)}}>{data.status.toUpperCase()}</strong>
          </div>

          <div className="DOC_VIEW_GRID">
            <div className="DOC_VIEW_FIELD">
              <label>Resident Name</label>
              <input type="text" value={data.residentName} readOnly />
            </div>
            <div className="DOC_VIEW_FIELD">
              <label>Date Requested</label>
              <input type="text" value={new Date(data.dateRequested).toLocaleDateString()} readOnly />
            </div>
          </div>

          {/* Document Type alone on this row */}
          <div className="DOC_VIEW_FIELD">
            <label>Document Type</label>
            <input type="text" value={data.type} readOnly />
          </div>

          <div className="DOC_VIEW_FIELD">
            <label>Purpose</label>
            <textarea readOnly value={data.purpose === 'Other' ? data.otherPurpose : data.purpose} rows={3}></textarea>
          </div>
        </div>

        {/* ── ACTION FOOTER (PIPELINE ENGINE) ── */}
        <div className="DOC_VIEW_FOOTER">
          
          {/* STAGE 1: PENDING (Approve -> Processing) */}
          {data.status === 'Pending' && (
            <>
              <button className="BTN_ACT REJECT" onClick={() => updateStatus('Rejected')} disabled={isProcessing}>
                <i className="fas fa-times"></i> Reject
              </button>
              <button className="BTN_ACT APPROVE" onClick={() => updateStatus('Processing')} disabled={isProcessing}>
                <i className="fas fa-check"></i> Approve Request
              </button>
            </>
          )}

          {/* STAGE 2: PROCESSING (Review Complete -> Ready) */}
          {data.status === 'Processing' && (
            <button 
              className="BTN_ACT COMPLETE" 
              onClick={() => updateStatus('Ready')} 
              style={{ width: '100%', backgroundColor: '#3b82f6', color: 'white' }}
              disabled={isProcessing}
            >
              <i className="fas fa-tasks"></i> Mark Review Complete
            </button>
          )}

          {/* STAGE 3: READY (Generate Only or Finalize) */}
          {data.status === 'Ready' && (
            <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
              <button 
                className="BTN_ACT GENERATE" 
                onClick={() => {
                  if (onGenerate) onGenerate(data);
                  onClose(); 
                }} 
                style={{ flex: 1, backgroundColor: '#1e293b', color: 'white' }}
                disabled={isProcessing}
              >
                <i className="fas fa-file-signature"></i> Generate Document
              </button>
              
              <button 
                className="BTN_ACT DOWNLOAD" 
                onClick={handleFinalizeAndDownload} 
                style={{ flex: 1, backgroundColor: '#10b981', color: 'white' }}
                disabled={isProcessing}
              >
                <i className="fas fa-download"></i> Finalize & Download
              </button>
            </div>
          )}

          {/* STAGE 4: HISTORY (Archived) */}
          {(data.status === 'Completed' || data.status === 'Rejected') && (
            <div className="DOC_VIEW_ARCHIVED" style={{ width: '100%', textAlign: 'center', color: '#64748b', fontWeight: 600 }}>
              <i className="fas fa-archive"></i> This record has been finalized and archived.
            </div>
          )}
        </div>

      </div>
    </div>
  );
}