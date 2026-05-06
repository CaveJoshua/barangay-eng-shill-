import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

// 1. THE MATH & DRAWING ALGORITHM
import { calculatePagination, generateVectorPDF, type DocumentPayload, type RenderInstruction } from './PDF_Algorithm';

// 2. THE DATA API
import { saveDocumentRecord, updateDocumentStatus } from './Types/Doc_data_api';

// 3. THE BLUEPRINTS (Schemas)
import { ClearanceSchema } from './Barangay_Documents/Clearance_Schema';
import { IndigencySchema } from './Barangay_Documents/Indigency_Schema';
import { ResidencySchema } from './Barangay_Documents/Residency_Schema';
import { JobseekerSchema } from './Barangay_Documents/Jobseeker_Schema';
import { AffidavitSchema } from './Barangay_Documents/Affidavit_Schema';

// --- TYPES ---
interface EngineConfig {
  id?: number | string | null;           // ← Existing DB record ID (for Walk-in updates)
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
  requestMethod?: string;               // ← 'Walk-in' | 'Online'
  [key: string]: any;
}

export interface DocumentSchema {
  compile: (payload: DocumentPayload) => RenderInstruction[];
}

// 🎯 Keys listed here keep their value but are FORBIDDEN from being edited inline in the
// document preview. Used to lock down official signatures (Punong Barangay, Kagawad) so
// admins can't rename them by accident through contentEditable. Even if a schema still
// has an `editableKey: 'captainName'` left over, this denylist neutralizes it.
const PROTECTED_EDITABLE_KEYS = [
  'captainName',
  'kagawadName',
  'punongBarangayName',
  'brgyCaptainName',
];

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

  // ARCHITECTURE FIX: Stabilize the onEdit callback using a Ref.
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
        // 🎯 Belt-and-suspenders: silently drop any edit that targets a protected key.
        // This is a no-op since the renderer also strips contentEditable on these,
        // but it guarantees state never gets corrupted by a stale schema or a
        // browser quirk that fires onBlur on a non-editable element.
        if (PROTECTED_EDITABLE_KEYS.includes(key)) return;
        if (onEditRef.current) {
          onEditRef.current(key, value);
        }
      },
      { protectedEditableKeys: PROTECTED_EDITABLE_KEYS }
    );

    setPages(virtualDocumentMap.pages);
    setWordCount(virtualDocumentMap.totalWords);
  }, [docConfig, captainName, kagawadName, activeSchema]);

  // --- THE COMPILER (Final Vector PDF & Auto-Complete for ALL Admin-Processed Docs) ---
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

      // Step 1: Generate and trigger the PDF download
      const pdfInstance = await generateVectorPDF(activeSchema, payload);
      const fileName = `${docConfig.type.replace(/\s+/g, '_')}_${docConfig.residentName}.pdf`;
      pdfInstance.save(fileName);

      // Step 2: Determine record state
      // 🎯 SURGICAL FIX: Any document admin processes through this UI is, by definition,
      // physically completed at the counter — so it's ALWAYS marked 'Completed', whether the
      // original request came in as Walk-in or Online. Walk-in is the default for new manual
      // entries; Online requests get promoted from Processing → Completed once the admin prints.
      const existingId = docConfig.id;
      const finalPrice = parseFloat(docConfig.feesPaid) || 0;
      const recordedMethod = docConfig.requestMethod || 'Walk-in';

      if (existingId) {
        // ─────────────────────────────────────────────────────────────────
        // CASE A: Record already exists in the queue (Walk-in pending OR Online request)
        // → PATCH to 'Completed' regardless of source.
        // ─────────────────────────────────────────────────────────────────
        await updateDocumentStatus(existingId, 'Completed', undefined, finalPrice);

      } else {
        // ─────────────────────────────────────────────────────────────────
        // CASE B: Brand-new manual Walk-in (no prior DB record)
        // → INSERT directly as Completed.
        // ─────────────────────────────────────────────────────────────────
        const newRecord = await saveDocumentRecord({
          resident_id: docConfig.residentId || 'MANUAL_ENTRY',
          resident_name: docConfig.residentName,
          type: docConfig.type,
          purpose: docConfig.purpose || 'Walk-in Request',
          price: finalPrice,
          status: 'Completed', // 🎯 admin manual processing → always Completed
          reference_no: `WK-IN-${Date.now().toString().slice(-6)}`,
          date_requested: new Date().toISOString(),
          request_method: recordedMethod,
        });

        // Belt-and-suspenders: enforce status + price even if the insert defaulted them.
        if (newRecord?.id) {
          await updateDocumentStatus(newRecord.id, 'Completed', undefined, finalPrice);
        }
      }

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