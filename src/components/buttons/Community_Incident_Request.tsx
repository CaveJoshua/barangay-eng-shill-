import { useState, useEffect, useCallback } from 'react';
import './styles/Community_Blotter_Request.css';
import { ApiService } from '../UI/api';
import PrivacyConsent from '../PrivacyConsent';

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
  const [consent, setConsent] = useState(false); // RA 10173 / GDPR data-privacy consent

  // ─── FORM & MEDIA STATE ─────────────────────────────────────────────────
  const formDataState = {
    respondent: '',
    purok: 'Purok 1',
    type: 'Noise Complaint',
    dateFiled: new Date().toISOString().split('T')[0],
    timeFiled: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    narrative: '',
  };

  const [formData, setFormData] = useState(formDataState);
  const [mediaFiles, setMediaFiles] = useState<File[]>([]);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const MAX_VIDEO_BYTES = 10 * 1024 * 1024;

  // ─── FILE HANDLING LOGIC ────────────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selected = Array.from(e.target.files);
      
      if (mediaFiles.length + selected.length > 5) {
        alert("You can only upload a maximum of 5 image files.");
        return;
      }
      
      setMediaFiles(prev => [...prev, ...selected].slice(0, 5));
    }
  };

  const removeFile = (indexToRemove: number) => {
    setMediaFiles(prev => prev.filter((_, index) => index !== indexToRemove));
  };

  const handleVideoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      alert('Only video files are allowed (mp4, webm, mov).');
      e.target.value = '';
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      alert('Video must be 10MB or smaller.');
      e.target.value = '';
      return;
    }
    setVideoFile(file);
  };

  const removeVideo = () => setVideoFile(null);

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
      setConsent(false);
      setMediaFiles([]);
      setVideoFile(null);
      setFormData({
        respondent: '',
        purok: 'Purok 1',
        type: 'Noise Complaint',
        dateFiled: new Date().toISOString().split('T')[0],
        timeFiled: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        narrative: '',
      });
    }
  }, [isOpen, formatToProperName]);

  if (!isOpen) return null;

  // ─── SUBMISSION LOGIC ───────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!currentUser?.record_id) return alert("System Error: Resident profile ID is missing.");
    if (!consent) return alert("Please read and agree to the Data Privacy Notice before submitting.");
    setIsSubmitting(true);

    try {
      const year = new Date().getFullYear();
      const uniqueHash = Math.random().toString(36).substring(2, 6).toUpperCase();
      const timeStamp = Date.now().toString().slice(-4);
      const generatedCaseNum = `ON-INC-${year}-${timeStamp}-${uniqueHash}`;

      const payload = new FormData();
      payload.append('case_number', generatedCaseNum);
      payload.append('complainant_id', currentUser.record_id);
      payload.append('complainant_name', currentUser.formattedName);
      payload.append('respondent', formData.respondent.toUpperCase());
      payload.append('incident_type', formData.type);
      payload.append('narrative', `[LOCATION: ${formData.purok}] ${formData.narrative}`);
      payload.append('date_filed', formData.dateFiled);
      payload.append('time_filed', formData.timeFiled);
      payload.append('status', 'Pending');
      // 🖋️ Capture-time stamp — the backend bakes this into the evidence watermark
      // and the Cloudinary chain-of-custody metadata for each uploaded asset.
      payload.append('client_captured_at', new Date().toISOString());

      mediaFiles.forEach((file) => {
        payload.append('evidence', file);
      });

      if (videoFile) payload.append('video', videoFile);

      const result = await ApiService.saveBlotter(null, payload);

      if (result.success) {
        alert('Incident report submitted successfully!');
        onSuccess(); 
        onClose();   
      } else {
        const errorMessage = result.message || result.error || 'The system could not save your report.';
        alert(`Submission Flagged:\n${errorMessage}`);
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

  const isNextDisabled = !formData.respondent.trim() || (step === 2 && !formData.narrative.trim());

  return (
    <div className="CIR_OVERLAY">
      <div className="CIR_MODAL">
        
        {/* HEADER */}
        <div className="CIR_HEADER">
          <div className="CIR_HEADER_TEXT">
              <h3>File Incident Report</h3>
              <p>Step {step} of 3: {step === 1 ? 'Parties Involved' : step === 2 ? 'Incident Details' : 'Review & Submit'}</p>
              {/* 🛡️ REFLECTED: Proactive Header Warning label */}
              <span style={{ display: 'block', color: '#dc2626', fontSize: '0.75rem', fontWeight: 700, marginTop: '4px' }}>
                ⚠️ SYSTEM PROTECTION RULE: Strict limit of 2 report submissions per 24 hours.
              </span>
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
                    onChange={e => {
                      const sanitized = e.target.value.replace(/[^a-zA-Z\s-ñÑ]/g, '');
                      setFormData({...formData, respondent: sanitized.toUpperCase()});
                    }}
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
                    rows={4} 
                    placeholder="Describe exactly what happened..." 
                    value={formData.narrative} 
                    onChange={e => setFormData({...formData, narrative: e.target.value})} 
                  />
                </div>

                <div className="CIR_FORM_GROUP">
                  <label>Attach Evidence (Max 5 files - Images only)</label>
                  <input 
                    type="file" 
                    multiple 
                    accept="image/*"
                    onChange={handleFileChange}
                    disabled={mediaFiles.length >= 5}
                    className="CIR_FILE_INPUT"
                    style={{ display: 'block', marginBottom: '8px', padding: '8px', border: '1px dashed #ccc', borderRadius: '6px', width: '100%' }}
                  />
                  
                  {mediaFiles.length > 0 && (
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {mediaFiles.map((file, idx) => (
                        <div key={idx} style={{
                          display: 'flex', alignItems: 'center', gap: '6px',
                          padding: '4px 10px', backgroundColor: '#f1f5f9',
                          border: '1px solid #e2e8f0', borderRadius: '16px', fontSize: '0.85rem'
                        }}>
                          <i className="fas fa-image" style={{ color: '#64748b' }}></i>
                          <span style={{ maxWidth: '120px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {file.name}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeFile(idx)}
                            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 'bold' }}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="CIR_FORM_GROUP">
                  <label>Attach Video (Optional — 1 video, max 10MB)</label>
                  <input
                    type="file"
                    accept="video/*"
                    onChange={handleVideoChange}
                    disabled={!!videoFile}
                    className="CIR_FILE_INPUT"
                    style={{ display: 'block', marginBottom: '8px', padding: '8px', border: '1px dashed #ccc', borderRadius: '6px', width: '100%' }}
                  />
                  {videoFile && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '6px', width: 'fit-content',
                      padding: '4px 10px', backgroundColor: '#eef2ff',
                      border: '1px solid #c7d2fe', borderRadius: '16px', fontSize: '0.85rem'
                    }}>
                      <i className="fas fa-video" style={{ color: '#4f46e5' }}></i>
                      <span style={{ maxWidth: '160px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {videoFile.name}
                      </span>
                      <span style={{ color: '#64748b' }}>({(videoFile.size / (1024 * 1024)).toFixed(1)}MB)</span>
                      <button
                        type="button"
                        onClick={removeVideo}
                        style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 'bold' }}
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>

                {/* 🖋️ EVIDENCE INTEGRITY NOTICE */}
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: '8px',
                  padding: '10px 12px', marginTop: '4px',
                  backgroundColor: '#eff6ff', border: '1px solid #bfdbfe',
                  borderRadius: '8px', fontSize: '0.72rem', color: '#1e40af', lineHeight: 1.5
                }}>
                  <i className="fas fa-stamp" style={{ marginTop: '2px' }} />
                  <span>
                    For evidence integrity, every uploaded photo and video is automatically
                    <strong> date- and case-stamped</strong> and <strong>audit-logged</strong>
                    {' '}(uploader, time, and device) upon submission.
                  </span>
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
                        <strong>{formData.respondent}</strong>
                      </div>
                      <div className="CIR_REVIEW_ITEM">
                        <span>Type:</span> 
                        <span className="CIR_TAG">{formData.type}</span>
                      </div>
                      <div className="CIR_REVIEW_ITEM">
                        <span>Evidence:</span>
                        <strong>{mediaFiles.length} image(s) attached</strong>
                      </div>
                      <div className="CIR_REVIEW_ITEM">
                        <span>Video:</span>
                        <strong>{videoFile ? '1 video attached' : 'None'}</strong>
                      </div>
                      <div className="CIR_REVIEW_DIVIDER"></div>
                      <div className="CIR_REVIEW_ITEM">
                        <span>Location:</span> 
                        <strong>{formData.purok}</strong>
                      </div>
                      <div className="CIR_REVIEW_ITEM REASON">
                        <span>Statement:</span> 
                        <p>"{formData.narrative}"</p>
                      </div>
                   </div>
                </div>
                {/* 🛡️ REFLECTED: Proactive Step 3 Disclaimer & Checkbox layout grouping */}
                <div className="CIR_DISCLAIMER" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '10px' }}>
                   <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                     <input type="checkbox" id="certify" checked readOnly />
                     <label htmlFor="certify">I certify that the information provided is true and correct.</label>
                   </div>
                   {/* 🔐 RA 10173 / GDPR data-privacy consent (required to submit) */}
                   <PrivacyConsent checked={consent} onChange={setConsent} purpose="this incident report" />
                   <small style={{ color: '#64748b', fontSize: '0.72rem', fontStyle: 'italic', fontWeight: 500 }}>
                     * Notice: Submitting this form consumes 1 of your 2 available daily incident report filing slots.
                   </small>
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
             <button className="CIR_BTN_PRIMARY SUBMIT" onClick={handleSubmit} disabled={isSubmitting || !consent} title={!consent ? 'Please agree to the Data Privacy Notice to submit' : undefined}>
               {isSubmitting ? 'Sending...' : 'Submit Report'}
             </button>
           )}
        </div>

      </div>
    </div>
  );
}
