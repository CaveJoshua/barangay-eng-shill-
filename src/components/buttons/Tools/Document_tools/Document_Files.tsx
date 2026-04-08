import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

/**
 * ARCHITECTURE NOTE:
 * This file handles the Logic, State, API Handshaking, and PDF generation.
 * The PDF Generator has been upgraded to support Multi-Page Iteration
 * for distinct A4 documents natively.
 *
 * FIXED v2:
 * - First page header layout (plain header uses proper flex, no broken absolute positioning)
 * - A4 content flow: min-height tuned, margins tightened so content never bleeds
 * - Sidebar overhauled: always-visible date/cert/OR/CTC/fee controls, textarea for purpose,
 *   live type-aware visibility logic — behaves like a real PDF field panel
 */

import './styles/Document_Frame.css';
import './styles/Document_Format.css';

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

// --- INTERFACES ---
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

// =========================================================
// 🛠️ INTERNAL HELPERS
// =========================================================
const normalizeDocType = (dbType: string) => {
  const lower = (dbType || '').toLowerCase();
  if (lower.includes('indigency')) return 'Certificate of Indigency';
  if (lower.includes('residency')) return 'Certificate of Residency';
  if (lower.includes('certification') || lower.includes('jobseeker')) return 'Barangay Certification';
  if (lower.includes('affidavit')) return 'Affidavit of Barangay Official';
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

// =========================================================
// SIDEBAR SECTION HEADER COMPONENT
// =========================================================
const SidebarSection: React.FC<{ label: string; color?: string }> = ({ label, color = '#1e4d2b' }) => (
  <div style={{
    fontSize: '0.7rem',
    fontWeight: 800,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: '#ffffff',
    background: color,
    padding: '6px 10px',
    borderRadius: '5px',
    marginTop: '4px',
  }}>
    {label}
  </div>
);

/**
 * MAIN COMPONENT: Document_File
 */
export const Document_File: React.FC<FileProps> = ({ onClose, onSuccess, data, officials = [] }) => {
  // 1. DATA FETCHING
  const apiData = useDocumentDataAPI(data.residentName, data.resident_id);
  const residents = apiData?.residents || [];
  const apiCaptainName = apiData?.captainName || '';
  const autoFilledAddress = apiData?.autoFilledAddress || '';

  // 2. UI STATES
  const [isSaving, setIsSaving] = useState(false);
  const [filteredResidents, setFilteredResidents] = useState<IResident[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedResidentId, setSelectedResidentId] = useState<string | null>(data.resident_id || null);
  const [isInitialized, setIsInitialized] = useState(false);

  // 3. RICH TEXT TOOLBAR STATES
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);

  // 4. DOCUMENT CONTENT STATE
  const [content, setContent] = useState({
    residentName: data.residentName || '',
    type: normalizeDocType(data.type),
    purpose: data.purpose || '',
    dateIssued: new Date().toISOString().split('T')[0],
    address: '',
    ctcNo: '',
    orNo: 'OR' + Math.floor(1000 + Math.random() * 9000),
    feesPaid: data.price?.toString() || '200.00',
    certificateNo: '2025-07-' + Math.floor(10 + Math.random() * 90).toString().padStart(2, '0'),
  });

  // 5. REFS
  const previewRef = useRef<HTMLDivElement>(null);
  const searchWrapperRef = useRef<HTMLDivElement>(null);
  const pdfTargetRef = useRef<HTMLDivElement>(null);
  const [contentKey, setContentKey] = useState(0);

  // 6. MEMOIZED PRICING ENGINE
  const documentPriceConfig = useMemo(() => ({
    'Barangay Clearance': '200.00',
    'Certificate of Indigency': '200.00',
    'Certificate of Residency': '200.00',
    'Barangay Certification': '0.00',
    'Affidavit of Barangay Official': '200.00',
  }), []);

  // 7. CLICK OUTSIDE SEARCH
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 8. NAME FORMATTER
  const formatToProperName = useCallback((first: string = '', middle: string = '', last: string = '') => {
    const capitalize = (str: string) =>
      str.trim().toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    const fName = capitalize(first);
    const lName = capitalize(last);
    const mInit = middle.trim() ? `${middle.trim().charAt(0).toUpperCase()}. ` : '';
    return `${fName} ${mInit}${lName}`.trim();
  }, []);

  // 9. AUTO-ADDRESS SYNC
  useEffect(() => {
    if (autoFilledAddress && !content.address && !isInitialized) {
      setContent(prev => ({ ...prev, address: autoFilledAddress.toUpperCase() }));
    }
  }, [autoFilledAddress, content.address, isInitialized]);

  // 10. INIT RESIDENT DATA
  useEffect(() => {
    if (residents.length > 0 && !isInitialized && (data.resident_id || data.residentName)) {
      const matched = residents.find(r => {
        if (data.resident_id && r.record_id === data.resident_id) return true;
        const searchName = (data.residentName || '').trim().toLowerCase();
        return `${r.first_name} ${r.last_name}`.toLowerCase().includes(searchName);
      });

      if (matched) {
        const addrParts: string[] = [];
        if (matched.current_address && matched.current_address.toLowerCase() !== 'n/a') addrParts.push(matched.current_address);
        if (matched.purok) addrParts.push(matched.purok);
        const formattedName = formatToProperName(matched.first_name, matched.middle_name, matched.last_name);
        setContent(prev => ({
          ...prev,
          residentName: formattedName,
          address: addrParts.join(', ').toUpperCase(),
        }));
        setSelectedResidentId(matched.record_id || null);
        setIsInitialized(true);
      }
    }
  }, [residents, data.resident_id, data.residentName, isInitialized, formatToProperName]);

  // 11. TEMPLATE REFRESH
  useEffect(() => {
    setContentKey(prev => prev + 1);
    if (previewRef.current) {
      previewRef.current.innerHTML = getTemplateContent();
    }
  }, [content.residentName, content.address, content.purpose, content.type, content.dateIssued]);

  // 12. NAME INPUT HANDLER
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value;
    setContent(prev => ({ ...prev, residentName: input }));
    if (isInitialized) { setSelectedResidentId(null); setIsInitialized(false); }

    if (input.length > 0 && residents.length > 0) {
      const filtered = residents.filter(r =>
        `${r.first_name} ${r.last_name}`.toLowerCase().includes(input.toLowerCase())
      );
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
      address: addrParts.join(', ').toUpperCase(),
    }));
    setSelectedResidentId(r.record_id || null);
    setIsInitialized(true);
    setShowDropdown(false);
  };

  // 13. DOC TYPE CHANGE
  const handleTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newType = e.target.value as keyof typeof documentPriceConfig;
    setContent(prev => ({
      ...prev,
      type: newType,
      feesPaid: documentPriceConfig[newType] || '0.00',
    }));
  };

  // 14. TEMPLATE RESOLVER
  const getTemplateContent = () => {
    const { residentName, address, purpose, dateIssued, type } = content;
    const templateProps = {
      name: residentName || '_________________________',
      address: address || '_________________________',
      purpose: purpose || '_________________________',
      dateIssued,
    };
    switch (type) {
      case 'Barangay Clearance': return getBarangayClearanceTemplate(templateProps);
      case 'Certificate of Indigency': return getCertificateOfIndigencyTemplate(templateProps);
      case 'Certificate of Residency': return getCertificateOfResidencyTemplate(templateProps);
      case 'Barangay Certification': return getJobseekerTemplate(templateProps);
      case 'Affidavit of Barangay Official':
        return `<p style="text-indent: 50px; text-align: justify;">That <b>${templateProps.name}</b>, bonafide resident at ${templateProps.address}, is a Single Parent defined under Section 3a of The Solo Parent Welfare Act...</p>`;
      default:
        return `<p style="text-align: justify; font-size: 12pt; line-height: 1.6;">This is to certify that <b>${templateProps.name}</b> is a resident of this Barangay.</p>`;
    }
  };

  // 15. MULTI-PAGE PDF GENERATOR
  const handleSaveAndDownload = async () => {
    if (!content.residentName) return alert('Please enter a Requestor Name.');
    if (!content.address) return alert("Please enter or verify the resident's address.");

    setIsSaving(true);

    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();

      const pages = pdfTargetRef.current!.querySelectorAll('.DOC_GEN_A4_PAGE');

      for (let i = 0; i < pages.length; i++) {
        if (i > 0) pdf.addPage();

        const canvas = await html2canvas(pages[i] as HTMLElement, {
          scale: 2.5,
          useCORS: true,
          backgroundColor: '#ffffff',
          logging: false,
        });

        const imgData = canvas.toDataURL('image/png');
        const imgProps = pdf.getImageProperties(imgData);
        const imgHeight = (imgProps.height * pdfWidth) / imgProps.width;

        let heightLeft = imgHeight;
        let position = 0;

        pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
        heightLeft -= pdfHeight;

        while (heightLeft > 0) {
          position -= 297;
          pdf.addPage();
          pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
          heightLeft -= pdfHeight;
        }
      }

      pdf.save(`${content.type.replace(/\s+/g, '_')}_${content.residentName}.pdf`);

      const payload = {
        ...(data.id ? { id: data.id } : {}),
        resident_id: selectedResidentId || 'MANUAL_ENTRY',
        resident_name: content.residentName,
        type: content.type,
        purpose: content.purpose,
        price: parseFloat(content.feesPaid) || 0,
        status: 'Completed',
        reference_no: data.referenceNo || `REF-${Date.now()}`,
        date_requested: new Date().toISOString(),
      };

      await saveDocumentRecord(payload);
      onSuccess();
      onClose();
    } catch (error: any) {
      console.error('PDF Processing Error:', error);
      alert(`System Error: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // 16. SIGNATURE LOGIC
  const activeOfficial = officials?.find(o =>
    o.position.toLowerCase().includes('captain') || o.position.toLowerCase().includes('punong')
  ) || officials?.[0];

  const displayCaptainName = activeOfficial?.full_name || apiCaptainName || 'AMADO M. FELIZARDO';
  const displayCaptainPosition = activeOfficial?.position || 'Punong Barangay';

  // 17. TYPE CHECKERS
  const isResidency = content.type === 'Certificate of Residency';
  const isClearance = content.type === 'Barangay Clearance';
  const isCertification = content.type === 'Barangay Certification';
  const isIndigency = content.type === 'Certificate of Indigency';
  const isAffidavit = content.type === 'Affidavit of Barangay Official';

  const hasPlainHeader = isCertification || isAffidavit;
  const hasStampBox = isResidency || isCertification || isIndigency;
  const hasCTC = isClearance || isResidency || isIndigency || isAffidavit;
  const hasFees = !isCertification;

  // DATE FORMATTING
  const issuedDate = new Date(content.dateIssued);
  const issuedDay = issuedDate.getUTCDate();
  const issuedDayWithSuffix = `${issuedDay}${getDaySuffix(issuedDay)}`;
  const issuedMonthYear = issuedDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  // ── INLINE STYLE CONSTANTS ──────────────────────────────────
  const fieldLabel: React.CSSProperties = {
    fontSize: '0.7rem',
    fontWeight: 700,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '4px',
    display: 'block',
  };

  const fieldInput: React.CSSProperties = {
    width: '100%',
    padding: '9px 11px',
    border: '1.5px solid #cbd5e1',
    borderRadius: '7px',
    fontSize: '0.875rem',
    background: '#f8fafc',
    color: '#1e293b',
    boxSizing: 'border-box',
    transition: 'border-color 0.2s, box-shadow 0.2s',
    outline: 'none',
  };

  const fieldTextarea: React.CSSProperties = {
    ...fieldInput,
    resize: 'vertical',
    minHeight: '72px',
    lineHeight: '1.5',
    fontFamily: 'inherit',
  };

  const fieldGroup: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
  };

  const twoColGrid: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '10px',
  };

  // ── PAGE 1 STRUCTURAL SIZES ─────────────────────────────────
  // These values are tuned per document type so all content
  // fits inside exactly one 297mm A4 page.
  const richContentStyle: React.CSSProperties = {
    position: 'relative',
    zIndex: 5,
    fontSize: isCertification ? '11.5pt' : '12pt',
    lineHeight: isCertification ? '1.65' : '1.75',
    textAlign: 'justify',
    padding: '0 4px',
    flex: 1,
    minHeight: 0,
  };

  return (
    <div className="DOC_GEN_OVERLAY" onClick={(e) => e.stopPropagation()}>

      {/* ── TOOLBAR ── */}
      <div className="DOC_GEN_TOOLBAR">
        <div className="DOC_GEN_TOOL_GROUP">
          <button
            className={isBold ? 'active' : ''}
            title="Bold"
            onMouseDown={(e) => { e.preventDefault(); document.execCommand('bold'); setIsBold(b => !b); }}
          ><b>B</b></button>
          <button
            className={isItalic ? 'active' : ''}
            title="Italic"
            onMouseDown={(e) => { e.preventDefault(); document.execCommand('italic'); setIsItalic(b => !b); }}
          ><i>I</i></button>
          <button
            className={isUnderline ? 'active' : ''}
            title="Underline"
            onMouseDown={(e) => { e.preventDefault(); document.execCommand('underline'); setIsUnderline(b => !b); }}
          ><u>U</u></button>
          <button title="Align Left"   onMouseDown={(e) => { e.preventDefault(); document.execCommand('justifyLeft'); }}>⬅</button>
          <button title="Align Center" onMouseDown={(e) => { e.preventDefault(); document.execCommand('justifyCenter'); }}>☰</button>
          <button title="Align Right"  onMouseDown={(e) => { e.preventDefault(); document.execCommand('justifyRight'); }}>➡</button>
          <button title="Justify"      onMouseDown={(e) => { e.preventDefault(); document.execCommand('justifyFull'); }}>≡</button>
        </div>
        <div style={{ color: '#94a3b8', fontSize: '0.82rem', fontWeight: 600, letterSpacing: '0.03em' }}>
          📄 {content.type} &nbsp;·&nbsp; {content.residentName || 'No Name'}
        </div>
        <div className="DOC_GEN_TOOL_ACTIONS">
          <button className="DOC_GEN_BTN_CANCEL" onClick={onClose}>✕ Close</button>
          <button className="DOC_GEN_BTN_SAVE" onClick={handleSaveAndDownload} disabled={isSaving}>
            {isSaving ? '⏳ Processing…' : '⬇ Print / Download'}
          </button>
        </div>
      </div>

      <div className="DOC_GEN_BODY">

        {/* ── SIDEBAR ── */}
        <div className="DOC_GEN_SIDE_PANEL" style={{ width: '340px', gap: '14px' }}>

          <div className="DOC_GEN_PANEL_HEADER" style={{ fontSize: '1rem' }}>
            📋 Form Configuration
          </div>

          {/* ── SECTION: DOCUMENT TYPE ── */}
          <SidebarSection label="Document" />

          <div style={fieldGroup}>
            <label style={fieldLabel}>Document Type</label>
            <select value={content.type} onChange={handleTypeChange} style={{ ...fieldInput, cursor: 'pointer' }}>
              <option value="Barangay Clearance">Barangay Clearance</option>
              <option value="Certificate of Residency">Certificate of Residency</option>
              <option value="Certificate of Indigency">Certificate of Indigency</option>
              <option value="Barangay Certification">Barangay Certification (Jobseekers)</option>
              <option value="Affidavit of Barangay Official">Affidavit of Barangay Official</option>
            </select>
          </div>

          <div style={twoColGrid}>
            <div style={fieldGroup}>
              <label style={fieldLabel}>Certificate No.</label>
              <input
                style={fieldInput}
                value={content.certificateNo}
                onChange={e => setContent(prev => ({ ...prev, certificateNo: e.target.value }))}
                placeholder="2025-07-00"
              />
            </div>
            <div style={fieldGroup}>
              <label style={fieldLabel}>Date Issued</label>
              <input
                type="date"
                style={fieldInput}
                value={content.dateIssued}
                onChange={e => setContent(prev => ({ ...prev, dateIssued: e.target.value }))}
              />
            </div>
          </div>

          {/* ── SECTION: RESIDENT ── */}
          <SidebarSection label="Resident" />

          <div style={{ ...fieldGroup, position: 'relative' }} ref={searchWrapperRef}>
            <label style={fieldLabel}>Requestor Name</label>
            <input
              type="text"
              style={fieldInput}
              value={content.residentName}
              onChange={handleNameChange}
              onFocus={() => { if (filteredResidents.length > 0) setShowDropdown(true); }}
              placeholder="Search or type name…"
            />
            {showDropdown && filteredResidents.length > 0 && (
              <ul className="DOC_GEN_DROPDOWN">
                {filteredResidents.slice(0, 8).map(r => (
                  <li key={r.record_id} onClick={() => selectResident(r)}>
                    <span className="DOC_GEN_RES_NAME">
                      {formatToProperName(r.first_name, r.middle_name, r.last_name)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div style={fieldGroup}>
            <label style={fieldLabel}>Residential Address</label>
            <input
              style={fieldInput}
              value={content.address}
              onChange={e => setContent(prev => ({ ...prev, address: e.target.value.toUpperCase() }))}
              placeholder="Street / Purok / Barangay"
            />
          </div>

          <div style={fieldGroup}>
            <label style={fieldLabel}>Purpose</label>
            <textarea
              style={fieldTextarea}
              value={content.purpose}
              onChange={e => setContent(prev => ({ ...prev, purpose: e.target.value }))}
              placeholder="State the purpose of this document…"
            />
          </div>

          {/* ── SECTION: PAYMENT ── */}
          <SidebarSection label="Payment & Reference" color="#1e3a5f" />

          <div style={twoColGrid}>
            <div style={fieldGroup}>
              <label style={fieldLabel}>O.R. No.</label>
              <input
                style={fieldInput}
                value={content.orNo}
                onChange={e => setContent(prev => ({ ...prev, orNo: e.target.value }))}
                placeholder="OR0000"
              />
            </div>
            {hasCTC ? (
              <div style={fieldGroup}>
                <label style={fieldLabel}>CTC No.</label>
                <input
                  style={fieldInput}
                  value={content.ctcNo}
                  onChange={e => setContent(prev => ({ ...prev, ctcNo: e.target.value }))}
                  placeholder="e.g. 12345678"
                />
              </div>
            ) : (
              <div style={fieldGroup}>
                <label style={fieldLabel}>Fees Paid (₱)</label>
                <input
                  style={{ ...fieldInput, color: isCertification ? '#94a3b8' : '#1e293b' }}
                  value={isCertification ? 'FREE (RA 11261)' : content.feesPaid}
                  readOnly={isCertification}
                  onChange={e => setContent(prev => ({ ...prev, feesPaid: e.target.value }))}
                />
              </div>
            )}
          </div>

          {hasCTC && hasFees && (
            <div style={fieldGroup}>
              <label style={fieldLabel}>Fees Paid (₱)</label>
              <input
                style={fieldInput}
                value={content.feesPaid}
                onChange={e => setContent(prev => ({ ...prev, feesPaid: e.target.value }))}
                placeholder="200.00"
              />
            </div>
          )}

          {isCertification && (
            <div style={{
              background: '#f0fdf4',
              border: '1.5px solid #86efac',
              borderRadius: '8px',
              padding: '10px 12px',
              fontSize: '0.78rem',
              color: '#166534',
              fontWeight: 600,
              lineHeight: '1.5',
            }}>
              ✅ <strong>RA 11261 (FTJAA)</strong> — This certification is issued FREE of charge. Two-page output (Form 1 + Oath of Undertaking Form 2).
            </div>
          )}

          {/* ── SPACER ── */}
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: '0.7rem', color: '#94a3b8', textAlign: 'center', paddingTop: '8px', borderTop: '1px solid #e2e8f0' }}>
            Ref# {data.referenceNo || '—'} &nbsp;·&nbsp; {content.type}
          </div>
        </div>

        {/* ── PREVIEW AREA ── */}
        <div className="DOC_GEN_PREVIEW_AREA" style={{ overflowY: 'auto' }}>

          <div ref={pdfTargetRef} style={{ display: 'flex', flexDirection: 'column', gap: '40px', alignItems: 'center' }}>

            {/* ═══════════════════════════════════════════════
                PAGE 1 — MAIN CERTIFICATE
                Fixed layout: flex column inside strict 297mm box.
                Content sections sized to never overflow.
            ═══════════════════════════════════════════════ */}
            <div
              className="DOC_GEN_A4_PAGE"
              style={{ position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            >
              {/* Watermark */}
              <img src={brgyLogo} alt="Seal" className="DOC_WATERMARK" />

              {/* ── HEADER BLOCK ─────────────────────────────
                  FIXED: plain header now uses proper flex row,
                  no absolute-positioned logo fighting the text.
              ─────────────────────────────────────────────── */}
              {hasPlainHeader ? (
                /* PLAIN HEADER (Certification / Affidavit) */
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  marginBottom: '10px',
                  position: 'relative',
                  zIndex: 5,
                }}>
                  {/* Left logo */}
                  <img
                    src={brgyLogo}
                    alt="Brgy"
                    style={{ width: '78px', height: '78px', objectFit: 'contain', flexShrink: 0 }}
                  />

                  {/* Center text block */}
                  <div style={{ flex: 1, textAlign: 'center', lineHeight: '1.35' }}>
                    <p style={{ margin: 0, fontSize: '10pt', fontWeight: 400 }}>Republic of the Philippines</p>
                    <p style={{ margin: '2px 0', fontSize: '13.5pt', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Engineer's Hill Barangay
                    </p>
                    <p style={{ margin: 0, fontSize: '10pt' }}>Baguio City</p>
                    <p style={{ margin: 0, fontSize: '9.5pt' }}>074-422-8228</p>
                    <p style={{ margin: 0, fontSize: '9pt', color: '#2e7d32' }}>enrqshill2600@gmail.com</p>
                  </div>

                  {/* Right: Certificate number badge */}
                  <div style={{
                    textAlign: 'right',
                    fontSize: '8.5pt',
                    fontWeight: 700,
                    color: '#1e3a2f',
                    flexShrink: 0,
                    maxWidth: '130px',
                    lineHeight: '1.4',
                  }}>
                    <span style={{ display: 'block', color: '#64748b', fontSize: '7.5pt', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Barangay Certificate No.
                    </span>
                    <span style={{ display: 'block', fontSize: '9.5pt', fontWeight: 900 }}>{content.certificateNo}</span>
                  </div>
                </div>
              ) : (
                /* STANDARD HEADER (Clearance / Residency / Indigency) */
                <div className="DOC_HEADER_ROW" style={{ marginBottom: '10px' }}>
                  <div className="DOC_LOGO_BOX">
                    <img src={brgyLogo} alt="Brgy" className="DOC_LOGO_IMG" />
                  </div>
                  <div className="DOC_BANNER_GREEN">
                    <p>REPUBLIC OF THE PHILIPPINES</p>
                    <p>CITY OF BAGUIO</p>
                    <p className="BANNER_BRGY_NAME">ENGINEER'S HILL BARANGAY</p>
                  </div>
                  <div className="DOC_LOGO_BOX">
                    <img src={baguioLogo} alt="Baguio" className="DOC_LOGO_IMG" />
                  </div>
                </div>
              )}

              {/* ── TITLE BLOCK ────────────────────────────── */}
              <div style={{
                textAlign: 'center',
                marginBottom: isCertification ? '12px' : '18px',
                position: 'relative',
                zIndex: 5,
              }}>
                {isResidency && (
                  <div style={{ fontWeight: 700, fontSize: '12pt', marginBottom: '12px', textTransform: 'uppercase' }}>
                    OFFICE OF THE PUNONG BARANGAY
                  </div>
                )}
                <h1 style={{
                  fontWeight: 900,
                  fontSize: isCertification ? '20pt' : '22pt',
                  textTransform: 'uppercase',
                  margin: 0,
                  letterSpacing: '1px',
                  textDecoration: 'underline',
                  textUnderlineOffset: '4px',
                }}>
                  {content.type.toUpperCase()}
                </h1>
                {isCertification && (
                  <p style={{ margin: '6px 0 0 0', fontSize: '10.5pt', fontWeight: 700 }}>
                    (FIRST TIME JOBSEEKERS ASSISTANCE ACT – RA 11261)
                  </p>
                )}
                {isAffidavit && (
                  <p style={{ margin: '5px 0 0 0', fontSize: '11pt', fontWeight: 700 }}>
                    THAT A PARENT IS A RESIDENT OF THIS BARANGAY
                  </p>
                )}
              </div>

              {/* ── RICH EDITABLE CONTENT ────────────────────
                  Uses dangerouslySetInnerHTML on first render,
                  then contentEditable for live editing.
              ─────────────────────────────────────────────── */}
              <div
                key={contentKey}
                style={richContentStyle}
                className="DOC_RICH_CONTENT"
                contentEditable
                ref={previewRef}
                suppressContentEditableWarning
                dangerouslySetInnerHTML={{ __html: getTemplateContent() }}
              />

              {/* ── SIGNATURE SECTION ────────────────────────── */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-end',
                marginTop: isCertification ? '14px' : '24px',
                padding: '0 8px',
                position: 'relative',
                zIndex: 5,
                flexShrink: 0,
              }}>
                {/* Left side — witness / resident signature */}
                {isClearance && (
                  <div style={{ width: '38%', textAlign: 'center' }}>
                    <div style={{ borderTop: '1px solid #000', paddingTop: '4px', marginTop: '48px', fontWeight: 700, fontSize: '10.5pt' }}>
                      Signature of Resident
                    </div>
                  </div>
                )}

                {isAffidavit && (
                  <div style={{ width: '48%', textAlign: 'left', marginTop: '30px', fontSize: '10.5pt' }}>
                    <p style={{ fontWeight: 700, marginBottom: '12px' }}>Witnesses:</p>
                    <p style={{ margin: '4px 0' }}><b>Name:</b> MARYELLA KRYZELLE L. ESLAVA</p>
                    <p style={{ margin: '4px 0' }}><b>Address:</b> 125 Lagerra Alley, Engr's Hill</p>
                    <p style={{ margin: '4px 0' }}><b>Contact No:</b> 09676847922</p>
                  </div>
                )}

                {/* Right side — punong barangay */}
                <div style={{
                  width: isCertification ? '58%' : '44%',
                  marginLeft: 'auto',
                  textAlign: isCertification ? 'left' : 'center',
                  paddingLeft: isCertification ? '60px' : '0',
                }}>
                  <p style={{
                    fontWeight: 900,
                    fontSize: '12.5pt',
                    margin: '0 0 0 0',
                    borderBottom: '1.5px solid #000',
                    display: 'inline-block',
                    minWidth: '240px',
                    textAlign: 'center',
                    paddingBottom: '2px',
                  }}>
                    {displayCaptainName.toUpperCase()}
                  </p>
                  <p style={{ fontSize: '10pt', margin: '3px 0 0 0', textAlign: 'center', textTransform: 'uppercase' }}>
                    {displayCaptainPosition}
                  </p>

                  {isCertification && (
                    <div style={{ marginTop: '14px', fontSize: '10.5pt' }}>
                      <p style={{ margin: '10px 0' }}>
                        {new Date(content.dateIssued).toLocaleDateString('en-US', {
                          month: 'long', day: '2-digit', year: 'numeric', timeZone: 'UTC',
                        })}
                      </p>
                      <p style={{ margin: '14px 0 14px 0', fontWeight: 600 }}>Witnessed by:</p>
                      <p style={{
                        fontWeight: 900,
                        fontSize: '12pt',
                        margin: '0',
                        borderBottom: '1.5px solid #000',
                        display: 'inline-block',
                        minWidth: '220px',
                        textAlign: 'center',
                        paddingBottom: '2px',
                      }}>
                        CHARITO A. GUMAD-ANG
                      </p>
                      <p style={{ fontSize: '10pt', margin: '3px 0 0 0', textAlign: 'center', textTransform: 'uppercase' }}>
                        Barangay Kagawad
                      </p>
                      <p style={{ margin: '10px 0 0 0' }}>
                        {new Date(content.dateIssued).toLocaleDateString('en-US', {
                          month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
                        })}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* ── STAMP BOX ─────────────────────────────────── */}
              {hasStampBox && (
                <div style={{
                  border: '2px solid #000',
                  padding: '12px 16px',
                  width: '310px',
                  marginTop: '16px',
                  marginLeft: 'auto',
                  marginRight: '8px',
                  flexShrink: 0,
                  position: 'relative',
                  zIndex: 5,
                  background: '#fff',
                }}>
                  <div style={{ fontWeight: 900, fontSize: '9.5pt', textAlign: 'center', marginBottom: '14px', textTransform: 'uppercase' }}>
                    "Documentary Stamp Tax Paid"
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '16px' }}>
                    <div style={{ flex: 1, textAlign: 'center' }}>
                      <div style={{ fontWeight: 700, fontSize: '10.5pt', marginBottom: '2px' }}>
                        {content.orNo || '____________'}
                      </div>
                      <div style={{ borderTop: '1.5px solid #000', marginBottom: '4px' }} />
                      <div style={{ fontSize: '8.5pt', fontWeight: 800, textTransform: 'uppercase' }}>GOR Serial Number</div>
                    </div>
                    <div style={{ flex: 1, textAlign: 'center' }}>
                      <div style={{ fontWeight: 700, fontSize: '10.5pt', marginBottom: '2px' }}>
                        {new Date(content.dateIssued).toLocaleDateString('en-US', {
                          day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
                        })}
                      </div>
                      <div style={{ borderTop: '1.5px solid #000', marginBottom: '4px' }} />
                      <div style={{ fontSize: '8.5pt', fontWeight: 800, textTransform: 'uppercase' }}>Date of Payment</div>
                    </div>
                  </div>
                </div>
              )}

              {/* ── BOTTOM METADATA ROW ───────────────────────── */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '9pt',
                marginTop: hasStampBox ? '8px' : '14px',
                padding: '0 4px',
                flexShrink: 0,
                position: 'relative',
                zIndex: 5,
              }}>
                <div>
                  <p style={{ margin: '2px 0' }}>CTC NO: {content.ctcNo || 'N/A'}</p>
                  <p style={{ margin: '2px 0' }}>ISSUED AT: Engr's Hill, Baguio City</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ margin: '2px 0' }}>FEES PAID: ₱ {isCertification ? '0.00 (FREE)' : content.feesPaid}</p>
                  <p style={{ margin: '2px 0' }}>
                    DATE: {new Date(content.dateIssued).toLocaleDateString('en-US', {
                      month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
                    })}
                  </p>
                </div>
              </div>

              {/* ── GREEN FOOTER ──────────────────────────────── */}
              <div style={{
                borderTop: '2px solid #1e4d2b',
                paddingTop: '8px',
                marginTop: '10px',
                textAlign: 'center',
                fontWeight: 700,
                color: '#1e4d2b',
                fontSize: '9pt',
                flexShrink: 0,
                position: 'relative',
                zIndex: 5,
              }}>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '32px', marginBottom: '3px' }}>
                  <span>✉ enrqshill2600@gmail.com</span>
                  <span>📞 074-422-8228</span>
                </div>
                <p style={{ margin: 0, fontWeight: 800 }}>📍 Engineer's Hill Barangay, Baguio City</p>
              </div>

              {/* ── FORM TAG (Certification only) ─────────────── */}
              {isCertification && (
                <div style={{
                  position: 'absolute',
                  bottom: '22px',
                  left: '20mm',
                  fontSize: '8.5pt',
                  fontWeight: 700,
                  fontFamily: 'Arial, sans-serif',
                  lineHeight: '1.4',
                }}>
                  THIS FORM NEED NOT BE NOTARIZED<br />11261 Form 1
                </div>
              )}
            </div>

            {/* ═══════════════════════════════════════════════
                PAGE 2 — OATH OF UNDERTAKING (Certification only)
                Second page is UNTOUCHED per user instruction.
            ═══════════════════════════════════════════════ */}
            {isCertification && (
              <div
                className="DOC_GEN_A4_PAGE"
                style={{ position: 'relative', padding: '15mm 20mm', boxSizing: 'border-box', backgroundColor: 'white' }}
              >
                <div style={{ fontSize: '10.5pt', lineHeight: '1.4', textAlign: 'justify', fontFamily: 'Arial, sans-serif', paddingBottom: '60px' }}>
                  <p style={{ textAlign: 'right', fontStyle: 'italic', fontSize: '9.5pt', margin: '0 0 15px 0' }}>Revised as of 16 June 2021</p>
                  <h2 style={{ textAlign: 'center', margin: '0 0 5px 0', fontSize: '13pt', textDecoration: 'underline' }}>OATH OF UNDERTAKING</h2>
                  <p style={{ textAlign: 'center', margin: '0 0 20px 0', fontSize: '10.5pt', fontWeight: 'bold' }}>
                    Republic Act 11261 – First Time Jobseekers Assistance Act
                  </p>

                  <p>
                    I, <b>{content.residentName || '_________________________'}</b>, ________ years of age, resident of{' '}
                    <b>{content.address || '_________________________'}</b> for ________ Years, availing the benefits of{' '}
                    <b>Republic Act 11261</b>, otherwise known as the{' '}
                    <b>First Time Jobseekers Act of 2019</b>, do hereby declare, agree and undertake to abide and be bound by the following:
                  </p>

                  <ol style={{ paddingLeft: '30px', margin: '15px 0' }}>
                    <li style={{ marginBottom: '6px' }}>That this is the first time that I will actively look for a job, and therefore requesting that a Barangay Certification be issued in my favor to avail the benefits of the law;</li>
                    <li style={{ marginBottom: '6px' }}>That I am aware that the benefit and privilege/s under the said law shall be valid only for one (1) year from the date that the Barangay Certification is issued;</li>
                    <li style={{ marginBottom: '6px' }}>That I can avail the benefits of the law only once;</li>
                    <li style={{ marginBottom: '6px' }}>That I understand that my personal information shall be included in the Roster /List of First Time Jobseekers and will not be used for any unlawful purpose;</li>
                    <li style={{ marginBottom: '6px' }}>That I will inform and/or report to the Barangay personally, through text or other means, or through my family/relatives once I get employed;</li>
                    <li style={{ marginBottom: '6px' }}>That I am not a beneficiary of the Job start Program under R.A. No. 10869 and other laws that give similar exemptions for the documents or transactions exempted under R.A No. 11261;</li>
                    <li style={{ marginBottom: '6px' }}>That if issued the requested Certification, I will not use the same in any fraud, neither falsify nor help and/or assist in the fabrication of the said certification;</li>
                    <li style={{ marginBottom: '6px' }}>That this undertaking is made solely for the purpose of obtaining a Barangay Certification consistent with the objective of R.A No. 11261 and not for any other purpose; and</li>
                    <li style={{ marginBottom: '6px' }}>That I consent to the use of my personal information pursuant to the Data Privacy Act and other applicable laws, rules and regulations.</li>
                  </ol>

                  <p style={{ margin: '20px 0' }}>
                    Signed this <b>{issuedDayWithSuffix}</b> day of <b>{issuedMonthYear}</b> in the Engineer's Hill Barangay, Baguio City.
                  </p>

                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '20px' }}>
                    <div style={{ width: '45%' }}>
                      <p style={{ margin: '0 0 25px 0' }}>Signed by:</p>
                      <div style={{ borderBottom: '1px solid black', textAlign: 'center', fontWeight: 'bold', fontSize: '11pt' }}>
                        {content.residentName || '_________________________'}
                      </div>
                      <p style={{ textAlign: 'center', margin: '5px 0 0 0' }}>First Time Jobseeker</p>
                    </div>
                    <div style={{ width: '45%' }}>
                      <p style={{ margin: '0 0 25px 0' }}>Witnessed by:</p>
                      <div style={{ borderBottom: '1px solid black', textAlign: 'center', fontWeight: 'bold', fontSize: '11pt' }}>
                        {displayCaptainName.toUpperCase()}
                      </div>
                      <p style={{ textAlign: 'center', margin: '5px 0 0 0' }}>Punong Barangay</p>
                    </div>
                  </div>

                  <div style={{ marginTop: '25px' }}>
                    <p style={{ fontWeight: 'bold', marginBottom: '10px' }}>For applicants at least fifteen years old to less than 18 years of age:</p>
                    <p style={{ lineHeight: '1.6' }}>
                      I, ____________________________________________________, ________ years of age, parent/guardian of{' '}
                      ____________________________________________________, and a resident of{' '}
                      _________________________________________________________________ (complete address), for ________ (years/months),
                      do hereby give my consent for my child/dependent to avail the benefits of{' '}
                      <b>Republic Act 11261</b> and be bound by the abovementioned conditions.
                    </p>
                  </div>

                  <div style={{ marginTop: '20px', width: '45%' }}>
                    <p style={{ margin: '0 0 25px 0' }}>Signed by:</p>
                    <div style={{ borderBottom: '1px solid black', textAlign: 'center', fontWeight: 'bold' }}></div>
                    <p style={{ textAlign: 'center', margin: '5px 0 0 0', fontWeight: 'bold' }}>Parent/Guardian</p>
                  </div>

                  <div style={{ position: 'absolute', bottom: '20px', left: '40px', fontSize: '9pt', fontWeight: 'bold', fontFamily: 'Arial, sans-serif' }}>
                    THIS FORM NEED NOT BE NOTARIZED<br />11261 Form 2
                  </div>
                </div>
              </div>
            )}

          </div>{/* end pdfTargetRef */}
        </div>{/* end preview area */}
      </div>{/* end body */}
    </div>
  );
};