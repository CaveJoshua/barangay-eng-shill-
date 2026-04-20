import { useState, useEffect, useCallback, useMemo } from 'react';

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
  [key: string]: any; // 👈 SPECIFIC UPDATE: Allows dynamic keys for tables and Jobseeker fields
}

export interface DocumentSchema {
  compile: (payload: DocumentPayload) => RenderInstruction[];
}

export const useDocumentEngine = (
  docConfig: EngineConfig,
  captainName: string,
  kagawadName: string, // Dynamically passed from the API hook
  onEdit?: (key: string, value: string) => void // 👈 SPECIFIC UPDATE: Catches surface edits
) => {
  // --- ENGINE STATE ---
  const [pages, setPages] = useState<React.ReactNode[]>([]);
  const [wordCount, setWordCount] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

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
    // Inject the dynamic names into the payload
    const payload: DocumentPayload = { 
      ...docConfig, 
      captainName, 
      kagawadName 
    };

    // Calculate the virtual map for the browser viewport
    // 👈 SPECIFIC UPDATE: Pass the onEdit function down to the pagination algorithm
    const virtualDocumentMap = calculatePagination(activeSchema, payload, onEdit);

    setPages(virtualDocumentMap.pages);
    setWordCount(virtualDocumentMap.totalWords);
  }, [docConfig, captainName, kagawadName, activeSchema, onEdit]); // 👈 SPECIFIC UPDATE: Added onEdit to dependencies

  // --- THE COMPILER (Final Vector PDF & Save) ---
  const handleSaveAndDownload = useCallback(async () => {
    // Safety check for critical data
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

      // 1. Generate Vector PDF (Coordinate-based, high precision)
      const pdfInstance = await generateVectorPDF(activeSchema, payload);

      // 2. Trigger browser download
      const fileName = `${docConfig.type.replace(/\s+/g, '_')}_${docConfig.residentName}.pdf`;
      pdfInstance.save(fileName);

      // 3. Persist record to Database
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

      return true; // Return success for the UI to handle
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