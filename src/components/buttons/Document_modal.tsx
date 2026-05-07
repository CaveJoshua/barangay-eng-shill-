import { useMemo } from 'react';
import './styles/Document_modal.css';
// Make sure this path exactly matches your folder structure
import { DocumentFile } from './Tools/Document_tools/Document_Files'; 

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  requestData?: any; 
}

export default function Document_modal({ isOpen, onClose, onSuccess, requestData }: Props) {
  // 1. DELETED the manual 'officials' memo. 
  // The Engine now fetches the active Captain and Kagawad natively via the API!

  // 2. Memoize initialData
  const initialData = useMemo(() => {
    if (!isOpen) return null;

    if (requestData) {
      return {
        id: requestData.id,
        referenceNo: requestData.referenceNo,
        residentName: requestData.residentName,
        residentId: requestData.resident_id, // Normalized to camelCase to match DocumentFile state
        type: requestData.type,
        purpose: requestData.purpose === 'Other' ? requestData.otherPurpose : requestData.purpose,
        dateRequested: requestData.dateRequested,
        status: requestData.status,
        feesPaid: requestData.price?.toString() || '200.00'
      };
    }

    // Default for Walk-in
    return {
      referenceNo: `WALK-IN-${Date.now().toString().slice(-6)}`,
      residentName: '',
      type: 'Barangay Clearance', 
      purpose: '',
      dateRequested: new Date().toISOString(),
      status: 'Pending',
      feesPaid: '200.00' // Default price updated
    };
  }, [requestData, isOpen]);

  // If not open or no data, simply return null. No alerts, no forced crashes.
  if (!isOpen || !initialData) return null;

  return (
    <div className="STUDIO_MODAL_OVERLAY">
      <div className="STUDIO_CONTAINER">
        <div className="STUDIO_EDITOR_WRAPPER">
          {/* FIXED: Changed from Document_File to DocumentFile */}
          <DocumentFile 
            onClose={onClose} 
            onSuccess={onSuccess} 
            initialData={initialData}
          />
        </div>
      </div>
    </div>
  );
}