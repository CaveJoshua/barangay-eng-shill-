import { useState, useEffect, useCallback } from 'react';
import './styles/Community_Blotter_Request.css'; // Updated CSS import
import { ApiService } from '../UI/api'; 

// ─── INTERFACES ─────────────────────────────────────────────────────────
interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type StepType = 1 | 2 | 3;

const INCIDENT_TYPES = [
  'Noise Complaint',
  'Physical Injury',
  'Theft',
  'Harassment / Threats',
  'Property Damage',
  'Vandalism',
  'Unjust Vexation',
  'Others'
];

export default function Community_Incident_Report({ isOpen, onClose, onSuccess }: ModalProps) {
  const [step, setStep] = useState<StepType>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);

  // ─── FORM STATE ─────────────────────────────────────────────────────────
  const [formData, setFormData] = useState({
    respondent: '',
    purok: 'Purok 1',
    type: 'Noise Complaint',
    dateFiled: new Date().toISOString().split('T')[0],
    timeFiled: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    narrative: '',
  });

  // ─── NAME FORMATTER ─────────────────────────────────────────────────────
  const formatToProperName = useCallback((first: string = '', middle: string = '', last: string = '') => {
    const toTitleCase = (str: string) => 
      str.toLowerCase().trim().split(/\s+/).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

    const fName = toTitleCase(first);
    const lName = toTitleCase(last);
    const mInit = middle.trim() ? `${middle.trim().charAt(0).toUpperCase()}. ` : '';

    return `${fName} ${mInit}${lName}`.trim();
  }, []);

  // ─── SESSION LOADER ─────────────────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      const session = localStorage.getItem('resident_session');
      if (session) {
        const parsed = JSON.parse(session);
        const profile = parsed.profile || parsed.residents || parsed; 
        
        const formatted = formatToProperName(
          profile.first_name, 
          profile.middle_name, 
          profile.last_name
        );

        setCurrentUser({ ...profile, formattedName: formatted });
      }
      setStep(1); 
    }
  }, [isOpen, formatToProperName]);

  if (!isOpen) return null;

  // ─── SUBMISSION LOGIC ───────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!currentUser?.record_id) return alert("System Error: Resident profile ID is missing.");
    setIsSubmitting(true);

    try {
      // Security Check
      const blotterList = await ApiService.getBlotters();
      if (blotterList === null) throw new Error("Security verification failed. Please try logging in again.");
      
      // Generate Unique Case Number
      const year = new Date().getFullYear();
      const uniqueHash = Math.random().toString(36).substring(2, 6).toUpperCase();
      const timeStamp = Date.now().toString().slice(-4);
      const generatedCaseNum = `INCD-${year}-${timeStamp}-${uniqueHash}`;

      // Map payload to Backend schema
      const payload = {
        case_number: generatedCaseNum,
        complainant_id: currentUser.record_id,
        complainant_name: currentUser.formattedName,
        respondent: formData.respondent.toUpperCase(),
        incident_type: formData.type,
        narrative: `[LOCATION: ${formData.purok}] ${formData.narrative}`,
        date_filed: formData.dateFiled,
        time_filed: formData.timeFiled,
        status: 'Pending'
      };

      const result = await ApiService.saveBlotter(null, payload);

      if (result.success) {
        alert('Incident report submitted successfully!');
        onSuccess(); 
        onClose();   
      } else {
        alert(`Error: ${result.error || 'The system could not save your report.'}`);
      }
    } catch (err: any) {
      alert(err.message || "Connection error. Ensure the server is active.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── NAVIGATION HELPERS ─────────────────────────────────────────────────
  const handleNext = () => setStep(prev => (prev + 1) as StepType);
  const handleBack = () => setStep(prev => (prev - 1) as StepType);

  // Form Validation
  const isNextDisabled = !formData.respondent.trim() || (step === 2 && !formData.narrative.trim());

  return (
    <div className="CIR_OVERLAY">
      <div className="CIR_MODAL">
        
        {/* HEADER */}
        <div className="CIR_HEADER">
          <div className="CIR_HEADER_TEXT">
              <h3>File Incident Report</h3>
              <p>Step {step} of 3: {step === 1 ? 'Parties Involved' : step === 2 ? 'Incident Details' : 'Review & Submit'}</p>
          </div>
          <button className="CIR_CLOSE_BTN" onClick={onClose}><i className="fas fa-times"></i></button>
        </div>

        {/* PROGRESS BAR */}
        <div className="CIR_PROGRESS">
           <div className={`CIR_FILL STEP_${step}`}></div>
        </div>

        {/* MODAL BODY */}
        <div className="CIR_BODY">
           
           {/* STEP 1: PARTIES INVOLVED */}
           {step === 1 && (
             <div className="CIR_STEP_CONTENT">
                <div className="CIR_FORM_GROUP">
                  <label>Complainant (You)</label>
                  <div className="CIR_READONLY_FIELD">
                      <i className="fas fa-user-circle"></i>
                      <span>{currentUser?.formattedName || 'Loading...'}</span>
                  </div>
                </div>

                <div className="CIR_FORM_GROUP">
                  <label>Respondent (Person involved/complained against)</label>
                  <input 
                    className="CIR_INPUT"
                    type="text" 
                    placeholder="Enter full name" 
                    value={formData.respondent}
                    onChange={e => setFormData({...formData, respondent: e.target.value})}
                  />
                </div>

                <div className="CIR_FORM_GROUP">
                  <label>Nature of Incident</label>
                  <select 
                    className="CIR_SELECT"
                    value={formData.type}
                    onChange={e => setFormData({...formData, type: e.target.value})}
                  >
                    {INCIDENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
             </div>
           )}

           {/* STEP 2: INCIDENT DETAILS */}
           {step === 2 && (
             <div className="CIR_STEP_CONTENT">
                <div className="CIR_ROW">
                   <div className="CIR_FORM_GROUP">
                      <label>Date of Incident</label>
                      <input 
                        className="CIR_INPUT" 
                        type="date" 
                        value={formData.dateFiled} 
                        onChange={e => setFormData({...formData, dateFiled: e.target.value})} 
                      />
                   </div>
                   <div className="CIR_FORM_GROUP">
                      <label>Incident Location</label>
                      <select 
                        className="CIR_SELECT" 
                        value={formData.purok} 
                        onChange={e => setFormData({...formData, purok: e.target.value})} 
                      >
                        {[1, 2, 3, 4, 5, 6, 7].map(num => (
                          <option key={num} value={`Purok ${num}`}>Purok {num}</option>
                        ))}
                      </select>
                   </div>
                </div>
                <div className="CIR_FORM_GROUP">
                  <label>Narrative (Statement of Facts)</label>
                  <textarea 
                    className="CIR_TEXTAREA" 
                    rows={6} 
                    placeholder="Describe exactly what happened..." 
                    value={formData.narrative} 
                    onChange={e => setFormData({...formData, narrative: e.target.value})} 
                  />
                </div>
             </div>
           )}

           {/* STEP 3: REVIEW & SUBMIT */}
           {step === 3 && (
             <div className="CIR_STEP_CONTENT">
                <div className="CIR_REVIEW_CARD">
                   <div className="CIR_REVIEW_HEADER">Incident Report Summary</div>
                   <div className="CIR_REVIEW_BODY">
                      <div className="CIR_REVIEW_ITEM">
                        <span>Complainant:</span> 
                        <strong>{currentUser?.formattedName}</strong>
                      </div>
                      <div className="CIR_REVIEW_ITEM">
                        <span>Respondent:</span> 
                        <strong>{formData.respondent.toUpperCase()}</strong>
                      </div>
                      <div className="CIR_REVIEW_ITEM">
                        <span>Type:</span> 
                        <span className="CIR_TAG">{formData.type}</span>
                      </div>
                      <div className="CIR_REVIEW_DIVIDER"></div>
                      <div className="CIR_REVIEW_ITEM VERTICAL">
                        <span>Statement:</span> 
                        <p>"{formData.narrative}"</p>
                      </div>
                   </div>
                </div>
                <div className="CIR_DISCLAIMER">
                   <input type="checkbox" id="certify" checked readOnly />
                   <label htmlFor="certify">I certify that the information provided is true and correct.</label>
                </div>
             </div>
           )}
        </div>

        {/* FOOTER CONTROLS */}
        <div className="CIR_FOOTER">
           {step > 1 && (
             <button className="CIR_BTN_SECONDARY" onClick={handleBack} disabled={isSubmitting}>
               Back
             </button>
           )}

           {step < 3 ? (
             <button className="CIR_BTN_PRIMARY" onClick={handleNext} disabled={isNextDisabled}>
               Next Step <i className="fas fa-arrow-right"></i>
             </button>
           ) : (
             <button className="CIR_BTN_PRIMARY SUBMIT" onClick={handleSubmit} disabled={isSubmitting}>
               {isSubmitting ? 'Sending...' : 'Submit Report'}
             </button>
           )}
        </div>

      </div>
    </div>
  );
}