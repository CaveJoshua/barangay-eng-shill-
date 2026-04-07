import { useMemo } from 'react';
import './styles/Document_modal.css';
import { Document_File } from './Tools/Document_tools/Document_Files'; 

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  requestData?: any; 
}

export default function Document_modal({ isOpen, onClose, onSuccess, requestData }: Props) {
  // 1. Memoize officials (Optional: Pwedeng palitan ito ng fetch officials logic sa future)
  const officials = useMemo(() => [
    { position: 'Punong Barangay', full_name: '' }
  ], []);

  // 2. Memoize initialData
  const initialData = useMemo(() => {
    if (!isOpen) return null;

    if (requestData) {
      return {
        id: requestData.id,
        referenceNo: requestData.referenceNo,
        residentName: requestData.residentName,
        resident_id: requestData.resident_id, // Sinigurado nating kasama ang ID para sa handshake
        type: requestData.type,
        purpose: requestData.purpose === 'Other' ? requestData.otherPurpose : requestData.purpose,
        dateRequested: requestData.dateRequested,
        status: requestData.status,
        price: requestData.price
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
      price: 200 // Default price updated to match your new rates
    };
  }, [requestData, isOpen]);

  // If not open or no data, simply return null. No alerts, no forced crashes.
  if (!isOpen || !initialData) return null;

  return (
    <div className="STUDIO_MODAL_OVERLAY">
      <div className="STUDIO_CONTAINER">
        <div className="STUDIO_EDITOR_WRAPPER">
          {/* HANDSHAKE APPLIED: Ipinapasa na natin ang officials list dito */}
          <Document_File 
            onClose={onClose} 
            onSuccess={onSuccess} 
            data={initialData}
            officials={officials} 
          />
        </div>
      </div>
    </div>
  );
}