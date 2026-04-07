import React, { useState, useRef, useEffect, useCallback } from 'react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

// NEW CSS ARCHITECTURE
import './styles/Document_Frame.css'; 
import './styles/Document_Format.css';

// ✅ RESTORED: Using your perfectly mapped API file
import { useDocumentDataAPI, saveDocumentRecord, type IResident } from './Types/Doc_data_api';

// Import modular templates
import { getBarangayClearanceTemplate } from './Doc_type/Barangay_clearance';
import { getCertificateOfIndigencyTemplate } from './Doc_type/Barangay_Indegency';
import { getCertificateOfResidencyTemplate } from './Doc_type/Barangay_Residency';

// Asset Icons
import baguioLogo from './icons/Baguio_city.png'; 
import brgyLogo from './icons/Barangay_eng-hill.png'; 

// --- TYPES ---
interface IDocRequest {
  id?: string;
  referenceNo: string;
  residentName: string;
  type: string;
  purpose: string;
  dateRequested: string;
  status: string;
  price: number;
  resident_id?: string;
}

interface FileProps {
  onClose: () => void;
  onSuccess: () => void;
  data: IDocRequest;
  officials?: { position: string; full_name: string }[]; 
}

// 🛠️ THE FIX: Normalizer to handle Database Uppercase vs UI Titlecase
const normalizeDocType = (dbType: string) => {
  const lower = (dbType || '').toLowerCase();
  if (lower.includes('indigency')) return 'Certificate of Indigency';
  if (lower.includes('residency')) return 'Certificate of Residency';
  if (lower.includes('certification') || lower.includes('jobseeker')) return 'Barangay Certification';
  if (lower.includes('affidavit')) return 'Affidavit of Barangay Official';
  return 'Barangay Clearance'; // Default fallback
};

export const Document_File: React.FC<FileProps> = ({ onClose, onSuccess, data, officials = [] }) => {
  const apiData = useDocumentDataAPI(data.residentName, data.resident_id);
  const residents = apiData?.residents || [];
  const apiCaptainName = apiData?.captainName || "";
  const autoFilledAddress = apiData?.autoFilledAddress || "";

  const [isSaving, setIsSaving] = useState(false);
  const [filteredResidents, setFilteredResidents] = useState<IResident[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedResidentId, setSelectedResidentId] = useState<string | null>(data.resident_id || null);
  const [isInitialized, setIsInitialized] = useState(false); 

  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);

  const [content, setContent] = useState({
    residentName: data.residentName || '',
    type: normalizeDocType(data.type), // 🛠️ APPLIED THE NORMALIZER HERE
    purpose: data.purpose || '',
    dateIssued: new Date().toISOString().split('T')[0], 
    address: '',
    ctcNo: '',
    orNo: 'OR123',
    feesPaid: data.price?.toString() || '200.00',
    certificateNo: '2025-07-30-08'
  });

  const previewRef = useRef<HTMLDivElement>(null);
  const searchWrapperRef = useRef<HTMLDivElement>(null);
  const pdfTargetRef = useRef<HTMLDivElement>(null);
  const [contentKey, setContentKey] = useState(0); 

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const formatToProperName = useCallback((first: string = '', middle: string = '', last: string = '') => {
    const capitalize = (str: string) => 
      str.trim().toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    const fName = capitalize(first);
    const lName = capitalize(last);
    const mInit = middle.trim() ? `${middle.trim().charAt(0).toUpperCase()}. ` : '';
    return `${fName} ${mInit}${lName}`.trim();
  }, []);

  useEffect(() => {
    if (residents.length > 0 && !isInitialized && (data.resident_id || data.residentName)) {
      const matched = residents.find(r => {
        if (data.resident_id && r.record_id === data.resident_id) return true;
        
        const fName = r.first_name || '';
        const lName = r.last_name || '';
        const mName = r.middle_name || '';
        const dbFullName = formatToProperName(fName, mName, lName).toLowerCase();
        const searchName = (data.residentName || '').trim().toLowerCase();
        return dbFullName === searchName || dbFullName.includes(searchName);
      });

      if (matched) {
        const addrParts: string[] = [];
        if (matched.current_address && matched.current_address.toLowerCase() !== 'n/a') {
          addrParts.push(matched.current_address);
        }
        if (matched.purok) {
          addrParts.push(matched.purok);
        }

        const formattedAddress = addrParts.join(', ');
        const formattedName = formatToProperName(matched.first_name, matched.middle_name, matched.last_name);

        setContent(prev => ({
          ...prev,
          residentName: formattedName,
          address: formattedAddress
        }));

        setSelectedResidentId(matched.record_id || null);
        setIsInitialized(true); 
      }
    }
  }, [residents, data.resident_id, data.residentName, isInitialized, formatToProperName]);

  useEffect(() => {
    if (autoFilledAddress && !isInitialized) {
      setContent(prev => ({ ...prev, address: autoFilledAddress }));
    }
  }, [autoFilledAddress, isInitialized]);

  useEffect(() => {
    setContentKey(prev => prev + 1);
    if (previewRef.current) {
      previewRef.current.innerHTML = getTemplateContent();
    }
  }, [content.residentName, content.address, content.purpose, content.type, content.dateIssued]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value;
    setContent(prev => ({ ...prev, residentName: input }));
    
    if (isInitialized) {
      setSelectedResidentId(null);
      setIsInitialized(false); 
    }

    if (input.length > 0 && residents.length > 0) {
      const filtered = residents.filter(r => {
        const rawFullName = `${r.first_name} ${r.last_name}`.toLowerCase();
        return rawFullName.includes(input.toLowerCase());
      });
      setFilteredResidents(filtered);
      setShowDropdown(true);
    } else {
      setShowDropdown(false);
    }
  };

  const selectResident = (r: IResident) => {
    const formattedName = formatToProperName(r.first_name, r.middle_name, r.last_name);
    const addrParts: string[] = []; 
    if (r.current_address && r.current_address.toLowerCase() !== 'n/a') addrParts.push(r.current_address);
    if (r.purok) addrParts.push(r.purok);

    setContent(prev => ({ 
      ...prev, 
      residentName: formattedName,
      address: addrParts.join(', ') 
    }));
    setSelectedResidentId(r.record_id || null); 
    setIsInitialized(true);
    setShowDropdown(false);
  };

  const handleTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newType = e.target.value;
    const priceMap: Record<string, string> = {
      'Barangay Clearance': '200.00',
      'Certificate of Indigency': '200.00',
      'Certificate of Residency': '200.00',
      'Barangay Certification': '0.00', 
      'Affidavit of Barangay Official': '200.00'
    };
    setContent(prev => ({ 
      ...prev, 
      type: newType,
      feesPaid: priceMap[newType] || '0.00'
    }));
  };

  const getTemplateContent = () => {
    const { residentName, address, purpose, dateIssued, type } = content;
    const templateProps = { name: residentName || "_________________", address, purpose, dateIssued };

    switch(type) {
      case 'Barangay Clearance': return getBarangayClearanceTemplate(templateProps);
      case 'Certificate of Indigency': return getCertificateOfIndigencyTemplate(templateProps);
      case 'Certificate of Residency': return getCertificateOfResidencyTemplate(templateProps);
      case 'Barangay Certification': return `<p style="text-indent: 50px; text-align: justify;">This is to certify that <b>${templateProps.name}</b>, a resident of ${templateProps.address} for One Year, is a qualified availee of RA 11261 or the <b>First time Jobseekers Act of 2019.</b></p><p style="text-indent: 50px; text-align: justify;">I further certify that the holder/bearer was informed of his/her rights, including the duties and responsibilities accorded by RA 11261 through the <b>Oath of Undertaking</b> he/she has signed and executed in the presence of our Barangay Official.</p><p style="text-indent: 50px; text-align: justify;">Signed this ${new Date(templateProps.dateIssued).getDate()}th day of ${new Date(templateProps.dateIssued).toLocaleString('default', { month: 'long' })} ${new Date(templateProps.dateIssued).getFullYear()} at Engineer's Hill Barangay, Baguio City.</p><p style="text-indent: 50px; text-align: justify;">This certification is valid only One (1) year from the issuance.</p>`;
      case 'Affidavit of Barangay Official': return `<p style="text-indent: 50px; text-align: justify;">That <b>${templateProps.name}</b>, bonafide resident at ${templateProps.address}, is a Single Parent defined under Section 3a of The Solo Parent Welfare Act...</p>`;
      default: return `<p style="text-align: justify; font-size: 12pt; line-height: 1.6;">This is to certify that <b>${templateProps.name}</b> is a resident of this Barangay.</p>`;
    }
  };

  const handleSaveAndDownload = async () => {
    if (!content.residentName) return alert("Please enter a Requestor Name.");
    if (!content.address) return alert("Please enter or verify the resident's address.");
    
    setIsSaving(true);
    
    try {
      // 1. Generate PDF
      const canvas = await html2canvas(pdfTargetRef.current!, { scale: 3, useCORS: true });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      pdf.addImage(imgData, 'PNG', 0, 0, 210, 297);
      pdf.save(`${content.type.replace(/\s+/g, '_')}_${content.residentName}.pdf`);

      // 2. Build Payload
      const payload = {
        ...(data.id ? { id: data.id } : {}),
        resident_id: selectedResidentId || 'MANUAL_ENTRY',
        resident_name: content.residentName,
        type: content.type,
        purpose: content.purpose,
        price: parseFloat(content.feesPaid) || 0, 
        status: 'Completed',
        reference_no: data.referenceNo || `REF-${Date.now()}`,
        date_requested: new Date().toISOString() 
      };

      // 3. Save to database
      await saveDocumentRecord(payload);

      onSuccess();
      onClose();

    } catch (error: any) {
      console.error("Save Error:", error);
      alert(`Error processing document: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const activeOfficial = officials?.find(o => 
    o.position.toLowerCase().includes('captain') || o.position.toLowerCase().includes('punong')
  ) || officials?.[0];

  const displayCaptainName = activeOfficial?.full_name || apiCaptainName || "AMADO M. FELIZARDO";
  const displayCaptainPosition = activeOfficial?.position || "Punong Barangay";

  const isResidency = content.type === 'Certificate of Residency';
  const isClearance = content.type === 'Barangay Clearance';
  const isCertification = content.type === 'Barangay Certification'; 
  const isAffidavit = content.type === 'Affidavit of Barangay Official';

  const hasPlainHeader = isCertification || isAffidavit;
  const hasStampBox = isResidency || isCertification;
  const hasMetadataBox = isClearance;

  return (
    <div className="DOC_GEN_OVERLAY" onClick={(e) => e.stopPropagation()}>
      <div className="DOC_GEN_TOOLBAR">
        <div className="DOC_GEN_TOOL_GROUP">
          <button className={isBold ? 'active' : ''} onMouseDown={(e) => { e.preventDefault(); document.execCommand('bold'); setIsBold(!isBold); }}><b>B</b></button>
          <button className={isItalic ? 'active' : ''} onMouseDown={(e) => { e.preventDefault(); document.execCommand('italic'); setIsItalic(!isItalic); }}><i>I</i></button>
          <button className={isUnderline ? 'active' : ''} onMouseDown={(e) => { e.preventDefault(); document.execCommand('underline'); setIsUnderline(!isUnderline); }}><u>U</u></button>
        </div>
        <div className="DOC_GEN_TOOL_ACTIONS">
          <button className="DOC_GEN_BTN_CANCEL" onClick={onClose}>Close</button>
          <button className="DOC_GEN_BTN_SAVE" onClick={handleSaveAndDownload} disabled={isSaving}>
            {isSaving ? 'Processing...' : 'Print / Download'}
          </button>
        </div>
      </div>

      <div className="DOC_GEN_BODY">
        {/* --- SIDEBAR --- */}
        <div className="DOC_GEN_SIDE_PANEL">
          <div className="DOC_GEN_PANEL_HEADER">Document Details</div>
          
          <div className="DOC_GEN_INPUT_GROUP RELATIVE" ref={searchWrapperRef}>
            <label>Requestor Name</label>
            <div className="DOC_GEN_SEARCH_WRAPPER">
              <input type="text" value={content.residentName} onChange={handleNameChange} onFocus={() => setShowDropdown(true)} />
            </div>
            {showDropdown && filteredResidents.length > 0 && (
              <ul className="DOC_GEN_DROPDOWN">
                {filteredResidents.map(r => (
                  <li key={r.record_id} onClick={() => selectResident(r)}>
                    <span className="DOC_GEN_RES_NAME">{formatToProperName(r.first_name, r.middle_name, r.last_name)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="DOC_GEN_INPUT_GROUP">
            <label>Document Type</label>
            <select value={content.type} onChange={handleTypeChange} className="DOC_GEN_SELECT">
              <option value="Barangay Clearance">Barangay Clearance</option>
              <option value="Certificate of Residency">Certificate of Residency</option>
              <option value="Barangay Certification">Barangay Certification (Jobseekers)</option>
              <option value="Affidavit of Barangay Official">Affidavit of Barangay Official</option>
              <option value="Certificate of Indigency">Certificate of Indigency</option>
            </select>
          </div>

          {hasMetadataBox && (
            <>
              <div className="DOC_GEN_INPUT_GROUP">
                <label>CTC No.</label>
                <input type="text" value={content.ctcNo} onChange={e => setContent(prev => ({...prev, ctcNo: e.target.value}))} />
              </div>
              <div className="DOC_GEN_INPUT_GROUP">
                <label>O.R. No.</label>
                <input type="text" value={content.orNo} onChange={e => setContent(prev => ({...prev, orNo: e.target.value}))} />
              </div>
              <div className="DOC_GEN_INPUT_GROUP">
                <label>Fees Paid</label>
                <input type="text" value={content.feesPaid} onChange={e => setContent(prev => ({...prev, feesPaid: e.target.value}))} />
              </div>
            </>
          )}

          {hasStampBox && (
            <div className="DOC_GEN_INPUT_GROUP">
              <label>O.R. No. (Stamp Box)</label>
              <input type="text" value={content.orNo} onChange={e => setContent(prev => ({...prev, orNo: e.target.value}))} />
            </div>
          )}

          <div className="DOC_GEN_INPUT_GROUP">
            <label>Address</label>
            <input value={content.address} onChange={e => setContent(prev => ({...prev, address: e.target.value}))} />
          </div>

          <div className="DOC_GEN_INPUT_GROUP">
            <label>Purpose</label>
            <input value={content.purpose} onChange={e => setContent(prev => ({...prev, purpose: e.target.value}))} />
          </div>
        </div>

        {/* --- A4 PREVIEW --- */}
        <div className="DOC_GEN_PREVIEW_AREA">
          <div className="DOC_GEN_A4_PAGE" ref={pdfTargetRef}>
            
            <img src={brgyLogo} alt="Seal" className="DOC_WATERMARK" />

            {/* CONDITIONAL HEADER */}
            {hasPlainHeader ? (
              <div style={{ position: 'relative', textAlign: 'center', marginBottom: '30px', fontFamily: 'Arial, sans-serif' }}>
                {isCertification && (
                  <div style={{ position: 'absolute', top: '-10px', right: '0', fontSize: '9pt', fontWeight: 'bold' }}>
                    Barangay Certificate No. : {content.certificateNo}
                  </div>
                )}
                <img src={brgyLogo} alt="Brgy" style={{ position: 'absolute', top: '0', left: '0', width: '90px' }} />
                <div style={{ lineHeight: '1.4' }}>
                  <p style={{ margin: 0, fontSize: '11pt' }}>Republic of the Philippines</p>
                  <p style={{ margin: '3px 0', fontSize: '13pt', fontWeight: 800 }}>ENGINEER'S HILL BARANGAY</p>
                  <p style={{ margin: 0, fontSize: '11pt' }}>Baguio City</p>
                  <p style={{ margin: 0, fontSize: '11pt' }}>074-422-8228</p>
                  <p style={{ margin: 0, fontSize: '11pt' }}>Email Address: enrqshill2600@gmail.com</p>
                </div>
              </div>
            ) : (
              <div className="DOC_HEADER_ROW">
                <div className="DOC_LOGO_BOX"><img src={brgyLogo} alt="Brgy" className="DOC_LOGO_IMG" /></div>
                <div className="DOC_BANNER_GREEN">
                  <p>REPUBLIC OF THE PHILIPPINES</p>
                  <p>CITY OF BAGUIO</p>
                  <p className="BANNER_BRGY_NAME">ENGINEER'S HILL BARANGAY</p>
                </div>
                <div className="DOC_LOGO_BOX"><img src={baguioLogo} alt="Baguio" className="DOC_LOGO_IMG" /></div>
              </div>
            )}

            {/* CONDITIONAL TITLES */}
            <div className="RES_HEADER_BLOCK">
              {isResidency && <div className="RES_OFFICE_TITLE">OFFICE OF THE PUNONG BARANGAY</div>}
              <h1 className="RES_DOC_TITLE">{content.type.toUpperCase()}</h1>
              {isCertification && <p style={{ margin: '5px 0 0 0', fontSize: '11pt', fontWeight: 'bold' }}>(FIRST TIME JOBSEEKERS ASSISTANCE ACT - RA 11261)</p>}
              {isAffidavit && <p style={{ margin: '5px 0 0 0', fontSize: '12pt', fontWeight: 'bold' }}>THAT A PARENT IS A RESIDENT OF THIS BARANGAY</p>}
            </div>

            {/* CONTENT BODY */}
            <div 
                key={contentKey}
                className="DOC_RICH_CONTENT"
                contentEditable
                ref={previewRef}
                suppressContentEditableWarning={true}
                dangerouslySetInnerHTML={{ __html: getTemplateContent() }}
            ></div>

            {/* CONDITIONAL SIGNATURE LAYOUTS */}
            <div className="DOC_SIG_SECTION" style={{ marginTop: '40px' }}>
              
              {isClearance && (
                 <div className="DOC_SIG_LEFT" style={{ width: '40%', textAlign: 'center' }}>
                    <div style={{ borderTop: '1px solid #000', paddingTop: '5px', marginTop: '60px', fontWeight: 'bold' }}>Signature</div>
                 </div>
              )}

              {isAffidavit && (
                 <div className="DOC_SIG_LEFT" style={{ width: '50%', textAlign: 'left', marginTop: '40px' }}>
                    <p style={{ fontWeight: 'bold', marginBottom: '15px' }}>Witnesses:</p>
                    <p><b>Name:</b> MARYELLA KRYZELLE L. ESLAVA</p>
                    <p><b>Address:</b> 125 Lagerra Alley, Engr's Hill</p>
                    <p><b>Contact No:</b> 09676847922</p>
                 </div>
              )}

              <div className="DOC_SIG_RIGHT" style={{ width: isCertification ? '60%' : '45%', marginLeft: 'auto', textAlign: isCertification ? 'left' : 'center', paddingLeft: isCertification ? '100px' : '0' }}>
                <p className="OFFICIAL_NAME" style={{ fontWeight: 800, margin: '0 0 2px 0' }}>{displayCaptainName.toUpperCase()}</p>
                <p className="OFFICIAL_POSITION" style={{ margin: 0, textTransform: 'uppercase' }}>{displayCaptainPosition}</p>
                
                {isCertification && (
                  <div style={{ marginTop: '20px' }}>
                    <p style={{ margin: '15px 0' }}>{new Date(content.dateIssued).toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' })}</p>
                    <p style={{ margin: '20px 0 40px 0' }}>Witnessed by:</p>
                    <p className="OFFICIAL_NAME" style={{ fontWeight: 800, margin: '0 0 2px 0' }}>CHARITO A. GUMAD-ANG</p>
                    <p className="OFFICIAL_POSITION" style={{ margin: 0 }}>BARANGAY KAGAWAD</p>
                    <p style={{ margin: '15px 0 0 0' }}>{new Date(content.dateIssued).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
                  </div>
                )}
              </div>
            </div>

            {/* STAMP BOX */}
            {hasStampBox && (
              <div className="RES_STAMP_BOX">
                <div className="RES_STAMP_TITLE">"DOCUMENTARY STAMP TAX PAID"</div>
                <div className="RES_STAMP_ROW">
                  <div className="RES_STAMP_COL">
                    <div className="RES_STAMP_VALUE">{content.orNo || '____________'}</div>
                    <div className="RES_STAMP_LINE"></div>
                    <div className="RES_STAMP_LABEL">GOR Serial Number</div>
                  </div>
                  <div className="RES_STAMP_COL">
                    <div className="RES_STAMP_VALUE">{new Date(content.dateIssued).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                    <div className="RES_STAMP_LINE"></div>
                    <div className="RES_STAMP_LABEL">Date of Payment</div>
                  </div>
                </div>
              </div>
            )}

            {/* CLEARANCE BOTTOM METADATA */}
            {hasMetadataBox && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '20px', fontSize: '11pt', fontWeight: 'bold' }}>
                <div>
                  <p style={{ margin: '5px 0' }}>CTC NO: <span style={{ fontWeight: 'normal' }}>{content.ctcNo || '__________________'}</span></p>
                  <p style={{ margin: '5px 0' }}>Issued At: Engineer's Hill, Baguio City</p>
                  <p style={{ margin: '5px 0' }}>Issued On: {new Date(content.dateIssued).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ margin: '5px 0' }}>Fees Paid: <span style={{ fontWeight: 'normal' }}>{content.feesPaid}</span></p>
                  <p style={{ margin: '5px 0' }}>O.R.No.: <span style={{ fontWeight: 'normal' }}>{content.orNo || '__________________'}</span></p>
                </div>
              </div>
            )}

            {/* CONDITIONAL FOOTER */}
            {!hasPlainHeader && (
              <div className="DOC_GREEN_FOOTER" style={{ marginTop: 'auto', borderTop: '1px solid #000', paddingTop: '15px', borderColor: 'green'}}>
                <div className="FOOTER_CONTACT_INFO" style={{ color: 'green',display: 'flex', justifyContent: 'center', gap: '30px', fontWeight: 'bold', marginBottom: '5px' }}>
                  <span>✉ enrqshill2600@gmail.com</span>
                  <span>📞 074-422-8228</span>
                </div>
                <p className="FOOTER_ADDRESS" style={{ color:'green', margin: 0, fontWeight: 'bold' }}>📍 Engineer's Hill Barangay, Baguio City</p>
              </div>
            )}

            {isCertification && (
              <div style={{ marginTop: 'auto', fontSize: '10pt', fontWeight: 'bold', textAlign: 'left' }}>
                <p style={{ margin: '0 0 2px 0' }}>THIS FORM NEED NOT BE NOTARIZED</p>
                <p style={{ margin: 0, fontStyle: 'italic', fontWeight: 'normal' }}>11261 Form 1</p>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
};