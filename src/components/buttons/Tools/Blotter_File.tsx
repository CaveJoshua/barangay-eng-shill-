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

interface IOfficial {
  id: string;
  full_name: string;
  position: string;
  status: string;
}

interface IFileProps {
  onClose: () => void;
  onRefresh: () => void;
  selectedCase: any;
  officials?: any[]; 
}

export const FileComponent: React.FC<IFileProps> = ({ onClose, onRefresh, selectedCase }) => {
  
  // --- 1. CORE FORMATTER: Converts "ranni luirnia carian" to "Ranni L. Carian" ---
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

  // --- STATE ---
  const [residents, setResidents] = useState<IResident[]>([]);
  const [captainName, setCaptainName] = useState(''); 
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  
  const [searchQuery, setSearchQuery] = useState(selectedCase?.complainant_name || '');

  const [formData, setFormData] = useState({
    id: selectedCase?.id || null,
    caseNumber: selectedCase?.case_number || generateCaseNumber(),
    complainantId: selectedCase?.complainant_id || '',
    complainantName: selectedCase?.complainant_name || '',
    respondent: selectedCase?.respondent || '',
    type: selectedCase?.incident_type || 'Noise Complaint',
    dateFiled: selectedCase?.date_filed || new Date().toISOString().split('T')[0],
    timeFiled: selectedCase?.time_filed || new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    narrative: selectedCase?.narrative || '',
  });

  const previewRef = useRef<HTMLDivElement>(null);
  const searchWrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const valve = new AbortController();

    const fetchData = async () => {
      try {
        // USING THE NEW SECURE API HANDSHAKE CALLS
        const [resData, offData] = await Promise.all([
          ApiService.getResidents(valve.signal),
          ApiService.getOfficials(valve.signal)
        ]);

        // Handshake rejection check
        if (resData === null || offData === null) return;

        setResidents(Array.isArray(resData) ? resData : []);
        
        const captain = offData.find((o: IOfficial) => 
            (o.position.toLowerCase().includes('captain') || o.position.toLowerCase().includes('punong')) && 
            o.status === 'Active'
        );
        
        if (captain) {
            setCaptainName(`HON. ${captain.full_name.toUpperCase()}`);
        } else {
            setCaptainName("AMADO M. FELIZARDO"); // Fallback
        }
        
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
      // Matches against raw and formatted names
      const searchPool = `${r.first_name} ${r.last_name} ${r.middle_name || ''}`.toLowerCase();
      return searchPool.includes(query);
    });
  }, [residents, searchQuery, formData.complainantName]);

  const handleSelectResident = (r: IResident) => {
    // AUTOMATED FORMATTING: Apply "Ranni L. Carian" style
    const fullName = formatToProperName(r.first_name, r.middle_name, r.last_name);
    setFormData(prev => ({ ...prev, complainantId: r.record_id, complainantName: fullName }));
    setSearchQuery(fullName);
    setShowDropdown(false);
  };

  /**
   * REFACTORED SUBMIT: Pure Handshake Trigger
   */
  const handleFinalSubmit = async () => {
    if (!formData.complainantName.trim()) return alert("Complainant name missing!");
    if (!formData.respondent.trim()) return alert("Respondent name missing!");

    setIsSubmitting(true);
    const finalNarrative = previewRef.current?.innerHTML || formData.narrative;
    
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
      // USING THE UNIVERSAL TRIGGER FROM MASTERMIND API
      const result = await ApiService.saveBlotter(formData.id, submissionData);
      
      if (result.success) {
        await generateBlotterPDF('blotter-capture-area', result.data); 
        onRefresh();
        onClose();
      } else {
        alert(`System error: ${result.error}`);
      }
    } catch (err: any) { 
      console.error("Blotter Save Error:", err);
      alert('Handshake failed. Check your connection.'); 
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
          </aside>

          <section className="BLOT_PREVIEW_AREA">
            <div className="BLOT_A4_PAGE" id="blotter-capture-area">
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
                    style={{ minHeight: '400px', outline: 'none', border: '1px dashed #eee', padding: '10px' }}
                  ></div>
                </div>
              </div>

              <div className="BLOT_A4_FOOTER">
                <div className="BLOT_SIG_BLOCK">
                  <p className="BLOT_SIG_NAME">{captainName}</p>
                  <div className="BLOT_SIG_LINE"></div>
                  <p className="BLOT_SIG_ROLE">Punong Barangay</p>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};