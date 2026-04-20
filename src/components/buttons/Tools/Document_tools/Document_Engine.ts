import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

// 1. THE MATH & DRAWING ALGORITHM
import { calculatePagination, generateVectorPDF, type DocumentPayload, type RenderInstruction } from './PDF_Algorithm';

// 2. THE DATA API
import { saveDocumentRecord } from './Types/Doc_data_api';

// 3. THE BLUEPRINTS (Schemas)
import { ClearanceSchema } from './Barangay_Documents/Clearance_Schema';
import { IndigencySchema } from './Barangay_Documents/Indigency_Schema';
import { ResidencySchema } from './Barangay_Documents/Residency_Schema';
import { JobseekerSchema } from './Barangay_Documents/Jobseeker_Schema';
import { AffidavitSchema } from './Barangay_Documents/Affidavit_Schema';

// --- TYPES ---
interface EngineConfig {
  residentId: string | null;
  residentName: string;
  address: string;
  type: string;
  purpose: string;
  dateIssued: string;
  ctcNo: string;
  orNo: string;
  feesPaid: string;
  certificateNo: string;
  [key: string]: any; 
}

export interface DocumentSchema {
  compile: (payload: DocumentPayload) => RenderInstruction[];
}

export const useDocumentEngine = (
  docConfig: EngineConfig,
  captainName: string,
  kagawadName: string, 
  onEdit?: (key: string, value: string) => void 
) => {
  // --- ENGINE STATE ---
  const [pages, setPages] = useState<React.ReactNode[]>([]);
  const [wordCount, setWordCount] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // 👇 ARCHITECTURE FIX: Stabilize the onEdit callback using a Ref.
  // This completely stops the infinite performance loop that was destroying the contentEditable focus.
  const onEditRef = useRef(onEdit);
  useEffect(() => {
    onEditRef.current = onEdit;
  }, [onEdit]);

  // --- SCHEMA ROUTER ---
  const activeSchema = useMemo((): DocumentSchema => {
    switch (docConfig.type) {
      case 'Barangay Clearance':
        return ClearanceSchema as DocumentSchema;
      case 'Certificate of Indigency':
        return IndigencySchema as DocumentSchema;
      case 'Certificate of Residency':
        return ResidencySchema as DocumentSchema;
      case 'Barangay Certification':
        return JobseekerSchema as DocumentSchema;
      case 'Affidavit of Barangay Official':
        return AffidavitSchema as DocumentSchema;
      default:
        return ClearanceSchema as DocumentSchema;
    }
  }, [docConfig.type]);

  // --- THE VIRTUAL RENDERER (Screen Preview) ---
  useEffect(() => {
    const payload: DocumentPayload = { 
      ...docConfig, 
      captainName, 
      kagawadName 
    };

    // Pass a stable wrapper function so the Engine doesn't rapidly re-render
    const virtualDocumentMap = calculatePagination(
      activeSchema, 
      payload, 
      (key, value) => {
        if (onEditRef.current) {
          onEditRef.current(key, value);
        }
      }
    );

    setPages(virtualDocumentMap.pages);
    setWordCount(virtualDocumentMap.totalWords);
    
    // 👇 ARCHITECTURE FIX: Notice 'onEdit' is REMOVED from this array. The loop is dead.
  }, [docConfig, captainName, kagawadName, activeSchema]); 

  // --- THE COMPILER (Final Vector PDF & Save) ---
  const handleSaveAndDownload = useCallback(async () => {
    if (!docConfig.residentName || !docConfig.address) {
      alert('Missing critical resident information.');
      return;
    }

    setIsProcessing(true);

    try {
      const payload: DocumentPayload = { 
        ...docConfig, 
        captainName, 
        kagawadName 
      };

      const pdfInstance = await generateVectorPDF(activeSchema, payload);

      const fileName = `${docConfig.type.replace(/\s+/g, '_')}_${docConfig.residentName}.pdf`;
      pdfInstance.save(fileName);

      await saveDocumentRecord({
        resident_id: docConfig.residentId || 'MANUAL_ENTRY',
        resident_name: docConfig.residentName,
        type: docConfig.type,
        purpose: docConfig.purpose,
        price: parseFloat(docConfig.feesPaid) || 0,
        status: 'Completed',
        reference_no: `WK-IN-${Date.now().toString().slice(-6)}`,
        date_requested: new Date().toISOString(),
      });

      return true; 
    } catch (error: any) {
      console.error('Engine Compilation Error:', error);
      alert(`Document Engine Error: ${error.message}`);
      return false;
    } finally {
      setIsProcessing(false);
    }
  }, [docConfig, activeSchema, captainName, kagawadName]);

  return {
    pages,
    wordCount,
    isProcessing,
    handleSaveAndDownload,
  };
};