import { useState, useEffect } from 'react';
import './styles/Community_Document_Request.css';
import { ApiService } from '../UI/api'; 

// ─── INTERFACES ─────────────────────────────────────────────────────────
interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  residentName: string;
  residentId: string;
}

interface DocumentType {
  id: string; 
  label: string; 
  price: number; 
  icon: string; 
}

const PURPOSES = [
  'EMPLOYMENT REQUIREMENT',
  'SCHOOL / SCHOLARSHIP',
  'BUSINESS REQUIREMENT',
  'OTHER'
];

type StepType = 1 | 2 | 3 | 4;

export default function Community_Document_Request({ isOpen, onClose, onSuccess, residentName, residentId }: Props) {
  const [step, setStep] = useState<StepType>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([]);
  const [isLoadingDocs, setIsLoadingDocs] = useState(false);
  const [refNumber, setRefNumber] = useState('');

  const [formData, setFormData] = useState({
    docTypeId: '', 
    purpose: '',
    otherPurpose: ''
  });

  // ─── DATA FETCHING ──────────────────────────────────────────────────────
  useEffect(() => {
    const controller = new AbortController();

    if (isOpen) {
      setStep(1);
      const fetchDocs = async () => {
        setIsLoadingDocs(true);
        try {
          const data = await ApiService.getDocumentTypes(controller.signal);
          if (data) {
            const validatedData = data.map((doc: any) => ({
              ...doc,
              icon: doc.id === 'brgy_clearance' ? 'fa-file-contract' : (doc.icon || 'fa-file-alt')
            }));
            
            setDocumentTypes(validatedData);
            if (validatedData.length > 0) {
              setFormData(prev => ({ ...prev, docTypeId: validatedData[0].id }));
            }
          }
        } catch (err) {
          console.error("Failed to load document types");
        } finally {
          setIsLoadingDocs(false);
        }
      };
      fetchDocs();
    }
    return () => controller.abort();
  }, [isOpen]);

  if (!isOpen) return null;

  // ─── DERIVED STATE (Fixing the Duplication) ─────────────────────────────
  
  const selectedDoc = documentTypes.find(d => d.id === formData.docTypeId);
  
  // 1. Consolidate repetitive upper-casing and fallback logic
  const safeResidentName = (residentName || 'RESIDENT').toUpperCase();
  const safeDocLabel = selectedDoc?.label.toUpperCase() || 'UNKNOWN DOCUMENT';
  
  // 2. Consolidate the Purpose ternary logic (used in both UI and Payload)
  const finalPurposeText = (formData.purpose === 'OTHER' ? formData.otherPurpose : formData.purpose).toUpperCase();

  // 3. Form Validation
  const isNextDisabled = !formData.docTypeId || 
                         !formData.purpose || 
                         (formData.purpose === 'OTHER' && !formData.otherPurpose.trim());

  // ─── SUBMIT HANDLER ─────────────────────────────────────────────────────
  const handleFinalSubmit = async () => {
    if (!residentId || !selectedDoc) return;
    
    setIsSubmitting(true);
    const generatedRef = `REF-${Date.now()}`;
    setRefNumber(generatedRef);

    // Using the derived state from above to keep payload clean
    const payload = {
        resident_id: residentId, 
        resident_name: safeResidentName, 
        type: safeDocLabel, 
        purpose: formData.purpose.toUpperCase(), // Backend might need exact category
        other_purpose: formData.purpose === 'OTHER' ? formData.otherPurpose.toUpperCase() : '', 
        price: 0, 
        reference_no: generatedRef,
    };

    try {
        const result = await ApiService.saveDocumentRecord(payload);
        if (result.success) {
            setStep(4);
            onSuccess();
        } else {
            alert(`SUBMISSION FAILED: ${result.error}`);
        }
    } catch (err) {
        alert('SERVER ERROR: CHECK CONSOLE');
    } finally {
        setIsSubmitting(false);
    }
  };

  // Helper for safe step transitions
  const handleBack = () => setStep(prev => (prev - 1) as StepType);

  return (
    <div className="DOC_MODAL_OVERLAY">
      <div className="DOC_MODAL_CARD">
        
        {/* HEADER */}
        {step < 4 && (
            <div className="DOC_MODAL_HEADER">
                <div className="DOC_HEADER_TEXT">
                    <h3>{step === 3 ? 'FINAL CONFIRMATION' : 'REQUEST DOCUMENT'}</h3>
                    <p>STEP {step} OF 3</p>
                </div>
                <button className="DOC_CLOSE_BTN" onClick={onClose}><i className="fas fa-times"></i></button>
            </div>
        )}

        {/* BODY */}
        <div className="DOC_MODAL_BODY">
          
          {/* STEP 1: FORM SELECTION */}
          {step === 1 && (
            <div className="DOC_STEP_CONTAINER">
              <label className="DOC_LABEL">SELECT DOCUMENT TYPE</label>
              {isLoadingDocs ? (
                <div className="DOC_LOADING"><i className="fas fa-circle-notch fa-spin"></i></div>
              ) : (
                <div className="DOC_GRID_SELECT">
                  {documentTypes.map((doc) => (
                    <div 
                      key={doc.id} 
                      className={`DOC_SELECT_CARD ${formData.docTypeId === doc.id ? 'SELECTED' : ''}`}
                      onClick={() => setFormData({ ...formData, docTypeId: doc.id })}
                    >
                      <i className={`fas ${doc.icon}`}></i>
                      <span>{doc.label}</span>
                    </div>
                  ))}
                </div>
              )}

              <label className="DOC_LABEL">PURPOSE</label>
              <select 
                value={formData.purpose} 
                onChange={(e) => setFormData({ ...formData, purpose: e.target.value })}
                className="DOC_INPUT"
              >
                <option value="" disabled>Select a purpose...</option>
                {PURPOSES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>

              {formData.purpose === 'OTHER' && (
                <input 
                  type="text" 
                  className="DOC_INPUT" 
                  placeholder="SPECIFY PURPOSE HERE..."
                  value={formData.otherPurpose}
                  onChange={(e) => setFormData({...formData, otherPurpose: e.target.value})}
                />
              )}
            </div>
          )}

          {/* STEP 2: REVIEW */}
          {step === 2 && (
            <div className="DOC_STEP_CONTAINER">
               <div className="DOC_REVIEW_LIST">
                  <div className="DOC_REVIEW_ITEM">
                    <small>REQUESTOR</small>
                    <p>{safeResidentName}</p> 
                  </div>
                  <div className="DOC_REVIEW_ITEM">
                    <small>DOCUMENT</small>
                    <p>{safeDocLabel}</p>
                  </div>
                  <div className="DOC_REVIEW_ITEM">
                    <small>DOCUMENT FEE</small>
                    <p>TO BE ASSESSED</p>
                  </div>
                  <div className="DOC_REVIEW_ITEM">
                    <small>PURPOSE</small>
                    <p>{finalPurposeText}</p> {/* Replaced duplicated ternary logic */}
                  </div>
               </div>
            </div>
          )}

          {/* STEP 3: CONFIRM */}
          {step === 3 && (
            <div className="DOC_STEP_CONTAINER CENTERED">
               <div className="DOC_CONFIRM_ICON"><i className="fas fa-paper-plane"></i></div>
               <h4>READY TO SEND?</h4>
               <p>Your request will be sent to the Barangay Staff for review.</p>
            </div>
          )}

          {/* STEP 4: SUCCESS */}
          {step === 4 && (
            <div className="DOC_STEP_CONTAINER CENTERED SUCCESS">
                <div className="DOC_SUCCESS_ICON"><i className="fas fa-check-circle"></i></div>
                <h3>REQUEST SENT!</h3>
                <p>REFERENCE: <strong>{refNumber}</strong></p>
                <button className="DOC_BTN_PRIMARY" onClick={onClose} style={{marginTop: '20px'}}>CLOSE REGISTRY</button>
            </div>
          )}
        </div>

        {/* FOOTER CONTROLS */}
        {step < 4 && (
            <div className="DOC_MODAL_FOOTER">
                {step > 1 && (
                  <button className="DOC_BTN_SECONDARY" onClick={handleBack}>BACK</button>
                )}
                
                {step === 1 && (
                  <button className="DOC_BTN_PRIMARY" onClick={() => setStep(2)} disabled={isNextDisabled}>REVIEW REQUEST</button>
                )}
                
                {step === 2 && (
                  <button className="DOC_BTN_PRIMARY" onClick={() => setStep(3)}>NEXT</button>
                )}
                
                {step === 3 && (
                  <button className="DOC_BTN_PRIMARY SUBMIT" onClick={handleFinalSubmit} disabled={isSubmitting}>
                    {isSubmitting ? 'COMMUNICATING...' : 'CONFIRM & SUBMIT'}
                  </button>
                )}
            </div>
        )}
      </div>
    </div>
  );
}