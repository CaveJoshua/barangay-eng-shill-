import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

import './styles/Document_Frame.css';
import './styles/Document_Format.css';
import './styles/Document_Template.css';

// API & TYPES
import { useDocumentDataAPI, saveDocumentRecord, type IResident } from './Types/Doc_data_api';

// ASSETS
import baguioLogo from './icons/Baguio_city.png';
import brgyLogo from './icons/Barangay_eng-hill.png';

// ─────────────────────────────────────────────────────────────────
// INTERNAL TEMPLATE ENGINES (INLINED FOR INDEPENDENCE & ACCURACY)
// ─────────────────────────────────────────────────────────────────
const getBarangayClearanceTemplate = (props: any) => `
  <p style="text-align: justify; text-indent: 48px; line-height: 1.6; margin-bottom: 16px;">
    This is to <b>CERTIFY</b> that <b>${props.name}</b>, Filipino Citizen, Male, is a bonafide resident at <b>${props.address}</b>, Engineer's Hill, Baguio City.
  </p>
  <p style="text-align: justify; text-indent: 48px; line-height: 1.6; margin-bottom: 16px;">
    Certifying further that based on available records of this Barangay, there is no derogatory record nor has there been pending or criminal case filed against the above-named person as of this date.
  </p>
  <p style="text-align: justify; text-indent: 48px; line-height: 1.6; margin-bottom: 16px;">
    This clearance is being issued upon the request of the above-named person for <b>${props.purpose}</b> purposes.
  </p>
`;

const getCertificateOfIndigencyTemplate = (props: any) => `
  <p style="text-align: justify; text-indent: 48px; line-height: 1.6; margin-bottom: 16px;">
    This is to certify that <b>${props.name}</b>, Filipino Citizen, of legal age, is a bonafide resident of <b>${props.address}</b>, Engineer's Hill, Baguio City.
  </p>
  <p style="text-align: justify; text-indent: 48px; line-height: 1.6; margin-bottom: 16px;">
    This is to further certify that the above-named person belongs to an <b>indigent family</b> in this barangay.
  </p>
  <p style="text-align: justify; text-indent: 48px; line-height: 1.6; margin-bottom: 16px;">
    This certification is issued upon the request of the above-named person for <b>${props.purpose}</b> purposes.
  </p>
`;

const getCertificateOfResidencyTemplate = (props: any) => `
  <p style="text-align: justify; text-indent: 48px; line-height: 1.6; margin-bottom: 16px;">
    This is to certify that <b>${props.name}</b>, Filipino Citizen, of legal age, male, is a bonafide resident of <b>${props.address}</b>, Engineers Hill, Baguio City.
  </p>
  <p style="text-align: justify; text-indent: 48px; line-height: 1.6; margin-bottom: 16px;">
    This is also to certify that the above-named person is a resident of this Barangay since birth.
  </p>
  <p style="text-align: justify; text-indent: 48px; line-height: 1.6; margin-bottom: 16px;">
    This certification is issued upon the request of the above-named person for <b>${props.purpose}</b> purposes.
  </p>
`;

const getJobseekerTemplate = (props: any) => `
  <p style="text-align: justify; text-indent: 48px; line-height: 1.6; margin-bottom: 20px;">
    This is to certify that <b>${props.name}</b>, a resident of <b>${props.address}</b> Engineer's Hill, Baguio City for <span contenteditable="true" style="min-width:70px; display:inline-block; border-bottom:1px solid #000; text-align:center; font-weight:normal;">One Year</span>, is a qualified availee of RA 11261 or the <b>First time Jobseekers Act of 2019</b>.
  </p>
  <p style="text-align: justify; text-indent: 48px; line-height: 1.6; margin-bottom: 20px;">
    I further certify that the holder/bearer was informed of his/her rights, including the duties and responsibilities accorded by RA 11261 through the <b>Oath of Undertaking</b> he/she has signed and executed in the presence of our Barangay Official.
  </p>
  <p style="text-align: justify; text-indent: 48px; line-height: 1.6; margin-bottom: 20px;">
    Signed this <b>${props.signedDay}</b> day of <b>${props.signedMonthYear}</b> at Engineer's Hill Barangay, Baguio City.
  </p>
  <p style="text-align: justify; text-indent: 48px; line-height: 1.6; margin-bottom: 20px;">
    This certification is valid only One (1) year from the issuance.
  </p>
`;

const getAffidavitTemplate = (props: any) => `
  <p style="text-align: justify; text-indent: 48px; line-height: 1.6; margin-bottom: 15px;">
    That <b>${props.name}</b>, <span contenteditable="true" style="border-bottom: 1px solid #000; min-width: 30px; display: inline-block; text-align: center;">58</span> years old, bonafide resident at <b>${props.address}</b>, is a Single Parent defined under Section 3a of The Solo Parent Welfare Act of RA 8972 as Expanded by RA 11861 (SOLOPARENT-DEATH OF SPOUSE)
  </p>
  <p style="margin-bottom: 10px; font-weight: bold;">His/Her Children</p>
  <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; border: 1px solid #000; text-align: center; font-size: 11pt;">
    <tr>
      <th style="border: 1px solid #000; padding: 6px;">NAME</th>
      <th style="border: 1px solid #000; padding: 6px;">DATE OF BIRTH</th>
      <th style="border: 1px solid #000; padding: 6px;">AGE</th>
    </tr>
    <tr>
      <td style="border: 1px solid #000; padding: 6px;" contenteditable="true">JOHN DOE</td>
      <td style="border: 1px solid #000; padding: 6px;" contenteditable="true">09-20-2007</td>
      <td style="border: 1px solid #000; padding: 6px;" contenteditable="true">18</td>
    </tr>
  </table>
  <p style="margin-bottom: 20px; line-height: 1.6;">Is/are under her custody.</p>
  <p style="text-align: justify; line-height: 1.6; margin-bottom: 20px;">Upon verification, the solo parent applicant is not involved into a new relationship up to present which gives them consideration to be a certified solo parent.</p>
  <p style="text-align: justify; line-height: 1.6; margin-bottom: 20px;">This affidavit is being issued upon the request of <b>${props.name}</b> for the authentication of client present status as eligible Solo Parent and for Solo-Parent identification card.</p>
  <p style="text-align: justify; line-height: 1.6; margin-bottom: 25px;">Issued this <b>${props.signedDay}</b> day of <b>${props.signedMonthYear}</b> at Engineer's Hill Barangay, Baguio City, Philippines.</p>
`;

// ─────────────────────────────────────────────────────────────────
// INTERFACES
// ─────────────────────────────────────────────────────────────────
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

interface IOathState {
  residentAge: string;
  yearsResident: string;
  jobseekerSigName: string;
  witnessedSigName: string;
  guardianName: string;
  guardianAge: string;
  guardianOf: string;
  guardianAddress: string;
  guardianYears: string;
  signedDay: string;
  signedMonthYear: string;
}

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────
const normalizeDocType = (dbType: string) => {
  const lower = (dbType || '').toLowerCase();
  if (lower.includes('indigency'))   return 'Certificate of Indigency';
  if (lower.includes('residency'))   return 'Certificate of Residency';
  if (lower.includes('certification') || lower.includes('jobseeker')) return 'Barangay Certification';
  if (lower.includes('affidavit'))   return 'Affidavit of Barangay Official';
  return 'Barangay Clearance';
};

const getDaySuffix = (n: number) => {
  if (n >= 11 && n <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
};

const fmtDate = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(iso).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });

const getUTCDay = (iso: string) => new Date(iso).getUTCDate();

const ICON = {
  bold:       <b style={{ fontFamily: 'Georgia, serif', fontSize: 13, letterSpacing: -0.5 }}>B</b>,
  italic:     <i style={{ fontFamily: 'Georgia, serif', fontSize: 13 }}>I</i>,
  underline:  <u style={{ fontFamily: 'Georgia, serif', fontSize: 13 }}>U</u>,
  close:      '✕',
  dl:         '↓',
};

// ─────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────
export const Document_File: React.FC<FileProps> = ({ onClose, onSuccess, data, officials = [] }) => {

  const apiData           = useDocumentDataAPI(data.residentName, data.resident_id);
  const residents         = apiData?.residents || [];
  const apiCaptainName    = apiData?.captainName || '';
  const autoFilledAddress = apiData?.autoFilledAddress || '';

  const [isSaving,           setIsSaving]           = useState(false);
  const [showConfirm,        setShowConfirm]        = useState(false);
  const [filteredResidents,  setFilteredResidents]  = useState<IResident[]>([]);
  const [showDropdown,       setShowDropdown]       = useState(false);
  const [selectedResidentId, setSelectedResidentId] = useState<string | null>(data.resident_id || null);
  const [isInitialized,      setIsInitialized]      = useState(false);
  const [activeTab,          setActiveTab]          = useState<'page1' | 'page2'>('page1');
  const [zoom,               setZoom]               = useState(1);
  const [wordCount,          setWordCount]          = useState(0);

  const [isBold,      setIsBold]      = useState(false);
  const [isItalic,    setIsItalic]    = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [fontSize,    setFontSize]    = useState('12pt');

  const [content, setContent] = useState({
    residentName:  data.residentName || '',
    type:          normalizeDocType(data.type),
    purpose:       data.purpose || '',
    dateIssued:    new Date().toISOString().split('T')[0],
    address:       '',
    ctcNo:         '',
    orNo:          'OR' + Math.floor(1000 + Math.random() * 9000),
    feesPaid:      data.price?.toString() || '200.00',
    certificateNo: '2025-07-' + String(Math.floor(10 + Math.random() * 90)).padStart(2, '0'),
  });

  const [oath, setOath] = useState<IOathState>({
    residentAge:      '',
    yearsResident:    '',
    jobseekerSigName: data.residentName || '',
    witnessedSigName: '',          
    guardianName:     '',
    guardianAge:      '',
    guardianOf:       data.residentName || '',
    guardianAddress:  '',
    guardianYears:    '',
    signedDay:        '',
    signedMonthYear:  '',
  });

  const richBodyRef      = useRef<HTMLDivElement>(null);
  const searchWrapperRef = useRef<HTMLDivElement>(null);
  const pdfTargetRef     = useRef<HTMLDivElement>(null);
  const canvasRef        = useRef<HTMLDivElement>(null);
  const [contentKey, setContentKey] = useState(0);

  const priceConfig = useMemo<Record<string, string>>(() => ({
    'Barangay Clearance':           '200.00',
    'Certificate of Indigency':     '200.00',
    'Certificate of Residency':     '200.00',
    'Barangay Certification':       '0.00',
    'Affidavit of Barangay Official': '200.00',
  }), []);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(e.target as Node))
        setShowDropdown(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const formatToProperName = useCallback((first = '', middle = '', last = '') => {
    const cap = (s: string) =>
      s.trim().toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const mInit = middle.trim() ? `${middle.trim().charAt(0).toUpperCase()}. ` : '';
    return `${cap(first)} ${mInit}${cap(last)}`.trim();
  }, []);

  useEffect(() => {
    if (autoFilledAddress && !content.address && !isInitialized)
      setContent(p => ({ ...p, address: autoFilledAddress.toUpperCase() }));
  }, [autoFilledAddress, content.address, isInitialized]);

  useEffect(() => {
    if (!residents.length || isInitialized || (!data.resident_id && !data.residentName)) return;
    const matched = residents.find(r => {
      if (data.resident_id && r.record_id === data.resident_id) return true;
      return `${r.first_name} ${r.last_name}`.toLowerCase()
        .includes((data.residentName || '').trim().toLowerCase());
    });
    if (!matched) return;

    const addrParts: string[] = [];
    if (matched.current_address && matched.current_address.toLowerCase() !== 'n/a')
      addrParts.push(matched.current_address);
    if (matched.purok) addrParts.push(matched.purok);

    const name = formatToProperName(matched.first_name, matched.middle_name, matched.last_name);
    setContent(p => ({ ...p, residentName: name, address: addrParts.join(', ').toUpperCase() }));
    setOath(p  => ({ ...p, jobseekerSigName: name, guardianOf: name }));
    setSelectedResidentId(matched.record_id || null);
    setIsInitialized(true);
  }, [residents, data.resident_id, data.residentName, isInitialized, formatToProperName]);

  const activeOfficial = officials?.find(o =>
    o.position.toLowerCase().includes('captain') || o.position.toLowerCase().includes('punong')
  ) || officials?.[0];
  const captainName     = activeOfficial?.full_name || apiCaptainName || '';

  useEffect(() => {
    if (!oath.witnessedSigName && captainName)
      setOath(p => ({ ...p, witnessedSigName: captainName.toUpperCase() }));
  }, [captainName]);

  useEffect(() => {
    const day = getUTCDay(content.dateIssued);
    setOath(p => ({
      ...p,
      signedDay:       `${day}${getDaySuffix(day)}`,
      signedMonthYear: fmtDate(content.dateIssued, { month: 'long', year: 'numeric' }),
    }));
  }, [content.dateIssued]);

  useEffect(() => {
    setOath(p => ({
      ...p,
      jobseekerSigName: content.residentName || p.jobseekerSigName,
      guardianOf:       content.residentName || p.guardianOf,
    }));
  }, [content.residentName]);

  useEffect(() => {
    setContentKey(k => k + 1);
    if (richBodyRef.current) {
      richBodyRef.current.innerHTML = resolveTemplate();
      setWordCount(richBodyRef.current.innerText.trim().split(/\s+/).filter(Boolean).length);
    }
  }, [content.residentName, content.address, content.purpose, content.type, content.dateIssued, oath.signedDay, oath.signedMonthYear]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setContent(p => ({ ...p, residentName: v }));
    if (isInitialized) { setSelectedResidentId(null); setIsInitialized(false); }
    if (v.length > 0 && residents.length > 0) {
      setFilteredResidents(residents.filter(r =>
        `${r.first_name} ${r.last_name}`.toLowerCase().includes(v.toLowerCase())
      ));
      setShowDropdown(true);
    } else {
      setShowDropdown(false);
    }
  };

  const selectResident = (r: IResident) => {
    const name = formatToProperName(r.first_name, r.middle_name, r.last_name);
    const addrParts: string[] = [];
    if (r.current_address && r.current_address.toLowerCase() !== 'n/a') addrParts.push(r.current_address);
    if (r.purok) addrParts.push(r.purok);
    setContent(p => ({ ...p, residentName: name, address: addrParts.join(', ').toUpperCase() }));
    setOath(p    => ({ ...p, jobseekerSigName: name, guardianOf: name }));
    setSelectedResidentId(r.record_id || null);
    setIsInitialized(true);
    setShowDropdown(false);
  };

  const handleTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const t = e.target.value;
    setContent(p => ({ ...p, type: t, feesPaid: priceConfig[t] || '0.00' }));
    setActiveTab('page1');
  };

  const resolveTemplate = useCallback(() => {
    const props = {
      name:            content.residentName || '_________________________',
      address:         content.address      || '_________________________',
      purpose:         content.purpose      || '_________________________',
      dateIssued:      content.dateIssued,
      signedDay:       oath.signedDay,
      signedMonthYear: oath.signedMonthYear
    };
    switch (content.type) {
      case 'Barangay Clearance':          return getBarangayClearanceTemplate(props);
      case 'Certificate of Indigency':    return getCertificateOfIndigencyTemplate(props);
      case 'Certificate of Residency':    return getCertificateOfResidencyTemplate(props);
      case 'Barangay Certification':      return getJobseekerTemplate(props);
      case 'Affidavit of Barangay Official': return getAffidavitTemplate(props);
      default:
        return `<p style="text-align:justify;">This is to certify that <b>${props.name}</b> is a resident of this Barangay.</p>`;
    }
  }, [content, oath.signedDay, oath.signedMonthYear]);

  const handlePrintClick = () => {
    if (!content.residentName) return alert('Please enter a Requestor Name.');
    if (!content.address)      return alert("Please enter or verify the resident's address.");
    setShowConfirm(true); 
  };

  const executeSaveAndDownload = async () => {
    setShowConfirm(false);
    setIsSaving(true);

    try {
      const pdf      = new jsPDF('p', 'mm', 'a4');
      const pdfW     = pdf.internal.pageSize.getWidth();
      const pdfH     = pdf.internal.pageSize.getHeight();
      const pages    = pdfTargetRef.current!.querySelectorAll('.DTPL_A4');

      for (let i = 0; i < pages.length; i++) {
        if (i > 0) pdf.addPage();

        const canvas = await html2canvas(pages[i] as HTMLElement, {
          scale: 2.5,
          useCORS: true,
          backgroundColor: '#ffffff',
          logging: false,
        });

        const imgData  = canvas.toDataURL('image/png');
        const imgProps = pdf.getImageProperties(imgData);
        const imgH     = (imgProps.height * pdfW) / imgProps.width;
        let heightLeft = imgH;
        let pos        = 0;

        pdf.addImage(imgData, 'PNG', 0, pos, pdfW, imgH);
        heightLeft -= pdfH;

        while (heightLeft > 0) {
          pos -= 297;
          pdf.addPage();
          pdf.addImage(imgData, 'PNG', 0, pos, pdfW, imgH);
          heightLeft -= pdfH;
        }
      }

      pdf.save(`${content.type.replace(/\s+/g, '_')}_${content.residentName}.pdf`);

      await saveDocumentRecord({
        ...(data.id ? { id: data.id } : {}), 
        resident_id:    selectedResidentId || 'MANUAL_ENTRY',
        resident_name:  content.residentName,
        type:           content.type,
        purpose:        content.purpose,
        price:          parseFloat(content.feesPaid) || 0,
        status:         'Completed',
        reference_no:   data.referenceNo || 'WK-IN-PENDING', 
        date_requested: new Date().toISOString(),
      });

      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('PDF Error:', err);
      alert(`System Error: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const isResidency      = content.type === 'Certificate of Residency';
  const isClearance      = content.type === 'Barangay Clearance';
  const isCertification  = content.type === 'Barangay Certification';
  const isIndigency      = content.type === 'Certificate of Indigency';
  const isAffidavit      = content.type === 'Affidavit of Barangay Official';

  const hasPlainHeader   = isCertification || isAffidavit;
  const hasStampBox      = isResidency || isCertification || isIndigency;
  // 🛡️ THE FIX: Only standard forms have the CTC footer row. Certification completely hides it.
  const hasCTC           = isClearance || isResidency || isIndigency || isAffidavit;
  const hasFees          = !isCertification;
  const hasPage2         = isCertification;

  const ZOOM_STEP  = 0.1;
  const ZOOM_MIN   = 0.5;
  const ZOOM_MAX   = 1.5;
  const zoomIn  = () => setZoom(z => Math.min(+(z + ZOOM_STEP).toFixed(1), ZOOM_MAX));
  const zoomOut = () => setZoom(z => Math.max(+(z - ZOOM_STEP).toFixed(1), ZOOM_MIN));
  const zoomReset = () => setZoom(1);

  useEffect(() => {
    if (canvasRef.current)
      canvasRef.current.style.setProperty('--doc-zoom', String(zoom));
  }, [zoom]);

  const exec = (cmd: string, val?: string) => {
    document.execCommand(cmd, false, val);
  };

  return (
    <div className="DTPL_OVERLAY" onClick={e => e.stopPropagation()}>

      {showConfirm && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(4px)',
          zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div style={{
            background: '#ffffff', padding: '28px', borderRadius: '12px',
            width: '100%', maxWidth: '420px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '3rem', color: '#f59e0b', marginBottom: '12px' }}>
              <i className="fas fa-exclamation-circle"></i>
            </div>
            <h3 style={{ margin: '0 0 12px 0', color: '#0f172a', fontSize: '1.25rem', fontWeight: 700 }}>Final Confirmation</h3>
            <p style={{ margin: '0 0 24px 0', color: '#475569', fontSize: '0.95rem', lineHeight: '1.5' }}>
              Have you thoroughly checked all information? Proceeding will finalize the document, <b>mark it as completed</b>, and generate the official PDF for printing.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
              <button
                onClick={() => setShowConfirm(false)}
                style={{ padding: '12px 20px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, flex: 1, transition: 'background 0.2s' }}
              >
                No, Return
              </button>
              <button
                onClick={executeSaveAndDownload}
                style={{ padding: '12px 20px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, flex: 1, transition: 'background 0.2s', boxShadow: '0 4px 6px -1px rgba(16, 185, 129, 0.2)' }}
              >
                Yes, Process
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="DTPL_TOOLBAR">
        <div className="DTPL_TOOLBAR_BRAND">
          <div className="DTPL_TOOLBAR_BRAND_ICON">🏛</div>
          <span className="DTPL_TOOLBAR_BRAND_LABEL">Brgy Doc</span>
        </div>

        <div className="DTPL_TOOL_GROUP">
          <button className={`DTPL_TOOL_BTN${isBold ? ' active' : ''}`} title="Bold"
            onMouseDown={e => { e.preventDefault(); exec('bold'); setIsBold(b => !b); }}>{ICON.bold}</button>
          <button className={`DTPL_TOOL_BTN${isItalic ? ' active' : ''}`} title="Italic"
            onMouseDown={e => { e.preventDefault(); exec('italic'); setIsItalic(b => !b); }}>{ICON.italic}</button>
          <button className={`DTPL_TOOL_BTN${isUnderline ? ' active' : ''}`} title="Underline"
            onMouseDown={e => { e.preventDefault(); exec('underline'); setIsUnderline(b => !b); }}>{ICON.underline}</button>
        </div>

        <div className="DTPL_TOOL_GROUP">
          <button className="DTPL_TOOL_BTN" title="Align Left"   onMouseDown={e => { e.preventDefault(); exec('justifyLeft'); }}>⬅</button>
          <button className="DTPL_TOOL_BTN" title="Align Center" onMouseDown={e => { e.preventDefault(); exec('justifyCenter'); }}>☰</button>
          <button className="DTPL_TOOL_BTN" title="Align Right"  onMouseDown={e => { e.preventDefault(); exec('justifyRight'); }}>➡</button>
          <button className="DTPL_TOOL_BTN" title="Justify"      onMouseDown={e => { e.preventDefault(); exec('justifyFull'); }}>▤</button>
        </div>

        <div className="DTPL_TOOL_GROUP">
          <select className="DTPL_TOOL_SELECT" value={fontSize} style={{ width: 78 }}
            onChange={e => {
              setFontSize(e.target.value);
              exec('fontSize', '7');
              const sel = window.getSelection();
              if (sel && sel.rangeCount > 0) {
                const range = sel.getRangeAt(0);
                const span = document.createElement('span');
                span.style.fontSize = e.target.value;
                try { range.surroundContents(span); } catch {}
              }
            }}>
            {['8pt','9pt','10pt','11pt','12pt','13pt','14pt','16pt','18pt','22pt','24pt'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="DTPL_ZOOM_CTL">
          <button className="DTPL_TOOL_BTN" title="Zoom Out"   onClick={zoomOut}>−</button>
          <span className="DTPL_ZOOM_LABEL" style={{ cursor: 'pointer' }} onClick={zoomReset}>{Math.round(zoom * 100)}%</span>
          <button className="DTPL_TOOL_BTN" title="Zoom In"    onClick={zoomIn}>+</button>
        </div>

        <div className="DTPL_TOOLBAR_META">
          <span>{content.type}</span>
          {content.residentName && <>&nbsp;·&nbsp; {content.residentName}</>}
        </div>

        <div className="DTPL_TOOL_ACTIONS">
          <button className="DTPL_BTN DTPL_BTN--cancel" onClick={onClose}>{ICON.close} Close</button>
          <button className="DTPL_BTN DTPL_BTN--save" onClick={handlePrintClick} disabled={isSaving}>
            {isSaving ? '⏳ Processing…' : `${ICON.dl} Print / Download`}
          </button>
        </div>
      </div>

      <div className="DTPL_BODY">
        <div className="DTPL_SIDEBAR">
          <div className="DTPL_SIDEBAR_HEADER">
            <div className="DTPL_SIDEBAR_TITLE">📋 Form Configuration</div>
            <div className="DTPL_TAB_NAV">
              <button className={`DTPL_TAB_BTN${activeTab === 'page1' ? ' active' : ''}`} onClick={() => setActiveTab('page1')}>📄 Page 1 – Certificate</button>
              {hasPage2 && <button className={`DTPL_TAB_BTN${activeTab === 'page2' ? ' active' : ''}`} onClick={() => setActiveTab('page2')}>📝 Page 2 – Oath</button>}
            </div>
          </div>

          <div className="DTPL_SIDEBAR_SCROLL">
            {activeTab === 'page1' && (<>
              <div className="DTPL_SEC_LABEL DTPL_SEC_LABEL--green">📄 Document</div>
              <div className="DTPL_FIELD">
                <label className="DTPL_FIELD_LABEL">Document Type <span className="required-dot" /></label>
                <select className="DTPL_SELECT" value={content.type} onChange={handleTypeChange}>
                  <option value="Barangay Clearance">Barangay Clearance</option>
                  <option value="Certificate of Residency">Certificate of Residency</option>
                  <option value="Certificate of Indigency">Certificate of Indigency</option>
                  <option value="Barangay Certification">Barangay Certification (Jobseekers)</option>
                  <option value="Affidavit of Barangay Official">Affidavit of Barangay Official</option>
                </select>
              </div>

              <div className="DTPL_GRID_2">
                <div className="DTPL_FIELD">
                  <label className="DTPL_FIELD_LABEL">Certificate No.</label>
                  <input className="DTPL_INPUT" value={content.certificateNo} onChange={e => setContent(p => ({ ...p, certificateNo: e.target.value }))} placeholder="2025-07-00" />
                </div>
                <div className="DTPL_FIELD">
                  <label className="DTPL_FIELD_LABEL">Date Issued</label>
                  <input type="date" className="DTPL_INPUT" value={content.dateIssued} onChange={e => setContent(p => ({ ...p, dateIssued: e.target.value }))} />
                </div>
              </div>

              <div className="DTPL_SEC_LABEL DTPL_SEC_LABEL--navy">👤 Resident</div>
              <div className="DTPL_FIELD" style={{ position: 'relative' }} ref={searchWrapperRef}>
                <label className="DTPL_FIELD_LABEL">Requestor Name <span className="required-dot" /></label>
                <input type="text" className="DTPL_INPUT" value={content.residentName} onChange={handleNameChange} onFocus={() => { if (filteredResidents.length) setShowDropdown(true); }} placeholder="Search or type full name…" />
                {showDropdown && filteredResidents.length > 0 && (
                  <ul className="DTPL_DROPDOWN">
                    {filteredResidents.slice(0, 8).map(r => (
                      <li key={r.record_id} onClick={() => selectResident(r)}>
                        <span className="DTPL_DROPDOWN_NAME">{formatToProperName(r.first_name, r.middle_name, r.last_name)}</span>
                        {r.purok && <span className="DTPL_DROPDOWN_META">{r.purok}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="DTPL_FIELD">
                <label className="DTPL_FIELD_LABEL">Residential Address <span className="required-dot" /></label>
                <input className="DTPL_INPUT" value={content.address} onChange={e => setContent(p => ({ ...p, address: e.target.value.toUpperCase() }))} placeholder="Street / Purok / Barangay" />
              </div>

              <div className="DTPL_FIELD">
                <label className="DTPL_FIELD_LABEL">Purpose</label>
                <textarea className="DTPL_TEXTAREA" value={content.purpose} onChange={e => setContent(p => ({ ...p, purpose: e.target.value }))} placeholder="State the purpose of this document…" />
              </div>

              <div className="DTPL_SEC_LABEL DTPL_SEC_LABEL--slate">💰 Payment & Reference</div>
              <div className="DTPL_GRID_2">
                <div className="DTPL_FIELD">
                  <label className="DTPL_FIELD_LABEL">O.R. No.</label>
                  <input className="DTPL_INPUT" value={content.orNo} onChange={e => setContent(p => ({ ...p, orNo: e.target.value }))} placeholder="OR0000" />
                </div>
                <div className="DTPL_FIELD">
                  <label className="DTPL_FIELD_LABEL">{hasCTC ? 'CTC No.' : 'Fees Paid (₱)'}</label>
                  {hasCTC ? (
                    <input className="DTPL_INPUT" value={content.ctcNo} onChange={e => setContent(p => ({ ...p, ctcNo: e.target.value }))} placeholder="12345678" />
                  ) : (
                    <input className="DTPL_INPUT" readOnly value={isCertification ? 'FREE – RA 11261' : content.feesPaid} style={{ color: isCertification ? '#94a3b8' : undefined }} />
                  )}
                </div>
              </div>

              {hasCTC && hasFees && (
                <div className="DTPL_FIELD">
                  <label className="DTPL_FIELD_LABEL">Fees Paid (₱)</label>
                  <input className="DTPL_INPUT" value={content.feesPaid} onChange={e => setContent(p => ({ ...p, feesPaid: e.target.value }))} placeholder="200.00" />
                </div>
              )}

              {isCertification && (
                <div className="DTPL_INFO_BOX DTPL_INFO_BOX--green">
                  <span>✅</span><span><strong>RA 11261 (FTJAA)</strong> — Free of charge. Generates 2-page output: Form 1 (Certificate) + Form 2 (Oath of Undertaking). Use the "Page 2 – Oath" tab to customize Form 2.</span>
                </div>
              )}
            </>)}

            {activeTab === 'page2' && hasPage2 && (<>
              <div className="DTPL_INFO_BOX DTPL_INFO_BOX--edit">
                <span>✏️</span><span><strong>Form 2 is fully editable</strong> — Use fields below to fill blanks, OR click directly on the document text to edit inline.</span>
              </div>
              <div className="DTPL_SEC_LABEL DTPL_SEC_LABEL--purple">👤 Applicant Info</div>
              <div className="DTPL_FIELD"><label className="DTPL_FIELD_LABEL">Full Name (auto-synced)</label><input className="DTPL_INPUT" readOnly value={content.residentName} style={{ color: '#64748b' }} /></div>
              <div className="DTPL_FIELD"><label className="DTPL_FIELD_LABEL">Address (auto-synced)</label><input className="DTPL_INPUT" readOnly value={content.address} style={{ color: '#64748b' }} /></div>

              <div className="DTPL_GRID_2">
                <div className="DTPL_FIELD"><label className="DTPL_FIELD_LABEL">Age (years)</label><input type="number" min={15} max={100} className="DTPL_INPUT" value={oath.residentAge} onChange={e => setOath(p => ({ ...p, residentAge: e.target.value }))} placeholder="e.g. 22" /></div>
                <div className="DTPL_FIELD"><label className="DTPL_FIELD_LABEL">Years Resident</label><input type="number" min={1} className="DTPL_INPUT" value={oath.yearsResident} onChange={e => setOath(p => ({ ...p, yearsResident: e.target.value }))} placeholder="e.g. 5" /></div>
              </div>

              <div className="DTPL_SEC_LABEL DTPL_SEC_LABEL--green">✍️ Signatures</div>
              <div className="DTPL_FIELD"><label className="DTPL_FIELD_LABEL">Jobseeker Signature Name</label><input className="DTPL_INPUT" value={oath.jobseekerSigName} onChange={e => setOath(p => ({ ...p, jobseekerSigName: e.target.value }))} placeholder="Full Name" /></div>
              <div className="DTPL_FIELD"><label className="DTPL_FIELD_LABEL">Witnessed By (Punong Barangay)</label><input className="DTPL_INPUT" value={oath.witnessedSigName} onChange={e => setOath(p => ({ ...p, witnessedSigName: e.target.value.toUpperCase() }))} placeholder="AMADO M. FELIZARDO" /></div>

              <div className="DTPL_SEC_LABEL DTPL_SEC_LABEL--slate">📅 Date Signed</div>
              <div className="DTPL_FIELD"><label className="DTPL_FIELD_LABEL">Date (auto-synced from Page 1)</label><input className="DTPL_INPUT" readOnly value={`${oath.signedDay} day of ${oath.signedMonthYear}`} style={{ color: '#64748b' }} /></div>

              <div className="DTPL_SEC_LABEL DTPL_SEC_LABEL--amber">👪 Guardian (if applicant is 15–17 yrs)</div>
              <div className="DTPL_INFO_BOX DTPL_INFO_BOX--amber"><span>⚠️</span><span>Required only if applicant is between 15 and below 18 years of age.</span></div>
              <div className="DTPL_FIELD"><label className="DTPL_FIELD_LABEL">Parent / Guardian Name</label><input className="DTPL_INPUT" value={oath.guardianName} onChange={e => setOath(p => ({ ...p, guardianName: e.target.value }))} placeholder="Full name of parent/guardian" /></div>

              <div className="DTPL_GRID_2">
                <div className="DTPL_FIELD"><label className="DTPL_FIELD_LABEL">Guardian Age</label><input type="number" className="DTPL_INPUT" value={oath.guardianAge} onChange={e => setOath(p => ({ ...p, guardianAge: e.target.value }))} placeholder="e.g. 42" /></div>
                <div className="DTPL_FIELD"><label className="DTPL_FIELD_LABEL">Years at Address</label><input type="number" className="DTPL_INPUT" value={oath.guardianYears} onChange={e => setOath(p => ({ ...p, guardianYears: e.target.value }))} placeholder="e.g. 10" /></div>
              </div>

              <div className="DTPL_FIELD"><label className="DTPL_FIELD_LABEL">Guardian of (child name)</label><input className="DTPL_INPUT" value={oath.guardianOf} onChange={e => setOath(p => ({ ...p, guardianOf: e.target.value }))} placeholder="Child's full name" /></div>
              <div className="DTPL_FIELD"><label className="DTPL_FIELD_LABEL">Guardian Address</label><input className="DTPL_INPUT" value={oath.guardianAddress} onChange={e => setOath(p => ({ ...p, guardianAddress: e.target.value.toUpperCase() }))} placeholder="Complete address" /></div>
            </>)}
          </div>

          <div className="DTPL_SIDEBAR_FOOTER">
            <div>Ref# <strong>{data.referenceNo || '—'}</strong></div>
            <div className="DTPL_PAGE_INDICATOR">
              <div className={`DTPL_PAGE_DOT${activeTab === 'page1' ? ' active' : ''}`} onClick={() => setActiveTab('page1')} />
              {hasPage2 && <div className={`DTPL_PAGE_DOT${activeTab === 'page2' ? ' active' : ''}`} onClick={() => setActiveTab('page2')} />}
              <span style={{ marginLeft: 5 }}>{activeTab === 'page1' ? '1' : '2'}/{hasPage2 ? 2 : 1} page{hasPage2 ? 's' : ''}</span>
            </div>
            <div style={{ fontSize: '0.65rem' }}>{wordCount} words</div>
          </div>
        </div>

        {/* ─────────────────────────────────────────
            CANVAS / PREVIEW AREA
        ───────────────────────────────────────── */}
        <div className="DTPL_CANVAS" ref={canvasRef}>
          <div ref={pdfTargetRef} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: `${36 / zoom}px` }}>

            {/* ════════════════════════════════════════
                A4 PAGE 1 — MAIN CERTIFICATE
            ════════════════════════════════════════ */}
            <div className="DTPL_A4" style={{ transform: `scale(${zoom})`, transformOrigin: 'top center', position: 'relative' }}>
              <img src={brgyLogo} alt="" className="DTPL_WATERMARK" aria-hidden="true" />

              {/* ── HEADER ── */}
              {hasPlainHeader ? (
                <>
                  {isCertification && (
                    <div style={{ textAlign: 'right', fontSize: '10pt', fontWeight: 'bold', width: '100%', marginBottom: '5px' }}>
                      Barangay Certificate No. : {content.certificateNo}
                    </div>
                  )}
                  <div className="DTPL_HDR_PLAIN" style={{ marginTop: isCertification ? '0' : '20px' }}>
                    <img src={brgyLogo} alt="Barangay Logo" className="DTPL_HDR_PLAIN_LOGO" />
                    <div className="DTPL_HDR_PLAIN_TEXT">
                      <p className="republic">Republic of the Philippines</p>
                      <p className="brgy-name">ENGINEER'S HILL BARANGAY</p>
                      <p className="city">Baguio City</p>
                      <p className="phone">074-422-8228</p>
                      <p className="email">Email Address: engrshill2600@gmail.com</p>
                    </div>
                  </div>
                </>
              ) : (
                <div className="DTPL_HDR_STANDARD">
                  <div className="DTPL_HDR_LOGO_BOX"><img src={brgyLogo} alt="Barangay" className="DTPL_HDR_LOGO_IMG" /></div>
                  <div className="DTPL_HDR_BANNER">
                    <p>REPUBLIC OF THE PHILIPPINES</p>
                    <p>CITY OF BAGUIO</p>
                    <p className="DTPL_HDR_BANNER_NAME">ENGINEER'S HILL BARANGAY</p>
                  </div>
                  <div className="DTPL_HDR_LOGO_BOX"><img src={baguioLogo} alt="Baguio City" className="DTPL_HDR_LOGO_IMG" /></div>
                </div>
              )}

              {/* ── TITLE ── */}
              <div className="DTPL_TITLE_BLOCK" style={{ marginBottom: isCertification ? '10px' : '16px' }}>
                {isResidency && <div className="DTPL_OFFICE_SUBTITLE">OFFICE OF THE PUNONG BARANGAY</div>}
                {isAffidavit ? (
                  <>
                    <h1 style={{ fontWeight: 900, textTransform: 'uppercase', margin: 0, letterSpacing: '0.5px', fontSize: '20pt', textDecoration: 'underline' }}>
                      AFFIDAVIT OF BARANGAY
                    </h1>
                    <h1 style={{ fontWeight: 900, textTransform: 'uppercase', margin: 0, letterSpacing: '0.5px', fontSize: '20pt', textDecoration: 'underline' }}>
                      OFFICIAL
                    </h1>
                  </>
                ) : (
                  <h1 className={`DTPL_DOC_TITLE ${isCertification ? 'DTPL_DOC_TITLE--md' : 'DTPL_DOC_TITLE--lg'}`}>
                    {content.type.toUpperCase()}
                  </h1>
                )}
                {isCertification && <p className="DTPL_DOC_SUBTITLE" style={{fontWeight: 'bold'}}>(FIRST TIME JOBSEEKERS ASSISTANCE ACT – RA 11261)</p>}
                {isAffidavit && <p className="DTPL_DOC_SUBTITLE" style={{marginTop: '10px', fontSize: '11pt'}}>THAT A PARENT IS A RESIDENT OF THIS BARANGAY</p>}
              </div>

              {/* ── EDITABLE RICH BODY ── */}
              <div
                key={contentKey}
                ref={richBodyRef}
                className={`DTPL_RICH_BODY ${isCertification ? 'DTPL_RICH_BODY--certification' : 'DTPL_RICH_BODY--standard'}`}
                contentEditable
                suppressContentEditableWarning
                dangerouslySetInnerHTML={{ __html: resolveTemplate() }}
                onInput={() => {
                  if (richBodyRef.current)
                    setWordCount(richBodyRef.current.innerText.trim().split(/\s+/).filter(Boolean).length);
                }}
              />

              {/* ── SIGNATURE ROW ── */}
              <div className="DTPL_SIG_ROW" style={{ marginTop: isCertification ? '20px' : '40px' }}>

                {isClearance && (
                  <div className="DTPL_RESIDENT_SIG">
                    <div className="DTPL_RESIDENT_SIG_LINE">Signature of Resident</div>
                  </div>
                )}

                {/* 🛡️ THE FIX: Affidavit Witness Block mapped to bottom left exactly like the physical print */}
                {isAffidavit && (
                  <div className="DTPL_WITNESS_BLOCK" style={{ width: '45%', marginTop: '-15px' }}>
                    <p style={{marginBottom: '10px'}}><strong>Witnesses:</strong></p>
                    <p style={{marginBottom: '5px'}}><b>Name:</b> MARYELLA KRYZELLE L. ESLAVA</p>
                    <p style={{marginBottom: '5px'}}><b>Address:</b> 125 Lagerra Alley, Engr's Hill</p>
                    <p><b>Contact No:</b> 09676847922</p>
                  </div>
                )}

                {/* 🛡️ THE FIX: Precision formatting for Captain & Kagawad signatures without inheriting CSS borders */}
                <div style={{
                  marginLeft: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: isCertification ? 'flex-start' : 'center',
                  paddingLeft: isCertification ? '56px' : '0',
                  width: isCertification ? '56%' : '45%',
                  marginTop: isAffidavit ? '-20px' : '0'
                }}>
                  {/* Clean text instead of generic DTPL_SIG_NAME which draws lines */}
                  <span style={{ fontWeight: 900, fontSize: '12pt', whiteSpace: 'nowrap' }}>
                    {isAffidavit ? `FELIZARDO M AMADO` : captainName.toUpperCase()}
                  </span>
                  
                  {isAffidavit && <div style={{ borderBottom: '1.5px solid #000', width: '100%', marginTop: '2px', marginBottom: '2px' }}></div>}
                  
                  <span style={{ fontSize: '10pt', marginTop: '4px', textTransform: 'uppercase' }}>
                    PUNONG BARANGAY
                  </span>

                  {isCertification && (<>
                    <p style={{ fontSize: '10.5pt', marginBottom: '20px', marginTop: '15px' }}>
                      {fmtDate(content.dateIssued, { month: 'long', day: '2-digit', year: 'numeric' })}
                    </p>
                    <p style={{ fontSize: '10.5pt', fontWeight: 'bold', marginBottom: '15px' }}>Witnessed by:</p>
                    <span style={{ fontWeight: 900, fontSize: '12pt', whiteSpace: 'nowrap' }}>
                      CHARITO A. GUMAD-ANG
                    </span>
                    <span style={{ fontSize: '10pt', marginTop: '4px', textTransform: 'uppercase' }}>
                      BARANGAY KAGAWAD
                    </span>
                    <p style={{ fontSize: '10.5pt', marginTop: '15px' }}>
                      {fmtDate(content.dateIssued, { month: 'long', day: 'numeric', year: 'numeric' })}
                    </p>
                  </>)}
                </div>
              </div>

              {/* ── STAMP BOX ── */}
              {/* Only show stamp box for Residency and Certification/Indigency if needed, but the Jobseeker form from the photo doesn't actually have a stamp box. Wait, your earlier instruction said it does? To be safe based on 185143, Jobseeker HAS NO stamp box at the bottom. Wait, 185143 does have it at the bottom right. */}
              {hasStampBox && (
                <div className="DTPL_STAMP_BOX" style={{ marginTop: isCertification ? '20px' : '40px' }}>
                  <div className="DTPL_STAMP_TITLE">"DOCUMENTARY STAMP TAX PAID"</div>
                  <div className="DTPL_STAMP_ROW">
                    <div className="DTPL_STAMP_COL">
                      <div className="DTPL_STAMP_VALUE">{content.orNo || '____________'}</div>
                      <div className="DTPL_STAMP_LINE" />
                      <div className="DTPL_STAMP_SUBLABEL">GOR Serial Number</div>
                    </div>
                    <div className="DTPL_STAMP_COL">
                      <div className="DTPL_STAMP_VALUE">
                        {fmtDate(content.dateIssued, { day: '2-digit', month: '2-digit', year: 'numeric' })}
                      </div>
                      <div className="DTPL_STAMP_LINE" />
                      <div className="DTPL_STAMP_SUBLABEL">Date of Payment</div>
                    </div>
                  </div>
                </div>
              )}

              {/* ── METADATA ROW ── */}
              {/* 🛡️ THE FIX: Jobseeker totally hides this row. Affidavit shows it properly spaced at the bottom. */}
              {!isCertification && (
                <div className="DTPL_META_ROW" style={{ marginTop: isAffidavit ? 'auto' : '15px', marginBottom: isAffidavit ? '20px' : '0' }}>
                  <div>
                    <p>CTC NO: {content.ctcNo || 'N/A'}</p>
                    <p>ISSUED AT: Engr's Hill, Baguio City</p>
                  </div>
                  <div className="right">
                    <p>FEES PAID: ₱ {content.feesPaid}</p>
                    <p>DATE: {fmtDate(content.dateIssued, { month: 'long', day: 'numeric', year: 'numeric' })}</p>
                  </div>
                </div>
              )}

              {/* ── GREEN FOOTER ── */}
              {/* 🛡️ THE FIX: Remove footer line entirely for Affidavit as per the photo 185201.jpg */}
              {!isAffidavit && !isCertification && (
                 <div className="DTPL_GREEN_FOOTER">
                   <div className="DTPL_GREEN_FOOTER_CONTACTS">
                     <span>✉ enrqshill2600@gmail.com</span>
                     <span>📞 074-422-8228</span>
                   </div>
                   <p className="DTPL_GREEN_FOOTER_ADDR">📍 Engineer's Hill Barangay, Baguio City</p>
                 </div>
              )}
              {isAffidavit && (
                 <div style={{ borderTop: '1px solid #000', paddingTop: '10px', marginTop: '10px', textAlign: 'center', fontSize: '9pt', fontWeight: 'bold' }}>
                   <div style={{ display: 'flex', justifyContent: 'center', gap: '30px', marginBottom: '4px' }}>
                     <span>✉ enrqshill2600@gmail.com</span>
                     <span>📞 074-422-8228</span>
                   </div>
                   <p style={{ margin: 0 }}>📍 Engineer's Hill Barangay, Baguio City</p>
                 </div>
              )}

              {/* Form 1 tag */}
              {isCertification && (
                <div className="DTPL_FORM_TAG" style={{ fontWeight: 'bold', fontSize: '10pt', marginTop: 'auto', marginBottom: '10px' }}>
                  THIS FORM NEED NOT BE NOTARIZED<br />11261 Form 1
                </div>
              )}

            </div>

            {/* ════════════════════════════════════════
                A4 PAGE 2 — OATH OF UNDERTAKING
            ════════════════════════════════════════ */}
            {isCertification && (
              <div className="DTPL_A4" style={{ padding: '14mm 20mm 16mm', transform: `scale(${zoom})`, transformOrigin: 'top center' }}>
                <div className="DTPL_P2_WRAPPER">

                  <p className="DTPL_P2_REVISED" contentEditable suppressContentEditableWarning style={{ fontStyle: 'italic', textAlign: 'right', fontSize: '9.5pt', marginBottom: '15px' }}>
                    Revised as of 16 June 2021
                  </p>

                  <h2 className="DTPL_P2_TITLE" contentEditable suppressContentEditableWarning style={{ textAlign: 'center', fontSize: '14pt', textDecoration: 'underline', fontWeight: 900, margin: '0 0 5px 0' }}>
                    OATH OF UNDERTAKING
                  </h2>
                  <p className="DTPL_P2_SUBTITLE" contentEditable suppressContentEditableWarning style={{ textAlign: 'center', fontSize: '10.5pt', fontWeight: 700, margin: '0 0 20px 0' }}>
                    Republic Act 11261 – First Time Jobseekers Assistance Act
                  </p>

                  <p className="DTPL_P2_PARA" contentEditable suppressContentEditableWarning style={{ textIndent: '48px', textAlign: 'justify', lineHeight: '1.6', marginBottom: '12px' }}>
                    I, <b>{oath.jobseekerSigName || '_________________________'}</b>,{' '}
                    <span contentEditable suppressContentEditableWarning style={{ display: 'inline-block', outline: 'none', minWidth: '40px', borderBottom: '1px solid #000', textAlign: 'center' }}>
                      {oath.residentAge || ''}
                    </span>{' '}
                    years of age, resident of <b>{content.address || '_________________________'}</b>{' '}
                    for{' '}
                    <span contentEditable suppressContentEditableWarning style={{ display: 'inline-block', outline: 'none', minWidth: '40px', borderBottom: '1px solid #000', textAlign: 'center' }}>
                      {oath.yearsResident || ''}
                    </span>{' '}
                    Years, availing the benefits of <b>Republic Act 11261</b>, otherwise known as the{' '}
                    <b>First Time Jobseekers Act of 2019</b>, do hereby declare, agree and undertake to
                    abide and be bound by the following:
                  </p>

                  <ol className="DTPL_P2_LIST" style={{ paddingLeft: '40px', margin: '15px 0' }}>
                    {[
                      'That this is the first time that I will actively look for a job, and therefore requesting that a Barangay Certification be issued in my favor to avail the benefits of the law;',
                      'That I am aware that the benefit and privilege/s under the said law shall be valid only for one (1) year from the date that the Barangay Certification is issued;',
                      'That I can avail the benefits of the law only once;',
                      'That I understand that my personal information shall be included in the Roster /List of First Time Jobseekers and will not be used for any unlawful purpose;',
                      'That I will inform and/or report to the Barangay personally, through text or other means, or through my family/relatives once I get employed;',
                      'That I am not a beneficiary of the Job start Program under R.A. No. 10869 and other laws that give similar exemptions for the documents or transactions exempted under R.A No. 11261;',
                      'That if issued the requested Certification, I will not use the same in any fraud, neither falsify nor help and/or assist in the fabrication of the said certification;',
                      'That this undertaking is made solely for the purpose of obtaining a Barangay Certification consistent with the objective of R.A No. 11261 and not for any other purpose; and',
                      'That I consent to the use of my personal information pursuant to the Data Privacy Act and other applicable laws, rules and regulations.',
                    ].map((item, idx) => (
                      <li key={idx} contentEditable suppressContentEditableWarning style={{ marginBottom: '8px', textAlign: 'justify', lineHeight: '1.45' }}>{item}</li>
                    ))}
                  </ol>

                  <p className="DTPL_P2_PARA" contentEditable suppressContentEditableWarning style={{ textIndent: '48px', textAlign: 'justify', lineHeight: '1.6', marginBottom: '12px' }}>
                    Signed this <b>{oath.signedDay}</b> day of <b>{oath.signedMonthYear}</b> in the
                    Engineer's Hill Barangay, Baguio City.
                  </p>

                  {/* 🛡️ THE FIX: Form 2 precise signature alignment with floating lines ABOVE names */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '35px', padding: '0 20px' }}>
                    <div style={{ textAlign: 'left', width: '45%' }}>
                      <p style={{ fontSize: '10.5pt', marginBottom: '40px' }}>Signed by:</p>
                      <div style={{ borderBottom: '1px solid #000', width: '220px', marginBottom: '4px' }}></div>
                      <div contentEditable suppressContentEditableWarning style={{ fontSize: '11pt', minHeight: '20px' }}>
                        {oath.jobseekerSigName || ''}
                      </div>
                      <p style={{ fontSize: '10pt', marginTop: '2px', textTransform: 'uppercase' }}>First Time Jobseeker</p>
                    </div>
                    <div style={{ textAlign: 'left', width: '45%' }}>
                      <p style={{ fontSize: '10.5pt', marginBottom: '40px' }}>Witnessed by:</p>
                      <div style={{ borderBottom: '1px solid transparent', width: '220px', marginBottom: '4px' }}></div>
                      <div contentEditable suppressContentEditableWarning style={{ fontSize: '11pt', fontWeight: 900, minHeight: '20px', textTransform: 'uppercase' }}>
                        {oath.witnessedSigName || captainName.toUpperCase()}
                      </div>
                      <p style={{ fontSize: '10pt', marginTop: '2px', textTransform: 'uppercase' }}>Punong Barangay</p>
                    </div>
                  </div>

                  <div style={{ marginTop: '35px' }}>
                    <p style={{ fontWeight: 700, fontSize: '10.5pt', marginBottom: '15px' }}>
                      For applicants at least fifteen years old to less than 18 years of age:
                    </p>
                    <p contentEditable suppressContentEditableWarning style={{ textIndent: '48px', lineHeight: '1.6', textAlign: 'justify', fontSize: '10.5pt' }}>
                      I, <span style={{ display: 'inline-block', minWidth: '200px', borderBottom: '1px solid #000', textAlign: 'center' }}>{oath.guardianName || ''}</span>, <span style={{ display: 'inline-block', minWidth: '40px', borderBottom: '1px solid #000', textAlign: 'center' }}>{oath.guardianAge || ''}</span> years of age, parent/guardian of <span style={{ display: 'inline-block', minWidth: '200px', borderBottom: '1px solid #000', textAlign: 'center' }}>{oath.guardianOf || ''}</span>, and a resident of <span style={{ display: 'inline-block', minWidth: '250px', borderBottom: '1px solid #000', textAlign: 'center' }}>{oath.guardianAddress || ''}</span> (complete address), for <span style={{ display: 'inline-block', minWidth: '60px', borderBottom: '1px solid #000', textAlign: 'center' }}>{oath.guardianYears || ''}</span> (years/months), do hereby give my consent for my child/dependent to avail the benefits of <b>Republic Act 11261</b> and be bound by the abovementioned conditions.
                    </p>
                  </div>

                  <div style={{ marginTop: '35px', paddingLeft: '48px' }}>
                    <p style={{ fontSize: '10.5pt', marginBottom: '40px' }}>Signed by:</p>
                    <div style={{ borderBottom: '1px solid #000', width: '220px', marginLeft: '30px', marginBottom: '4px' }}></div>
                    <div contentEditable suppressContentEditableWarning style={{ fontSize: '11pt', minHeight: '20px', width: '220px', textAlign: 'center', marginLeft: '30px' }}>
                      {oath.guardianName || ''}
                    </div>
                    <p style={{ fontWeight: 700, fontSize: '10pt', width: '220px', textAlign: 'center', marginLeft: '30px', marginTop: '2px' }}>Parent/Guardian</p>
                  </div>

                  <div contentEditable suppressContentEditableWarning style={{ position: 'absolute', bottom: '20px', left: '20px', fontWeight: 700, fontSize: '9pt', lineHeight: '1.4' }}>
                    THIS FORM NEED NOT BE NOTARIZED<br />11261 Form 2
                  </div>

                </div>
              </div>
            )}

          </div>

          <div className="DTPL_STATUS_BAR">
            <div className="DTPL_STATUS_LEFT">
              <span className="DTPL_STATUS_PILL online">● Live</span>
              <span>{content.type}</span>
              {content.residentName && <span>· {content.residentName}</span>}
            </div>
            <div className="DTPL_STATUS_RIGHT">
              <span>{wordCount} words</span>
              <span>Zoom {Math.round(zoom * 100)}%</span>
              <span>{hasPage2 ? '2' : '1'} page{hasPage2 ? 's' : ''}</span>
              <span>A4 · 210×297mm</span>
              <span className="DTPL_STATUS_PILL">Ref# {data.referenceNo || '—'}</span>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
};