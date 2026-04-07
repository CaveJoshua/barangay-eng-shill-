import React from 'react';
import { FileComponent } from './Tools/Blotter_File'; 
import './styles/Blotter_modal.css'; 

// ALIGNED INTERFACE: Matches the snake_case format from BlotterPage and the Database
export interface IBlotterCase {
  id?: string;
  case_number: string;
  complainant_id?: string;
  complainant_name: string;
  respondent: string;
  incident_type: string; // Changed from 'type'
  status: 'Active' | 'Hearing' | 'Settled' | 'Archived' | 'Rejected'; // Added 'Rejected'
  date_filed: string;
  time_filed?: string;
  source?: 'Walk-in' | 'Online';
  narrative?: string;
}

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefresh: () => void;
  selectedCase: IBlotterCase | null; // Now properly aligned
  officials: any[]; 
}

/**
 * BlotterModal
 * Entry point na sumusunod sa structure ng FILE.TSX at TOOLS.TS
 */
export const BlotterModal: React.FC<ModalProps> = ({ 
  isOpen, 
  onClose, 
  onRefresh, 
  selectedCase, 
  officials 
}) => {
  
  if (!isOpen) return null;

  return (
    <div className="BLOT_MODAL_OVERLAY" onClick={onClose}>
      {/* Ang lahat ng formatting, preview, at search logic ay nasa loob 
          na ng FileComponent (FILE.tsx) base sa iyong diagram.
      */}
      <FileComponent 
        onClose={onClose}
        onRefresh={onRefresh}
        selectedCase={selectedCase}
        officials={officials}
      />
    </div>
  );
};