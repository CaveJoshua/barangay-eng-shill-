import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { handleTextCommand } from './Tools'; 
import { generateBlotterPDF } from './interlogic'; 
import './styles/Blotter_File.css'; 

// IMPORT THE MASTERMIND SERVICE
import { ApiService } from '../../UI/api'; 

// ALIGNED: Strictly matches the residents_records database structure
interface IResident {
  record_id: string; 
  first_name: string;
  middle_name?: string;
  last_name: string;
  purok: string;
}

interface IFileProps {
  onClose: () => void;
  onRefresh: () => void;
  selectedCase: any;
}

// 🛡️ ENHANCED EXTRACTOR: Safely extracts up to 6 images cleanly
const parseEvidence = (text: string) => {
  if (!text) return { cleanText: '', evidenceUrls: [] as string[] };
  
  const marker = '[ATTACHED EVIDENCE]';
  const markerIndex = text.indexOf(marker);
  
  if (markerIndex !== -1) {
    const cleanText = text.substring(0, markerIndex).trim();
    const urlSection = text.substring(markerIndex);
    
    // Regex to find all valid URLs or Base64 strings
    const urlRegex = /(https?:\/\/[^\s]+|data:image\/[a-zA-Z]*;base64,[^\s]+)/g;
    const matchedUrls = urlSection.match(urlRegex) || [];
    
    // Cap at a maximum of 6 photos
    return { 
      cleanText, 
      evidenceUrls: matchedUrls.slice(0, 6) 
    };
  }
  
  return { cleanText: text, evidenceUrls: [] as string[] };
};

export const FileComponent: React.FC<IFileProps> = ({ onClose, onRefresh, selectedCase }) => {
  
  // --- 1. CORE FORMATTER ---
  const formatToProperName = useCallback((first: string = '', middle: string = '', last: string = '') => {
    const toTitleCase = (str: string) => 
      str.toLowerCase().trim().split(/\s+/).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

    const fName = toTitleCase(first);
    const lName = toTitleCase(last);
    const mInit = middle.trim() ? `${middle.trim().charAt(0).toUpperCase()}. ` : '';

    return `${fName} ${mInit}${lName}`.trim();
  }, []);

  const generateCaseNumber = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const random = Math.floor(1000 + Math.random() * 9000);
    return `BL-${year}${month}${day}-${random}`;
  };

  // 🛡️ EXTRACT EVIDENCE ON LOAD
  const { cleanText, evidenceUrls: currentEvidence } = useMemo(() => {
    return parseEvidence(selectedCase?.narrative || '');
  }, [selectedCase?.narrative]);

  // --- STATE ---
  const [residents, setResidents] = useState<IResident[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchQuery, setSearchQuery] = useState(selectedCase?.complainant_name || '');
  
  // 📸 DYNAMIC EVIDENCE STATE FOR THE SIDEBAR
  const [evidenceList, setEvidenceList] = useState<string[]>(currentEvidence);

  const [formData, setFormData] = useState({
    id: selectedCase?.id || null,
    caseNumber: selectedCase?.case_number || generateCaseNumber(),
    complainantId: selectedCase?.complainant_id || '',
    complainantName: selectedCase?.complainant_name || '',
    respondent: selectedCase?.respondent || '',
    type: selectedCase?.incident_type || 'Noise Complaint',
    dateFiled: selectedCase?.date_filed || new Date().toISOString().split('T')[0],
    timeFiled: selectedCase?.time_filed || new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    narrative: cleanText, 
  });

  const previewRef = useRef<HTMLDivElement>(null);
  const searchWrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const valve = new AbortController();

    const fetchData = async () => {
      try {
        const resData = await ApiService.getResidents(valve.signal);
        if (resData === null) return;
        setResidents(Array.isArray(resData) ? resData : []);
      } catch (err: any) { 
        if (err.name !== 'AbortError') {
            console.error("Blotter Sync Error:", err); 
        }
      }
    };

    fetchData();

    const handleClickOutside = (event: MouseEvent) => {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    
    return () => {
        valve.abort();
        document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // --- LOGIC: SEARCH ---
  const filteredResidents = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    if (!query || query === formData.complainantName.toLowerCase()) return [];
    
    return residents.filter(r => {
      const searchPool = `${r.first_name} ${r.last_name} ${r.middle_name || ''}`.toLowerCase();
      return searchPool.includes(query);
    });
  }, [residents, searchQuery, formData.complainantName]);

  const handleSelectResident = (r: IResident) => {
    const fullName = formatToProperName(r.first_name, r.middle_name, r.last_name);
    setFormData(prev => ({ ...prev, complainantId: r.record_id, complainantName: fullName }));
    setSearchQuery(fullName);
    setShowDropdown(false);
  };

  // --- 📸 LOGIC: MULTI-IMAGE ATTACHMENT IN SIDEBAR ---
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []); // Fixed TypeScript Array fallback
    if (evidenceList.length + files.length > 6) {
      alert("System error: A maximum of 6 images are allowed.");
      return;
    }
    
    files.forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setEvidenceList(prev => {
          if (prev.length >= 6) return prev; 
          return [...prev, reader.result as string]; // Fixed array spreading
        });
      };
      reader.readAsDataURL(file); 
    });
  };

  const removeEvidence = (indexToRemove: number) => {
    setEvidenceList(prev => prev.filter((_, i) => i !== indexToRemove));
  };

  /**
   * REFACTORED SUBMIT: PDF Capture fixes
   */
  const handleFinalSubmit = async () => {
    if (!formData.complainantName.trim()) return alert("Complainant name missing!");
    if (!formData.respondent.trim()) return alert("Respondent name missing!");

    setIsSubmitting(true);
    let finalNarrative = previewRef.current?.innerHTML || formData.narrative;
    
    // 🛡️ RE-ATTACH ALL EVIDENCE
    if (evidenceList.length > 0) {
      const formattedUrls = evidenceList.map(url => `[ATTACHED EVIDENCE] ${url}`).join(' ');
      finalNarrative += ` ${formattedUrls}`;
    }
    
    const submissionData = { 
      ...formData,
      complainant_id: formData.complainantId || 'WALK-IN', 
      complainant_name: formData.complainantName,
      incident_type: formData.type,
      narrative: finalNarrative, 
      date_filed: formData.dateFiled,
      time_filed: formData.timeFiled
    };

    try {
      const result = await ApiService.saveBlotter(formData.id, submissionData);
      
      if (result.success) {
        // Remove scroll boundaries so HTML2Canvas captures everything
        const captureArea = document.getElementById('blotter-capture-area') as HTMLElement;
        if (captureArea) {
            captureArea.style.overflow = 'visible';
            captureArea.style.height = 'max-content'; 
            
            await new Promise(resolve => setTimeout(resolve, 800));
            await generateBlotterPDF('blotter-capture-area', result.data); 
            
            captureArea.style.overflow = 'visible';
            captureArea.style.height = ''; 
        }

        onRefresh();
        onClose();
      } else {
        alert(`System error: Server error.`);
      }
    } catch (err: any) { 
      console.error("Blotter Save Error:", err);
      alert('Handshake failed. Check your connection or payload size.'); 
    } finally { 
      setIsSubmitting(false); 
    }
  };

  return (
    <div className="BLOT_FILE_OVERLAY" onClick={onClose}>
      <div className="BLOT_FILE_BODY" onClick={(e) => e.stopPropagation()}>
        
        <div className="BLOT_FILE_TOOLBAR">
          <div className="BLOT_TOOL_GROUP">
            <button type="button" onMouseDown={(e) => { e.preventDefault(); handleTextCommand('bold'); }}>B</button>
            <button type="button" onMouseDown={(e) => { e.preventDefault(); handleTextCommand('italic'); }}>I</button>
            <button type="button" onMouseDown={(e) => { e.preventDefault(); handleTextCommand('underline'); }}>U</button>
          </div>
          <div className="BLOT_TOOL_ACTIONS">
            <button type="button" className="BLOT_BTN_CANCEL" onClick={onClose}>Discard</button>
            <button type="button" className="BLOT_BTN_SAVE" onClick={handleFinalSubmit} disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save & Download PDF'}
            </button>
          </div>
        </div>

        <div className="BLOT_FILE_CONTENT">
          <aside className="BLOT_SIDE_PANEL">
            <div className="BLOT_PANEL_HEADER">Case Management</div>
            
            <div className="BLOT_INPUT_GROUP" ref={searchWrapperRef}>
              <label>Complainant Name</label>
              <input 
                type="text" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setShowDropdown(true)}
                placeholder="Search resident..."
                autoComplete="off"
              />
              {showDropdown && filteredResidents.length > 0 && (
                <ul className="BLOT_DROPDOWN">
                  {filteredResidents.map(r => (
                    <li key={r.record_id} onMouseDown={(e) => { e.preventDefault(); handleSelectResident(r); }}>
                      <span className="RES_NAME">
                        {formatToProperName(r.first_name, r.middle_name, r.last_name)}
                      </span>
                      <small className="RES_ID">Purok {r.purok}</small>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="BLOT_INPUT_GROUP">
              <label>Respondent (Accused)</label>
              <input 
                type="text" 
                value={formData.respondent} 
                onChange={(e) => setFormData({...formData, respondent: e.target.value.toUpperCase()})}
              />
            </div>
            
             <div className="BLOT_INPUT_GROUP">
              <label>Complaint Type</label>
              <select value={formData.type} onChange={(e) => setFormData({...formData, type: e.target.value})}>
                <option value="Noise Complaint">Noise Complaint</option>
                <option value="Theft">Theft</option>
                <option value="Physical Injury">Physical Injury</option>
                <option value="Threats">Threats</option>
              </select>
            </div>

            {/* 📸 SMART ATTACHMENT AREA */}
            <div className="BLOT_INPUT_GROUP" style={{ marginTop: '10px', borderTop: '1px solid #e2e8f0', paddingTop: '15px' }}>
              <label>Attach Evidence (Max 6)</label>
              <input 
                type="file" 
                multiple 
                accept="image/*" 
                onChange={handleImageUpload} 
                disabled={evidenceList.length >= 6}
                style={{ fontSize: '0.8rem', padding: '6px' }}
              />
              
              {evidenceList.length > 0 && (
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '12px' }}>
                  {evidenceList.map((url, i) => (
                    <div key={i} style={{ position: 'relative', width: '70px', height: '70px' }}>
                      <img 
                        src={url} 
                        alt="preview" 
                        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '4px', border: '1px solid #cbd5e1' }} 
                      />
                      <button 
                        onClick={() => removeEvidence(i)} 
                        title="Remove"
                        style={{
                          position: 'absolute', top: -8, right: -8, background: '#dc2626', color: 'white',
                          borderRadius: '50%', width: '20px', height: '20px', fontSize: '11px', fontWeight: 'bold',
                          border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                        X
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>

          <section className="BLOT_PREVIEW_AREA">
            <div id="blotter-capture-area" style={{ display: 'flex', flexDirection: 'column', height: 'max-content', paddingBottom: '2rem' }}>
              
              {/* ================= PAGE 1 ================= */}
              <div className="BLOT_A4_PAGE" style={{ margin: 0 }}>
                <div className="BLOT_A4_HEADER">
                  <div className="BLOT_HEADER_TEXT">
                    <p>Republic of the Philippines</p>
                    <p>Province of Benguet</p>
                    <p>City of Baguio</p>
                    <h4>BARANGAY ENGINEER'S HILL</h4>
                    <p className="OFFICE">OFFICE OF THE LUPONG TAGAPAMAYAPA</p>
                  </div>
                </div>

                <div className="BLOT_A4_LINE"></div>
                <h2 className="BLOT_DOC_TITLE">INCIDENT REPORT</h2>

                <div className="BLOT_A4_CONTENT">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
                    <span><b>Date/Time:</b> {formData.dateFiled} : {formData.timeFiled}</span>
                    <span><b>Case No:</b> {formData.caseNumber}</span>
                  </div>

                  <p><b>COMPLAINANT:</b> <span style={{ textDecoration: 'underline' }}>{formData.complainantName || "____________________"}</span></p>
                  <p><b>RESPONDENT:</b> <span style={{ textDecoration: 'underline' }}>{formData.respondent || "____________________"}</span></p>
                  
                  <div style={{ marginTop: '30px' }}>
                    <p><b>NARRATIVE OF INCIDENT:</b></p>
                    <div 
                      className="BLOT_EDITABLE_CONTENT"
                      contentEditable
                      ref={previewRef}
                      dangerouslySetInnerHTML={{ __html: formData.narrative }}
                      suppressContentEditableWarning={true}
                      onBlur={(e) => setFormData({...formData, narrative: e.currentTarget.innerHTML})}
                      style={{ 
                        minHeight: evidenceList.length === 1 ? '150px' : '300px', 
                        outline: 'none', 
                        border: '1px dashed #eee', 
                        padding: '10px' 
                      }}
                    ></div>

                    {/* 🛡️ SINGLE PHOTO: Renders inline on Page 1. Fixed string[] assignment. */}
                    {evidenceList.length === 1 && (
                      <div style={{ marginTop: '20px', border: '1px solid #1e293b', padding: '15px', position: 'relative', pageBreakInside: 'avoid' }}>
                         <span style={{ 
                          fontFamily: 'Arial, sans-serif', 
                          fontWeight: 'bold',
                          fontSize: '10pt', 
                          marginBottom: '8px',
                          color: '#000',
                          display: 'block'
                        }}>
                          ATTACHED EVIDENCE:
                        </span>
                        <img 
                          src={evidenceList[0]} 
                          alt="Evidence" 
                          style={{ 
                            width: '100%', 
                            height: 'auto', 
                            objectFit: 'contain', 
                            border: '1px solid #1e293b'
                          }} 
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ================= PAGE 2 (Adaptive Multi-Grid) ================= */}
              {evidenceList.length > 1 && (
                <div className="BLOT_A4_PAGE" style={{ margin: 0, marginTop: '40px', pageBreakBefore: 'always' }}>
                  
                  <h3 style={{ fontFamily: 'Arial, sans-serif', fontWeight: 'bold', fontSize: '14pt', marginBottom: '20px' }}>
                    ATTACHED EVIDENCE:
                  </h3>

                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: '20px',
                    alignItems: 'start' 
                  }}>
                    {evidenceList.map((url, index) => (
                      <div key={index} style={{ display: 'flex', flexDirection: 'column', pageBreakInside: 'avoid' }}>
                        <span style={{ 
                          fontFamily: 'Arial, sans-serif', 
                          fontWeight: 'bold',
                          fontSize: '10pt', 
                          marginBottom: '8px' 
                        }}>
                          EVIDENCE {index + 1}
                        </span>
                        <img 
                          src={url} 
                          alt={`Evidence ${index + 1}`} 
                          style={{ 
                            width: '100%', 
                            height: 'auto', 
                            border: '1px solid #1e293b' 
                          }} 
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          </section>
        </div>
      </div>
    </div>
  );
};