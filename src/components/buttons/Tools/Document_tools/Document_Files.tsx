import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

/**
 * DOCUMENT_FILE — Engineer's Hill Barangay Document Editor
 * Version: 3.0 — Full Production Grade
 *
 * Architecture:
 *  - All visual styles → Document_Template.css (GPU-optimized, theme-variable-driven)
 *  - Page 1: Standard template engine (5 doc types)
 *  - Page 2: Fully editable Oath of Undertaking (Certification only)
 *    → Both contentEditable inline AND sidebar field-level control
 *  - Zoom control, status bar, page indicator
 *  - Graphical optimization: GPU layer promotion, contain: layout/paint,
 *    will-change, isolation: isolate per A4 page
 */

import './styles/Document_Frame.css';
import './styles/Document_Format.css';
import './styles/Document_Template.css';

// API & TYPES
import { useDocumentDataAPI, saveDocumentRecord, type IResident } from './Types/Doc_data_api';

// TEMPLATE ENGINES
import { getBarangayClearanceTemplate } from './Doc_type/Barangay_clearance';
import { getCertificateOfIndigencyTemplate } from './Doc_type/Barangay_Indegency';
import { getCertificateOfResidencyTemplate } from './Doc_type/Barangay_Residency';
import { getJobseekerTemplate } from './Doc_type/Barangay_Jobseeker';

// ASSETS
import baguioLogo from './icons/Baguio_city.png';
import brgyLogo from './icons/Barangay_eng-hill.png';

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

/** Page 2 (Oath) state — each editable field has its own slot */
interface IOathState {
  residentAge: string;
  yearsResident: string;
  // Signature lines (editable)
  jobseekerSigName: string;
  witnessedSigName: string;
  // Guardian section
  guardianName: string;
  guardianAge: string;
  guardianOf: string;
  guardianAddress: string;
  guardianYears: string;
  // Date stamp
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

// Toolbar icon SVGs (inline — no external font dependency)
const ICON = {
  bold:       <b style={{ fontFamily: 'Georgia, serif', fontSize: 13, letterSpacing: -0.5 }}>B</b>,
  italic:     <i style={{ fontFamily: 'Georgia, serif', fontSize: 13 }}>I</i>,
  underline:  <u style={{ fontFamily: 'Georgia, serif', fontSize: 13 }}>U</u>,
  alignLeft:  '⬸',
  alignCtr:   '⬌',
  alignRight: '⬹',
  justify:    '▤',
  zoomIn:     '+',
  zoomOut:    '−',
  print:      '⎙',
  close:      '✕',
  dl:         '↓',
};

// ─────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────
export const Document_File: React.FC<FileProps> = ({ onClose, onSuccess, data, officials = [] }) => {

  // ── 1. API DATA ──────────────────────────────────────────────
  const apiData           = useDocumentDataAPI(data.residentName, data.resident_id);
  const residents         = apiData?.residents || [];
  const apiCaptainName    = apiData?.captainName || '';
  const autoFilledAddress = apiData?.autoFilledAddress || '';

  // ── 2. UI STATE ──────────────────────────────────────────────
  const [isSaving,           setIsSaving]           = useState(false);
  const [filteredResidents,  setFilteredResidents]  = useState<IResident[]>([]);
  const [showDropdown,       setShowDropdown]       = useState(false);
  const [selectedResidentId, setSelectedResidentId] = useState<string | null>(data.resident_id || null);
  const [isInitialized,      setIsInitialized]      = useState(false);
  const [activeTab,          setActiveTab]          = useState<'page1' | 'page2'>('page1');
  const [zoom,               setZoom]               = useState(1);
  const [wordCount,          setWordCount]          = useState(0);

  // ── 3. RICH TEXT TOOLBAR STATE ───────────────────────────────
  const [isBold,      setIsBold]      = useState(false);
  const [isItalic,    setIsItalic]    = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [fontSize,    setFontSize]    = useState('12pt');

  // ── 4. PAGE 1 CONTENT STATE ──────────────────────────────────
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

  // ── 5. PAGE 2 (OATH) STATE ───────────────────────────────────
  const [oath, setOath] = useState<IOathState>({
    residentAge:      '',
    yearsResident:    '',
    jobseekerSigName: data.residentName || '',
    witnessedSigName: '',          // filled from captain name later
    guardianName:     '',
    guardianAge:      '',
    guardianOf:       data.residentName || '',
    guardianAddress:  '',
    guardianYears:    '',
    signedDay:        '',
    signedMonthYear:  '',
  });

  // ── 6. REFS ──────────────────────────────────────────────────
  const richBodyRef     = useRef<HTMLDivElement>(null);
  const searchWrapperRef = useRef<HTMLDivElement>(null);
  const pdfTargetRef    = useRef<HTMLDivElement>(null);
  const canvasRef       = useRef<HTMLDivElement>(null);
  const [contentKey, setContentKey] = useState(0);

  // ── 7. PRICING ENGINE ────────────────────────────────────────
  const priceConfig = useMemo<Record<string, string>>(() => ({
    'Barangay Clearance':           '200.00',
    'Certificate of Indigency':     '200.00',
    'Certificate of Residency':     '200.00',
    'Barangay Certification':       '0.00',
    'Affidavit of Barangay Official': '200.00',
  }), []);

  // ── 8. CLICK OUTSIDE DROPDOWN ────────────────────────────────
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(e.target as Node))
        setShowDropdown(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // ── 9. NAME FORMATTER ────────────────────────────────────────
  const formatToProperName = useCallback((first = '', middle = '', last = '') => {
    const cap = (s: string) =>
      s.trim().toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const mInit = middle.trim() ? `${middle.trim().charAt(0).toUpperCase()}. ` : '';
    return `${cap(first)} ${mInit}${cap(last)}`.trim();
  }, []);

  // ── 10. AUTO-ADDRESS SYNC ────────────────────────────────────
  useEffect(() => {
    if (autoFilledAddress && !content.address && !isInitialized)
      setContent(p => ({ ...p, address: autoFilledAddress.toUpperCase() }));
  }, [autoFilledAddress, content.address, isInitialized]);

  // ── 11. INIT RESIDENT ────────────────────────────────────────
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

  // ── 12. SYNC CAPTAIN → OATH ──────────────────────────────────
  const activeOfficial = officials?.find(o =>
    o.position.toLowerCase().includes('captain') || o.position.toLowerCase().includes('punong')
  ) || officials?.[0];
  const captainName     = activeOfficial?.full_name || apiCaptainName || 'AMADO M. FELIZARDO';
  const captainPosition = activeOfficial?.position  || 'Punong Barangay';

  useEffect(() => {
    if (!oath.witnessedSigName && captainName)
      setOath(p => ({ ...p, witnessedSigName: captainName.toUpperCase() }));
  }, [captainName]);

  // ── 13. SYNC DATE → OATH ─────────────────────────────────────
  useEffect(() => {
    const day = getUTCDay(content.dateIssued);
    setOath(p => ({
      ...p,
      signedDay:       `${day}${getDaySuffix(day)}`,
      signedMonthYear: fmtDate(content.dateIssued, { month: 'long', year: 'numeric' }),
    }));
  }, [content.dateIssued]);

  // ── 14. SYNC RESIDENT NAME → OATH ────────────────────────────
  useEffect(() => {
    setOath(p => ({
      ...p,
      jobseekerSigName: content.residentName || p.jobseekerSigName,
      guardianOf:       content.residentName || p.guardianOf,
    }));
  }, [content.residentName]);

  // ── 15. TEMPLATE REFRESH ─────────────────────────────────────
  useEffect(() => {
    setContentKey(k => k + 1);
    if (richBodyRef.current) {
      richBodyRef.current.innerHTML = resolveTemplate();
      // Update word count
      setWordCount(richBodyRef.current.innerText.trim().split(/\s+/).filter(Boolean).length);
    }
  }, [content.residentName, content.address, content.purpose, content.type, content.dateIssued]);

  // ── 16. NAME INPUT HANDLER ───────────────────────────────────
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

  // ── 17. DOC TYPE CHANGE ──────────────────────────────────────
  const handleTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const t = e.target.value;
    setContent(p => ({ ...p, type: t, feesPaid: priceConfig[t] || '0.00' }));
    // Auto-jump to page1 tab when switching type
    setActiveTab('page1');
  };

  // ── 18. TEMPLATE RESOLVER ────────────────────────────────────
  const resolveTemplate = useCallback(() => {
    const props = {
      name:      content.residentName || '_________________________',
      address:   content.address      || '_________________________',
      purpose:   content.purpose      || '_________________________',
      dateIssued: content.dateIssued,
    };
    switch (content.type) {
      case 'Barangay Clearance':          return getBarangayClearanceTemplate(props);
      case 'Certificate of Indigency':    return getCertificateOfIndigencyTemplate(props);
      case 'Certificate of Residency':    return getCertificateOfResidencyTemplate(props);
      case 'Barangay Certification':      return getJobseekerTemplate(props);
      case 'Affidavit of Barangay Official':
        return `<p style="text-indent:48px;text-align:justify;">That <b>${props.name}</b>, bonafide resident at ${props.address}, is a Single Parent defined under Section 3a of The Solo Parent Welfare Act...</p>`;
      default:
        return `<p style="text-align:justify;">This is to certify that <b>${props.name}</b> is a resident of this Barangay.</p>`;
    }
  }, [content]);

  // ── 19. PDF GENERATOR ────────────────────────────────────────
  const handleSaveAndDownload = async () => {
    if (!content.residentName) return alert('Please enter a Requestor Name.');
    if (!content.address)      return alert("Please enter or verify the resident's address.");

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
        reference_no:   data.referenceNo || `REF-${Date.now()}`,
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

  // ── 20. TYPE FLAGS ───────────────────────────────────────────
  const isResidency      = content.type === 'Certificate of Residency';
  const isClearance      = content.type === 'Barangay Clearance';
  const isCertification  = content.type === 'Barangay Certification';
  const isIndigency      = content.type === 'Certificate of Indigency';
  const isAffidavit      = content.type === 'Affidavit of Barangay Official';

  const hasPlainHeader   = isCertification || isAffidavit;
  const hasStampBox      = isResidency || isCertification || isIndigency;
  const hasCTC           = isClearance || isResidency || isIndigency || isAffidavit;
  const hasFees          = !isCertification;
  const hasPage2         = isCertification;

  // ── 21. ZOOM CONTROLS ────────────────────────────────────────
  const ZOOM_STEP  = 0.1;
  const ZOOM_MIN   = 0.5;
  const ZOOM_MAX   = 1.5;
  const zoomIn  = () => setZoom(z => Math.min(+(z + ZOOM_STEP).toFixed(1), ZOOM_MAX));
  const zoomOut = () => setZoom(z => Math.max(+(z - ZOOM_STEP).toFixed(1), ZOOM_MIN));
  const zoomReset = () => setZoom(1);

  // Inject zoom CSS variable
  useEffect(() => {
    if (canvasRef.current)
      canvasRef.current.style.setProperty('--doc-zoom', String(zoom));
  }, [zoom]);

  // ── 22. TOOLBAR execCommand HELPER ───────────────────────────
  const exec = (cmd: string, val?: string) => {
    document.execCommand(cmd, false, val);
  };

  // ── RENDER ───────────────────────────────────────────────────
  return (
    <div className="DTPL_OVERLAY" onClick={e => e.stopPropagation()}>

      {/* ══════════════════════════════════════════
          TOOLBAR
      ══════════════════════════════════════════ */}
      <div className="DTPL_TOOLBAR">

        {/* Brand */}
        <div className="DTPL_TOOLBAR_BRAND">
          <div className="DTPL_TOOLBAR_BRAND_ICON">🏛</div>
          <span className="DTPL_TOOLBAR_BRAND_LABEL">Brgy Doc</span>
        </div>

        {/* Format group */}
        <div className="DTPL_TOOL_GROUP">
          <button className={`DTPL_TOOL_BTN${isBold ? ' active' : ''}`} title="Bold"
            onMouseDown={e => { e.preventDefault(); exec('bold'); setIsBold(b => !b); }}>
            {ICON.bold}
          </button>
          <button className={`DTPL_TOOL_BTN${isItalic ? ' active' : ''}`} title="Italic"
            onMouseDown={e => { e.preventDefault(); exec('italic'); setIsItalic(b => !b); }}>
            {ICON.italic}
          </button>
          <button className={`DTPL_TOOL_BTN${isUnderline ? ' active' : ''}`} title="Underline"
            onMouseDown={e => { e.preventDefault(); exec('underline'); setIsUnderline(b => !b); }}>
            {ICON.underline}
          </button>
        </div>

        {/* Alignment group */}
        <div className="DTPL_TOOL_GROUP">
          <button className="DTPL_TOOL_BTN" title="Align Left"   onMouseDown={e => { e.preventDefault(); exec('justifyLeft'); }}>⬅</button>
          <button className="DTPL_TOOL_BTN" title="Align Center" onMouseDown={e => { e.preventDefault(); exec('justifyCenter'); }}>☰</button>
          <button className="DTPL_TOOL_BTN" title="Align Right"  onMouseDown={e => { e.preventDefault(); exec('justifyRight'); }}>➡</button>
          <button className="DTPL_TOOL_BTN" title="Justify"      onMouseDown={e => { e.preventDefault(); exec('justifyFull'); }}>▤</button>
        </div>

        {/* Font size group */}
        <div className="DTPL_TOOL_GROUP">
          <select
            className="DTPL_TOOL_SELECT"
            value={fontSize}
            style={{ width: 78 }}
            onChange={e => {
              setFontSize(e.target.value);
              exec('fontSize', '7');
              // Override via CSS after — execCommand fontSize is limited
              const sel = window.getSelection();
              if (sel && sel.rangeCount > 0) {
                const range = sel.getRangeAt(0);
                const span = document.createElement('span');
                span.style.fontSize = e.target.value;
                try { range.surroundContents(span); } catch {}
              }
            }}
          >
            {['8pt','9pt','10pt','11pt','12pt','13pt','14pt','16pt','18pt','22pt','24pt'].map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {/* Zoom group */}
        <div className="DTPL_ZOOM_CTL">
          <button className="DTPL_TOOL_BTN" title="Zoom Out"   onClick={zoomOut}>−</button>
          <span className="DTPL_ZOOM_LABEL" style={{ cursor: 'pointer' }} onClick={zoomReset}>
            {Math.round(zoom * 100)}%
          </span>
          <button className="DTPL_TOOL_BTN" title="Zoom In"    onClick={zoomIn}>+</button>
        </div>

        {/* Center meta */}
        <div className="DTPL_TOOLBAR_META">
          <span>{content.type}</span>
          {content.residentName && <>&nbsp;·&nbsp; {content.residentName}</>}
        </div>

        {/* Action buttons */}
        <div className="DTPL_TOOL_ACTIONS">
          <button className="DTPL_BTN DTPL_BTN--cancel" onClick={onClose}>
            {ICON.close} Close
          </button>
          <button className="DTPL_BTN DTPL_BTN--save" onClick={handleSaveAndDownload} disabled={isSaving}>
            {isSaving ? '⏳ Processing…' : `${ICON.dl} Print / Download`}
          </button>
        </div>

      </div>{/* end toolbar */}

      {/* ══════════════════════════════════════════
          BODY
      ══════════════════════════════════════════ */}
      <div className="DTPL_BODY">

        {/* ─────────────────────────────────────────
            SIDEBAR
        ───────────────────────────────────────── */}
        <div className="DTPL_SIDEBAR">

          {/* Sidebar header + tabs */}
          <div className="DTPL_SIDEBAR_HEADER">
            <div className="DTPL_SIDEBAR_TITLE">
              📋 Form Configuration
            </div>
            <div className="DTPL_TAB_NAV">
              <button
                className={`DTPL_TAB_BTN${activeTab === 'page1' ? ' active' : ''}`}
                onClick={() => setActiveTab('page1')}
              >
                📄 Page 1 – Certificate
              </button>
              {hasPage2 && (
                <button
                  className={`DTPL_TAB_BTN${activeTab === 'page2' ? ' active' : ''}`}
                  onClick={() => setActiveTab('page2')}
                >
                  📝 Page 2 – Oath
                </button>
              )}
            </div>
          </div>

          {/* ── SIDEBAR SCROLL BODY ── */}
          <div className="DTPL_SIDEBAR_SCROLL">

            {/* ══ TAB: PAGE 1 ══════════════════════════════ */}
            {activeTab === 'page1' && (<>

              {/* DOCUMENT SECTION */}
              <div className="DTPL_SEC_LABEL DTPL_SEC_LABEL--green">📄 Document</div>

              <div className="DTPL_FIELD">
                <label className="DTPL_FIELD_LABEL">
                  Document Type <span className="required-dot" />
                </label>
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
                  <input className="DTPL_INPUT" value={content.certificateNo}
                    onChange={e => setContent(p => ({ ...p, certificateNo: e.target.value }))}
                    placeholder="2025-07-00" />
                </div>
                <div className="DTPL_FIELD">
                  <label className="DTPL_FIELD_LABEL">Date Issued</label>
                  <input type="date" className="DTPL_INPUT" value={content.dateIssued}
                    onChange={e => setContent(p => ({ ...p, dateIssued: e.target.value }))} />
                </div>
              </div>

              {/* RESIDENT SECTION */}
              <div className="DTPL_SEC_LABEL DTPL_SEC_LABEL--navy">👤 Resident</div>

              <div className="DTPL_FIELD" style={{ position: 'relative' }} ref={searchWrapperRef}>
                <label className="DTPL_FIELD_LABEL">
                  Requestor Name <span className="required-dot" />
                </label>
                <input
                  type="text"
                  className="DTPL_INPUT"
                  value={content.residentName}
                  onChange={handleNameChange}
                  onFocus={() => { if (filteredResidents.length) setShowDropdown(true); }}
                  placeholder="Search or type full name…"
                />
                {showDropdown && filteredResidents.length > 0 && (
                  <ul className="DTPL_DROPDOWN">
                    {filteredResidents.slice(0, 8).map(r => (
                      <li key={r.record_id} onClick={() => selectResident(r)}>
                        <span className="DTPL_DROPDOWN_NAME">
                          {formatToProperName(r.first_name, r.middle_name, r.last_name)}
                        </span>
                        {r.purok && <span className="DTPL_DROPDOWN_META">{r.purok}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="DTPL_FIELD">
                <label className="DTPL_FIELD_LABEL">
                  Residential Address <span className="required-dot" />
                </label>
                <input className="DTPL_INPUT" value={content.address}
                  onChange={e => setContent(p => ({ ...p, address: e.target.value.toUpperCase() }))}
                  placeholder="Street / Purok / Barangay" />
              </div>

              <div className="DTPL_FIELD">
                <label className="DTPL_FIELD_LABEL">Purpose</label>
                <textarea className="DTPL_TEXTAREA" value={content.purpose}
                  onChange={e => setContent(p => ({ ...p, purpose: e.target.value }))}
                  placeholder="State the purpose of this document…" />
              </div>

              {/* PAYMENT SECTION */}
              <div className="DTPL_SEC_LABEL DTPL_SEC_LABEL--slate">💰 Payment & Reference</div>

              <div className="DTPL_GRID_2">
                <div className="DTPL_FIELD">
                  <label className="DTPL_FIELD_LABEL">O.R. No.</label>
                  <input className="DTPL_INPUT" value={content.orNo}
                    onChange={e => setContent(p => ({ ...p, orNo: e.target.value }))}
                    placeholder="OR0000" />
                </div>
                <div className="DTPL_FIELD">
                  <label className="DTPL_FIELD_LABEL">
                    {hasCTC ? 'CTC No.' : 'Fees Paid (₱)'}
                  </label>
                  {hasCTC ? (
                    <input className="DTPL_INPUT" value={content.ctcNo}
                      onChange={e => setContent(p => ({ ...p, ctcNo: e.target.value }))}
                      placeholder="12345678" />
                  ) : (
                    <input className="DTPL_INPUT" readOnly
                      value={isCertification ? 'FREE – RA 11261' : content.feesPaid}
                      style={{ color: isCertification ? '#94a3b8' : undefined }} />
                  )}
                </div>
              </div>

              {hasCTC && hasFees && (
                <div className="DTPL_FIELD">
                  <label className="DTPL_FIELD_LABEL">Fees Paid (₱)</label>
                  <input className="DTPL_INPUT" value={content.feesPaid}
                    onChange={e => setContent(p => ({ ...p, feesPaid: e.target.value }))}
                    placeholder="200.00" />
                </div>
              )}

              {isCertification && (
                <div className="DTPL_INFO_BOX DTPL_INFO_BOX--green">
                  <span>✅</span>
                  <span><strong>RA 11261 (FTJAA)</strong> — Free of charge. Generates 2-page output: Form 1 (Certificate) + Form 2 (Oath of Undertaking). Use the "Page 2 – Oath" tab to customize Form 2.</span>
                </div>
              )}

            </>)}

            {/* ══ TAB: PAGE 2 (OATH) ══════════════════════ */}
            {activeTab === 'page2' && hasPage2 && (<>

              <div className="DTPL_INFO_BOX DTPL_INFO_BOX--edit">
                <span>✏️</span>
                <span><strong>Form 2 is fully editable</strong> — Use fields below to fill blanks, OR click directly on the document text to edit inline.</span>
              </div>

              {/* APPLICANT INFO */}
              <div className="DTPL_SEC_LABEL DTPL_SEC_LABEL--purple">👤 Applicant Info</div>

              <div className="DTPL_FIELD">
                <label className="DTPL_FIELD_LABEL">Full Name (auto-synced)</label>
                <input className="DTPL_INPUT" readOnly value={content.residentName}
                  style={{ color: '#64748b' }} />
              </div>

              <div className="DTPL_FIELD">
                <label className="DTPL_FIELD_LABEL">Address (auto-synced)</label>
                <input className="DTPL_INPUT" readOnly value={content.address}
                  style={{ color: '#64748b' }} />
              </div>

              <div className="DTPL_GRID_2">
                <div className="DTPL_FIELD">
                  <label className="DTPL_FIELD_LABEL">Age (years)</label>
                  <input type="number" min={15} max={100} className="DTPL_INPUT"
                    value={oath.residentAge}
                    onChange={e => setOath(p => ({ ...p, residentAge: e.target.value }))}
                    placeholder="e.g. 22" />
                </div>
                <div className="DTPL_FIELD">
                  <label className="DTPL_FIELD_LABEL">Years Resident</label>
                  <input type="number" min={1} className="DTPL_INPUT"
                    value={oath.yearsResident}
                    onChange={e => setOath(p => ({ ...p, yearsResident: e.target.value }))}
                    placeholder="e.g. 5" />
                </div>
              </div>

              {/* SIGNATURE SECTION */}
              <div className="DTPL_SEC_LABEL DTPL_SEC_LABEL--green">✍️ Signatures</div>

              <div className="DTPL_FIELD">
                <label className="DTPL_FIELD_LABEL">Jobseeker Signature Name</label>
                <input className="DTPL_INPUT" value={oath.jobseekerSigName}
                  onChange={e => setOath(p => ({ ...p, jobseekerSigName: e.target.value.toUpperCase() }))}
                  placeholder="FULL NAME IN CAPS" />
              </div>

              <div className="DTPL_FIELD">
                <label className="DTPL_FIELD_LABEL">Witnessed By (Punong Barangay)</label>
                <input className="DTPL_INPUT" value={oath.witnessedSigName}
                  onChange={e => setOath(p => ({ ...p, witnessedSigName: e.target.value.toUpperCase() }))}
                  placeholder="AMADO M. FELIZARDO" />
              </div>

              {/* DATE */}
              <div className="DTPL_SEC_LABEL DTPL_SEC_LABEL--slate">📅 Date Signed</div>

              <div className="DTPL_FIELD">
                <label className="DTPL_FIELD_LABEL">Date (auto-synced from Page 1)</label>
                <input className="DTPL_INPUT" readOnly
                  value={`${oath.signedDay} day of ${oath.signedMonthYear}`}
                  style={{ color: '#64748b' }} />
              </div>

              {/* GUARDIAN SECTION */}
              <div className="DTPL_SEC_LABEL DTPL_SEC_LABEL--amber">👪 Guardian (if applicant is 15–17 yrs)</div>

              <div className="DTPL_INFO_BOX DTPL_INFO_BOX--amber">
                <span>⚠️</span>
                <span>Required only if applicant is between 15 and below 18 years of age.</span>
              </div>

              <div className="DTPL_FIELD">
                <label className="DTPL_FIELD_LABEL">Parent / Guardian Name</label>
                <input className="DTPL_INPUT" value={oath.guardianName}
                  onChange={e => setOath(p => ({ ...p, guardianName: e.target.value }))}
                  placeholder="Full name of parent/guardian" />
              </div>

              <div className="DTPL_GRID_2">
                <div className="DTPL_FIELD">
                  <label className="DTPL_FIELD_LABEL">Guardian Age</label>
                  <input type="number" className="DTPL_INPUT" value={oath.guardianAge}
                    onChange={e => setOath(p => ({ ...p, guardianAge: e.target.value }))}
                    placeholder="e.g. 42" />
                </div>
                <div className="DTPL_FIELD">
                  <label className="DTPL_FIELD_LABEL">Years at Address</label>
                  <input type="number" className="DTPL_INPUT" value={oath.guardianYears}
                    onChange={e => setOath(p => ({ ...p, guardianYears: e.target.value }))}
                    placeholder="e.g. 10" />
                </div>
              </div>

              <div className="DTPL_FIELD">
                <label className="DTPL_FIELD_LABEL">Guardian of (child name)</label>
                <input className="DTPL_INPUT" value={oath.guardianOf}
                  onChange={e => setOath(p => ({ ...p, guardianOf: e.target.value }))}
                  placeholder="Child's full name" />
              </div>

              <div className="DTPL_FIELD">
                <label className="DTPL_FIELD_LABEL">Guardian Address</label>
                <input className="DTPL_INPUT" value={oath.guardianAddress}
                  onChange={e => setOath(p => ({ ...p, guardianAddress: e.target.value.toUpperCase() }))}
                  placeholder="Complete address" />
              </div>

            </>)}

          </div>{/* end sidebar scroll */}

          {/* Sidebar footer */}
          <div className="DTPL_SIDEBAR_FOOTER">
            <div>
              Ref# <strong>{data.referenceNo || '—'}</strong>
            </div>
            <div className="DTPL_PAGE_INDICATOR">
              {/* Page dots */}
              <div
                className={`DTPL_PAGE_DOT${activeTab === 'page1' ? ' active' : ''}`}
                title="Page 1"
                onClick={() => setActiveTab('page1')}
              />
              {hasPage2 && (
                <div
                  className={`DTPL_PAGE_DOT${activeTab === 'page2' ? ' active' : ''}`}
                  title="Page 2"
                  onClick={() => { setActiveTab('page2'); }}
                />
              )}
              <span style={{ marginLeft: 5 }}>
                {activeTab === 'page1' ? '1' : '2'}/{hasPage2 ? 2 : 1} page{hasPage2 ? 's' : ''}
              </span>
            </div>
            <div style={{ fontSize: '0.65rem' }}>
              {wordCount} words
            </div>
          </div>

        </div>{/* end sidebar */}

        {/* ─────────────────────────────────────────
            CANVAS / PREVIEW AREA
        ───────────────────────────────────────── */}
        <div className="DTPL_CANVAS" ref={canvasRef}>

          <div
            ref={pdfTargetRef}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: `${36 / zoom}px`, // compensate gap for zoom
            }}
          >

            {/* ════════════════════════════════════════
                A4 PAGE 1 — MAIN CERTIFICATE
            ════════════════════════════════════════ */}
            <div
              className="DTPL_A4"
              style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
            >
              {/* Watermark */}
              <img src={brgyLogo} alt="" className="DTPL_WATERMARK" aria-hidden="true" />

              {/* ── HEADER ── */}
              {hasPlainHeader ? (
                /* Plain header: flex row (Certification / Affidavit) */
                <div className="DTPL_HDR_PLAIN">
                  <img src={brgyLogo} alt="Barangay Logo" className="DTPL_HDR_PLAIN_LOGO" />
                  <div className="DTPL_HDR_PLAIN_TEXT">
                    <p className="republic">Republic of the Philippines</p>
                    <p className="brgy-name">Engineer's Hill Barangay</p>
                    <p className="city">Baguio City</p>
                    <p className="phone">074-422-8228</p>
                    <p className="email">enrqshill2600@gmail.com</p>
                  </div>
                  <div className="DTPL_HDR_PLAIN_CERTNO">
                    <span className="cert-label">Barangay Certificate No.</span>
                    <span className="cert-value">{content.certificateNo}</span>
                  </div>
                </div>
              ) : (
                /* Standard green-banner header */
                <div className="DTPL_HDR_STANDARD">
                  <div className="DTPL_HDR_LOGO_BOX">
                    <img src={brgyLogo} alt="Barangay" className="DTPL_HDR_LOGO_IMG" />
                  </div>
                  <div className="DTPL_HDR_BANNER">
                    <p>REPUBLIC OF THE PHILIPPINES</p>
                    <p>CITY OF BAGUIO</p>
                    <p className="DTPL_HDR_BANNER_NAME">ENGINEER'S HILL BARANGAY</p>
                  </div>
                  <div className="DTPL_HDR_LOGO_BOX">
                    <img src={baguioLogo} alt="Baguio City" className="DTPL_HDR_LOGO_IMG" />
                  </div>
                </div>
              )}

              {/* ── TITLE ── */}
              <div className="DTPL_TITLE_BLOCK" style={{ marginBottom: isCertification ? '10px' : '16px' }}>
                {isResidency && (
                  <div className="DTPL_OFFICE_SUBTITLE">OFFICE OF THE PUNONG BARANGAY</div>
                )}
                <h1 className={`DTPL_DOC_TITLE ${isCertification ? 'DTPL_DOC_TITLE--md' : 'DTPL_DOC_TITLE--lg'}`}>
                  {content.type.toUpperCase()}
                </h1>
                {isCertification && (
                  <p className="DTPL_DOC_SUBTITLE">(FIRST TIME JOBSEEKERS ASSISTANCE ACT – RA 11261)</p>
                )}
                {isAffidavit && (
                  <p className="DTPL_DOC_SUBTITLE">THAT A PARENT IS A RESIDENT OF THIS BARANGAY</p>
                )}
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
              <div className="DTPL_SIG_ROW" style={{ marginTop: isCertification ? '12px' : '22px' }}>

                {isClearance && (
                  <div className="DTPL_RESIDENT_SIG">
                    <div className="DTPL_RESIDENT_SIG_LINE">Signature of Resident</div>
                  </div>
                )}

                {isAffidavit && (
                  <div className="DTPL_WITNESS_BLOCK">
                    <p><strong>Witnesses:</strong></p>
                    <p><b>Name:</b> MARYELLA KRYZELLE L. ESLAVA</p>
                    <p><b>Address:</b> 125 Lagerra Alley, Engr's Hill</p>
                    <p><b>Contact No:</b> 09676847922</p>
                  </div>
                )}

                {/* Captain signature block */}
                <div className="DTPL_SIG_BLOCK" style={{
                  marginLeft: 'auto',
                  alignItems: isCertification ? 'flex-start' : 'center',
                  paddingLeft: isCertification ? '56px' : '0',
                  width: isCertification ? '56%' : '42%',
                }}>
                  <span className="DTPL_SIG_NAME">{captainName.toUpperCase()}</span>
                  <span className="DTPL_SIG_POSITION">{captainPosition}</span>

                  {isCertification && (<>
                    <p className="DTPL_SIG_DATE">
                      {fmtDate(content.dateIssued, { month: 'long', day: '2-digit', year: 'numeric' })}
                    </p>
                    <p className="DTPL_SIG_WITNESS_LABEL">Witnessed by:</p>
                    <span className="DTPL_SIG_NAME" style={{ minWidth: '210px', fontSize: '12pt' }}>
                      CHARITO A. GUMAD-ANG
                    </span>
                    <span className="DTPL_SIG_POSITION" style={{ fontSize: '9.5pt' }}>Barangay Kagawad</span>
                    <p className="DTPL_SIG_DATE" style={{ marginTop: '8px' }}>
                      {fmtDate(content.dateIssued, { month: 'long', day: 'numeric', year: 'numeric' })}
                    </p>
                  </>)}
                </div>
              </div>

              {/* ── STAMP BOX ── */}
              {hasStampBox && (
                <div className="DTPL_STAMP_BOX">
                  <div className="DTPL_STAMP_TITLE">"DOCUMENTARY STAMP TAX PAID"</div>
                  <div className="DTPL_STAMP_ROW">
                    <div className="DTPL_STAMP_COL">
                      <div className="DTPL_STAMP_VALUE">{content.orNo || '____________'}</div>
                      <div className="DTPL_STAMP_LINE" />
                      <div className="DTPL_STAMP_SUBLABEL">GOR Serial Number</div>
                    </div>
                    <div className="DTPL_STAMP_COL">
                      <div className="DTPL_STAMP_VALUE">
                        {fmtDate(content.dateIssued, { day: '2-digit', month: 'short', year: 'numeric' })}
                      </div>
                      <div className="DTPL_STAMP_LINE" />
                      <div className="DTPL_STAMP_SUBLABEL">Date of Payment</div>
                    </div>
                  </div>
                </div>
              )}

              {/* ── METADATA ROW ── */}
              <div className="DTPL_META_ROW" style={{ marginTop: hasStampBox ? '7px' : '12px' }}>
                <div>
                  <p>CTC NO: {content.ctcNo || 'N/A'}</p>
                  <p>ISSUED AT: Engr's Hill, Baguio City</p>
                </div>
                <div className="right">
                  <p>FEES PAID: ₱ {isCertification ? '0.00 (FREE)' : content.feesPaid}</p>
                  <p>DATE: {fmtDate(content.dateIssued, { month: 'long', day: 'numeric', year: 'numeric' })}</p>
                </div>
              </div>

              {/* ── GREEN FOOTER ── */}
              <div className="DTPL_GREEN_FOOTER">
                <div className="DTPL_GREEN_FOOTER_CONTACTS">
                  <span>✉ enrqshill2600@gmail.com</span>
                  <span>📞 074-422-8228</span>
                </div>
                <p className="DTPL_GREEN_FOOTER_ADDR">📍 Engineer's Hill Barangay, Baguio City</p>
              </div>

              {/* Form 1 tag */}
              {isCertification && (
                <div className="DTPL_FORM_TAG">
                  THIS FORM NEED NOT BE NOTARIZED<br />11261 Form 1
                </div>
              )}

            </div>{/* end A4 page 1 */}

            {/* ════════════════════════════════════════
                A4 PAGE 2 — OATH OF UNDERTAKING
                Fully editable: both via sidebar fields
                and direct inline contentEditable.
            ════════════════════════════════════════ */}
            {isCertification && (
              <div
                className="DTPL_A4"
                style={{
                  padding: '14mm 20mm 16mm',
                  transform: `scale(${zoom})`,
                  transformOrigin: 'top center',
                }}
              >
                <div className="DTPL_P2_WRAPPER">

                  {/* Revised label */}
                  <p className="DTPL_P2_REVISED" contentEditable suppressContentEditableWarning>
                    Revised as of 16 June 2021
                  </p>

                  {/* Title */}
                  <h2 className="DTPL_P2_TITLE" contentEditable suppressContentEditableWarning>
                    OATH OF UNDERTAKING
                  </h2>
                  <p className="DTPL_P2_SUBTITLE" contentEditable suppressContentEditableWarning>
                    Republic Act 11261 – First Time Jobseekers Assistance Act
                  </p>

                  {/* Opening paragraph — fields from sidebar fill the blanks */}
                  <p className="DTPL_P2_PARA" contentEditable suppressContentEditableWarning>
                    I, <b>{oath.jobseekerSigName || '_________________________'}</b>,{' '}
                    <span
                      contentEditable
                      suppressContentEditableWarning
                      style={{ display: 'inline', outline: 'none', borderBottom: '1px solid #000', minWidth: '40px' }}
                      title="Edit age"
                    >
                      {oath.residentAge || '________'}
                    </span>{' '}
                    years of age, resident of <b>{content.address || '_________________________'}</b>{' '}
                    for{' '}
                    <span
                      contentEditable
                      suppressContentEditableWarning
                      style={{ display: 'inline', outline: 'none', borderBottom: '1px solid #000', minWidth: '40px' }}
                      title="Edit years of residency"
                    >
                      {oath.yearsResident || '________'}
                    </span>{' '}
                    Years, availing the benefits of <b>Republic Act 11261</b>, otherwise known as the{' '}
                    <b>First Time Jobseekers Act of 2019</b>, do hereby declare, agree and undertake to
                    abide and be bound by the following:
                  </p>

                  {/* Numbered oath items — each li is independently contentEditable */}
                  <ol className="DTPL_P2_LIST">
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
                      <li key={idx} contentEditable suppressContentEditableWarning>{item}</li>
                    ))}
                  </ol>

                  {/* Signed date paragraph */}
                  <p className="DTPL_P2_PARA" contentEditable suppressContentEditableWarning>
                    Signed this <b>{oath.signedDay}</b> day of <b>{oath.signedMonthYear}</b> in the
                    Engineer's Hill Barangay, Baguio City.
                  </p>

                  {/* Signatures row */}
                  <div className="DTPL_P2_SIGNED_ROW">
                    <div className="DTPL_P2_SIG_BLOCK">
                      <p className="DTPL_P2_SIG_LABEL">Signed by:</p>
                      <div
                        className="DTPL_P2_SIG_LINE"
                        contentEditable
                        suppressContentEditableWarning
                      >
                        {oath.jobseekerSigName || ''}
                      </div>
                      <p className="DTPL_P2_SIG_SUBLABEL">First Time Jobseeker</p>
                    </div>
                    <div className="DTPL_P2_SIG_BLOCK">
                      <p className="DTPL_P2_SIG_LABEL">Witnessed by:</p>
                      <div
                        className="DTPL_P2_SIG_LINE"
                        contentEditable
                        suppressContentEditableWarning
                      >
                        {oath.witnessedSigName || captainName.toUpperCase()}
                      </div>
                      <p className="DTPL_P2_SIG_SUBLABEL">Punong Barangay</p>
                    </div>
                  </div>

                  {/* Guardian / minor section */}
                  <div className="DTPL_P2_MINOR_SECTION">
                    <p className="DTPL_P2_MINOR_LABEL">
                      For applicants at least fifteen years old to less than 18 years of age:
                    </p>
                    <p className="DTPL_P2_MINOR_PARA" contentEditable suppressContentEditableWarning>
                      I,{' '}
                      <span
                        contentEditable
                        suppressContentEditableWarning
                        style={{ display: 'inline', outline: 'none', borderBottom: '1px solid #000', minWidth: '180px' }}
                      >
                        {oath.guardianName || '________________________________________________'}
                      </span>
                      ,{' '}
                      <span
                        contentEditable
                        suppressContentEditableWarning
                        style={{ display: 'inline', outline: 'none', borderBottom: '1px solid #000', minWidth: '40px' }}
                      >
                        {oath.guardianAge || '________'}
                      </span>{' '}
                      years of age, parent/guardian of{' '}
                      <span
                        contentEditable
                        suppressContentEditableWarning
                        style={{ display: 'inline', outline: 'none', borderBottom: '1px solid #000', minWidth: '180px' }}
                      >
                        {oath.guardianOf || '________________________________________________'}
                      </span>
                      , and a resident of{' '}
                      <span
                        contentEditable
                        suppressContentEditableWarning
                        style={{ display: 'inline', outline: 'none', borderBottom: '1px solid #000', minWidth: '240px' }}
                      >
                        {oath.guardianAddress || '_______________________________________________ (complete address)'}
                      </span>
                      , for{' '}
                      <span
                        contentEditable
                        suppressContentEditableWarning
                        style={{ display: 'inline', outline: 'none', borderBottom: '1px solid #000', minWidth: '40px' }}
                      >
                        {oath.guardianYears || '________'}
                      </span>{' '}
                      (years/months), do hereby give my consent for my child/dependent to avail the
                      benefits of <b>Republic Act 11261</b> and be bound by the abovementioned
                      conditions.
                    </p>
                  </div>

                  {/* Guardian signature */}
                  <div className="DTPL_P2_GUARDIAN_SIG">
                    <p className="DTPL_P2_SIG_LABEL">Signed by:</p>
                    <div
                      className="DTPL_P2_SIG_LINE"
                      contentEditable
                      suppressContentEditableWarning
                      style={{ minWidth: '220px', textAlign: 'center' }}
                    >
                      {oath.guardianName || ''}
                    </div>
                    <p className="DTPL_P2_SIG_SUBLABEL" style={{ fontWeight: 700 }}>Parent / Guardian</p>
                  </div>

                  {/* Form 2 tag */}
                  <div className="DTPL_P2_FORM_TAG" contentEditable suppressContentEditableWarning>
                    THIS FORM NEED NOT BE NOTARIZED<br />11261 Form 2
                  </div>

                </div>{/* end p2 wrapper */}
              </div>
            )}{/* end page 2 */}

          </div>{/* end pdfTargetRef */}

          {/* ── STATUS BAR ─────────────────────────────── */}
          <div className="DTPL_STATUS_BAR">
            <div className="DTPL_STATUS_LEFT">
              <span className="DTPL_STATUS_PILL online">● Live</span>
              <span>{content.type}</span>
              {content.residentName && <span>· {content.residentName}</span>}
            </div>
            <div className="DTPL_STATUS_RIGHT">
              <span>{wordCount} words</span>
              <span>Zoom {Math.round(zoom * 100)}%</span>
              <span>
                {hasPage2 ? '2' : '1'} page{hasPage2 ? 's' : ''}
              </span>
              <span>A4 · 210×297mm</span>
              <span className="DTPL_STATUS_PILL">
                Ref# {data.referenceNo || '—'}
              </span>
            </div>
          </div>

        </div>{/* end canvas */}

      </div>{/* end body */}
    </div>/* end overlay */
  );
};