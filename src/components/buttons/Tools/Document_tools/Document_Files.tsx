import React, { useState, useEffect, useRef } from 'react';
import './styles/Documeent_File.css';
import { useDocumentDataAPI, calculateAge } from './Types/Doc_data_api';
import { useDocumentEngine } from './Document_Engine';
import { DOCUMENT_OPTIONS, FEE_BY_TYPE, getSchemaById } from './Barangay_Documents/schemaRegistry';
import type { SidebarSection } from './PDF_Algorithm';

interface DocumentFileProps {
  onClose: () => void;
  onSuccess?: () => void;
  initialData?: any;
}

// ═══════════════════════════════════════════════════════════════════════════
// Fees + dropdown options are now derived from each schema's self-describing
// `meta` (via the registry) — there is no parallel list to keep in sync here.
// ═══════════════════════════════════════════════════════════════════════════
const TYPE_FEE_MAP = FEE_BY_TYPE;
const DROPDOWN_OPTIONS = DOCUMENT_OPTIONS.map(o => o.id);

// ═══════════════════════════════════════════════════════════════════════════
// 🎯 THE DROPDOWN FIX — TYPE NORMALIZER
// ───────────────────────────────────────────────────────────────────────────
// Problem: the admin list/queue passes initialData to this editor, but:
//   • the key might be `type`, `documentType`, `document_type`, or `docType`
//   • the value might be the DB's `'Barangay Certificate (jobseeker)'`, an
//     id like `'biz_permit'`, or a casing variant — NONE of which match an
//     <option value="..."> in the dropdown.
// When the controlled <select>'s value has no matching option, the browser
// silently shows the FIRST option (Barangay Clearance) — making it look like
// the editor "didn't fetch" the type. This normalizer maps anything sensible
// to one of the five real dropdown options so the <select> always reflects
// the actual document being edited.
// ═══════════════════════════════════════════════════════════════════════════
const normalizeDocumentType = (raw: any): string => {
  if (!raw) return 'Barangay Clearance';
  const s = String(raw).toLowerCase().trim();

  // 1. Exact match against a real option (fast path)
  for (const opt of DROPDOWN_OPTIONS) {
    if (opt.toLowerCase() === s) return opt;
  }

  // 2. Keyword match — covers DB variants, IDs, and casing differences
  if (s.includes('indigen')) return 'Certificate of Indigency';
  if (s.includes('residen')) return 'Certificate of Residency';
  if (s.includes('affidavit') || s.includes('good_moral') || s.includes('good moral')) {
    return 'Affidavit of Barangay Official';
  }
  if (s.includes('jobseeker') || s.includes('biz_permit') || s.includes('certification')) {
    return 'Barangay Certification';
  }
  if (s.includes('clearance') || s.includes('brgy_clearance')) {
    return 'Barangay Clearance';
  }

  // 3. Final fallback
  return 'Barangay Clearance';
};

// Pull `type` out of whatever key variant the parent used.
const extractRawType = (data: any): string | undefined => {
  if (!data) return undefined;
  return data.type
      || data.documentType
      || data.document_type
      || data.docType
      || data.doc_type
      || data.request_type;
};

import { A4Ruler } from './A4Ruler';
import { DocumentToolbar } from './DocumentToolbar';

export const DocumentFile: React.FC<DocumentFileProps> = ({ onClose, onSuccess, initialData }) => {
  const [zoom, setZoom] = useState<number>(100);
  const [moveMode, setMoveMode] = useState<boolean>(false); // 🧲 free-drag layout mode
  const [showDropdown, setShowDropdown] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Skip the very first run of the type→fees auto-sync so we never overwrite
  // a feesPaid value that came in via initialData.
  const isInitialTypeMount = useRef(true);
  // Track which initialData record we last initialized from, so opening a
  // DIFFERENT document inside the same mounted editor still re-syncs the type.
  const lastInitialIdRef = useRef<any>(initialData?.id ?? null);

  // 🎯 Resolve the initial dropdown value ONCE, normalized.
  const normalizedInitialType = normalizeDocumentType(extractRawType(initialData));

  const [docConfig, setDocConfig] = useState({
    id: initialData?.id || null,

    // 🧲 Per-block drag displacements (mm), keyed by render key. Empty = pristine flow.
    layout: (initialData?.layout || {}) as Record<string, { dx: number; dy: number }>,

    residentId: initialData?.residentId || '',
    residentName: initialData?.residentName || '',
    address: '',
    type: normalizedInitialType,
    purpose: initialData?.purpose || '',
    dateIssued: new Date().toISOString().split('T')[0],
    ctcNo: '',
    orNo: '',
    paymentDate: new Date().toISOString().split('T')[0], // Documentary stamp: Date of Payment
    feesPaid:
      initialData?.feesPaid ||
      TYPE_FEE_MAP[normalizedInitialType] ||
      '200.00',
    certificateNo: `2026-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`,
    age: initialData?.age || '', // 🎂 requestor age — auto-filled from the resident's dob
    guardianName: '',
    guardianAge: '',
    guardianAddress: '',
    guardianResidency: '',
    tableRows: [['', '', '']],

    witnesses: initialData?.witnesses || [
      { name: '', address: '', contactNo: '' }
    ],

    status: (!initialData?.status || initialData?.status === 'Pending') ? 'Processing' : initialData.status,
    requestMethod: initialData?.requestMethod || 'Walk-in',
  });

  const refNumber = useRef(
    initialData?.referenceNo || `WALK-IN-${Date.now().toString().slice(-6)}`
  ).current;

  const { residents, captainName, kagawadName, captainSignatureUrl: rawCaptainSignatureUrl, kagawadSignatureUrl: rawKagawadSignatureUrl, autoFilledAddress, autoFilledAge } = useDocumentDataAPI(
    docConfig.residentName,
    docConfig.residentId
  );

  // 🛡️ SIGNATURE GATE: a manually-created walk-in is completed by staff on the
  // spot, so the signature is expected immediately. An online (resident-submitted)
  // request only earns the real signature once it's actually been approved —
  // i.e. moved past Pending/Processing to Ready/Completed via the pipeline's
  // "Manage" actions (Document.tsx) — not the instant someone merely opens it
  // for review. Until then, the reserved signature space stays blank (schemas
  // already treat `undefined` as "no signature on file", so this is a fully
  // supported, no-regression state).
  const isWalkIn = docConfig.requestMethod === 'Walk-in';
  const isApproved = docConfig.status === 'Ready' || docConfig.status === 'Completed';
  const signatureUnlocked = isWalkIn || isApproved;
  const captainSignatureUrl = signatureUnlocked ? rawCaptainSignatureUrl : undefined;
  const kagawadSignatureUrl = signatureUnlocked ? rawKagawadSignatureUrl : undefined;

  // ═══════════════════════════════════════════════════════════════════════════
  // 🛡️ RE-SYNC ON initialData CHANGE
  // When the parent passes a DIFFERENT document (e.g. admin clicks another
  // request in the queue without unmounting the editor), reinitialize the
  // dropdown + fees + id from that new record. Without this, the editor would
  // be stuck on whatever was opened first.
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    const incomingId = initialData?.id ?? null;
    if (incomingId !== lastInitialIdRef.current) {
      lastInitialIdRef.current = incomingId;
      const t = normalizeDocumentType(extractRawType(initialData));
      setDocConfig(prev => {
        // 🖊️ Drop the previous record's surface edits + drag offsets so they don't
        // bleed onto a different document opened in the same mounted editor.
        const base = Object.fromEntries(
          Object.entries(prev).filter(([k]) => !k.startsWith('surface::'))
        ) as typeof prev;
        return {
          ...base,
          layout: {},
          id: incomingId,
          type: t,
          residentId: initialData?.residentId || prev.residentId,
          residentName: initialData?.residentName || prev.residentName,
          purpose: initialData?.purpose || prev.purpose,
          feesPaid: initialData?.feesPaid || TYPE_FEE_MAP[t] || prev.feesPaid,
          status: (!initialData?.status || initialData?.status === 'Pending') ? 'Processing' : initialData.status,
          requestMethod: initialData?.requestMethod || prev.requestMethod,
        };
      });
      // The auto-sync effect below would otherwise overwrite the freshly set
      // feesPaid; treat this as another "initial" run to keep them aligned.
      isInitialTypeMount.current = true;
    }
  }, [initialData]);

  // ═══════════════════════════════════════════════════════════════════════════
  // Type → Fees cascade: when the admin manually changes the dropdown, sync
  // feesPaid to match. Skips the initial mount + any re-init from initialData.
  // 🧹 Picking a new type loads a fresh "ready layout": because drag offsets and
  // surface edits are keyed by block position, they'd misapply to a different
  // schema — so we reset them here. Switching type = a clean template, like
  // clicking a layout in Word's gallery.
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (isInitialTypeMount.current) {
      isInitialTypeMount.current = false;
      return;
    }
    setDocConfig(prev => {
      const base = Object.fromEntries(
        Object.entries(prev).filter(([k]) => !k.startsWith('surface::'))
      ) as typeof prev;
      const mapped = TYPE_FEE_MAP[prev.type];
      return {
        ...base,
        layout: {},
        feesPaid: mapped !== undefined ? mapped : prev.feesPaid,
      };
    });
  }, [docConfig.type]);

  const handleSurfaceEdit = (key: string, value: string) => {
    setDocConfig(prev => {
      if (key.startsWith('table_action-')) {
        const parts = key.split('-');
        const action = parts[1];
        const rIdx = parseInt(parts[2], 10);
        const newTableRows = [...(prev.tableRows || [])];
        if (action === 'add') {
          const colCount = newTableRows[rIdx] ? newTableRows[rIdx].length : 3;
          newTableRows.splice(rIdx + 1, 0, new Array(colCount).fill(''));
        } else if (action === 'remove') {
          newTableRows.splice(rIdx, 1);
        }
        return { ...prev, tableRows: newTableRows };
      }
      if (key.startsWith('table-')) {
        const parts = key.split('-');
        const rIdx = parseInt(parts[2], 10);
        const cIdx = parseInt(parts[3], 10);
        const newTableRows = [...(prev.tableRows || [])];
        if (!newTableRows[rIdx]) newTableRows[rIdx] = [];
        newTableRows[rIdx][cIdx] = value.replace(/<[^>]*>/g, '').trim();
        return { ...prev, tableRows: newTableRows };
      }
      if (key.startsWith('witness-')) {
        const parts = key.split('-');
        const wIdx = parseInt(parts[1]);
        const field = parts[2];
        const newWitnesses = [...(prev.witnesses || [])];
        if (!newWitnesses[wIdx]) newWitnesses[wIdx] = { name: '', address: '', contactNo: '' };
        const plain = value.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
        newWitnesses[wIdx] = { ...newWitnesses[wIdx], [field]: plain };
        return { ...prev, witnesses: newWitnesses };
      }
      return { ...prev, [key]: value };
    });
  };

  const handleWitnessChange = (idx: number, field: 'name' | 'address' | 'contactNo', value: string) => {
    setDocConfig(prev => {
      const newWitnesses = [...(prev.witnesses || [])];
      if (!newWitnesses[idx]) newWitnesses[idx] = { name: '', address: '', contactNo: '' };
      newWitnesses[idx] = { ...newWitnesses[idx], [field]: value };
      return { ...prev, witnesses: newWitnesses };
    });
  };

  const handleRemoveWitness = (idx: number) => {
    setDocConfig(prev => {
      const newWitnesses = (prev.witnesses || []).filter((_: any, i: number) => i !== idx);
      return {
        ...prev,
        witnesses: newWitnesses.length > 0 ? newWitnesses : [{ name: '', address: '', contactNo: '' }]
      };
    });
  };

  // 🧲 Commit a block's dragged position (mm offset) into the layout map.
  const handleMove = (key: string, dx: number, dy: number) => {
    setDocConfig(prev => ({
      ...prev,
      layout: { ...(prev.layout || {}), [key]: { dx, dy } },
    }));
  };

  // Snap every block back to its natural flow position AND discard surface text
  // edits, restoring the schema's generated wording.
  const handleResetLayout = () => {
    setDocConfig(prev => {
      const base = Object.fromEntries(
        Object.entries(prev).filter(([k]) => !k.startsWith('surface::'))
      ) as typeof prev;
      return { ...base, layout: {} };
    });
  };

  const { pages, wordCount, isProcessing, handleSaveAndDownload } = useDocumentEngine(
    docConfig,
    captainName,
    kagawadName,
    handleSurfaceEdit,
    { moveMode, zoom, layout: docConfig.layout, onMove: handleMove },
    captainSignatureUrl,
    kagawadSignatureUrl
  );

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setDocConfig(prev => ({ ...prev, [name]: value }));
  };

  const handleResidentSelect = (resident: any) => {
    const fullName = `${resident.first_name} ${resident.last_name}`.trim();
    const fullAddress = [resident.current_address, resident.purok].filter(Boolean).join(', ');
    const derivedAge = calculateAge(resident.dob); // 🎂 from the selected resident's dob

    setDocConfig(prev => ({
      ...prev,
      residentId: resident.record_id,
      residentName: fullName,
      address: fullAddress && fullAddress.toLowerCase() !== 'n/a' ? fullAddress : prev.address,
      age: derivedAge || prev.age,
    }));
    setShowDropdown(false);
    setIsSidebarOpen(false);
  };

  const executePrintAndSave = async () => {
    const success = await handleSaveAndDownload();
    if (success) {
      if (onSuccess) onSuccess();
      onClose();
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (autoFilledAddress && !docConfig.address) {
      setDocConfig(prev => ({ ...prev, address: autoFilledAddress }));
    }
  }, [autoFilledAddress]);

  // 🎂 Same concept as the address autofill: drop in the resident's age once resolved.
  useEffect(() => {
    if (autoFilledAge && !docConfig.age) {
      setDocConfig(prev => ({ ...prev, age: autoFilledAge }));
    }
  }, [autoFilledAge]);

  // 🧩 INPUT ISOLATION: the active document declares which sidebar sections it
  // needs (via its self-describing meta). We render only those — so a field that
  // belongs to one document type never appears (or misleads) on another.
  const activeFields: SidebarSection[] = getSchemaById(docConfig.type).meta?.fields ?? [];
  const hasField = (section: SidebarSection) => activeFields.includes(section);

  return (
    <div className="doc-app-shell">
      <header className="doc-topbar">
        <button className="mobile-menu-btn" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>☰</button>

        <div className="topbar-left hidden-mobile">
          <div className="brand-wrap">
            <span className="brand-icon">🖨️</span>
            <span className="brand-text">Brgy Doc</span>
          </div>
        </div>

        <div className="topbar-center">
          <div className="zoom-tools hidden-mobile">
            <button className="tool-btn" onClick={() => setZoom(z => Math.max(50, z - 10))}>-</button>
            <span className="zoom-label">{zoom}%</span>
            <button className="tool-btn" onClick={() => setZoom(z => Math.min(200, z + 10))}>+</button>
          </div>
          {/* 🧲 Layout drag controls */}
          <div className="zoom-tools layout-tools hidden-mobile">
            <button
              className={`tool-btn ${moveMode ? 'active' : ''}`}
              title={moveMode ? 'Move mode ON — drag any block. Click to exit.' : 'Move mode — drag blocks anywhere'}
              onClick={() => setMoveMode(m => !m)}
            >
              ✥
            </button>
            <button className="tool-btn" title="Reset positions & surface edits to default" onClick={handleResetLayout}>⟲</button>
          </div>
          <div className="doc-title-display hidden-mobile">{docConfig.type}</div>
        </div>

        <div className="topbar-right">
          <button className="btn-close" onClick={onClose}>✕ Close</button>
          <button className="btn-print" onClick={executePrintAndSave} disabled={isProcessing}>
            {isProcessing ? 'Processing...' : '↓ Print / Download'}
          </button>
        </div>
      </header>

      {/* 🎀 MS365-style formatting ribbon — explicit, hardcoded tools */}
      <DocumentToolbar />

      <div className="doc-workspace">
        {isSidebarOpen && (
          <div className="sidebar-overlay" onClick={() => setIsSidebarOpen(false)}></div>
        )}

        <aside className={`doc-sidebar ${isSidebarOpen ? 'open' : ''}`}>
          <div className="sidebar-header">
            <h3>📄 Form Configuration</h3>
          </div>

          <div className="sidebar-content">
            <div className="section-label text-green">DOCUMENT</div>
            <div className="field-group">
              <label>DOCUMENT TYPE <span className="req">*</span></label>
              <select name="type" className="strict-input" value={docConfig.type} onChange={handleInputChange}>
                {DOCUMENT_OPTIONS.map(o => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </div>

            {hasField('certificate') && (
              <div className="field-group-row">
                <div className="field-group">
                  <label>CERTIFICATE NO.</label>
                  <input
                    type="text"
                    name="certificateNo"
                    className="strict-input"
                    value={docConfig.certificateNo}
                    onChange={handleInputChange}
                  />
                </div>
                <div className="field-group">
                  <label>DATE ISSUED</label>
                  <input
                    type="date"
                    name="dateIssued"
                    className="strict-input"
                    value={docConfig.dateIssued}
                    onChange={handleInputChange}
                  />
                </div>
              </div>
            )}

            <div className="section-label text-blue">👤 RESIDENT</div>
            <div className="field-group relative" ref={dropdownRef}>
              <label>REQUESTOR NAME <span className="req">*</span></label>
              <input
                type="text"
                name="residentName"
                className="strict-input"
                placeholder="Search or type full name..."
                value={docConfig.residentName}
                onChange={(e) => {
                  handleInputChange(e);
                  setShowDropdown(true);
                  setDocConfig(prev => ({ ...prev, residentId: '' }));
                }}
                onFocus={() => setShowDropdown(true)}
              />
              {showDropdown && residents && residents.length > 0 && (
                <ul className="doc-dropdown-menu">
                  {residents
                    .filter(r =>
                      `${r.first_name} ${r.last_name}`
                        .toLowerCase()
                        .includes(docConfig.residentName.toLowerCase())
                    )
                    .map(r => (
                      <li
                        key={r.record_id}
                        className="doc-dropdown-item"
                        onClick={() => handleResidentSelect(r)}
                      >
                        <span className="doc-dropdown-name">{r.first_name} {r.last_name}</span>
                        <span className="doc-dropdown-meta">
                          {[r.current_address, r.purok].filter(Boolean).join(', ') || 'No address on file'}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            </div>

            <div className="field-group">
              <label>RESIDENTIAL ADDRESS <span className="req">*</span></label>
              <input
                type="text"
                name="address"
                className="strict-input"
                placeholder="Street / Purok / Barangay"
                value={docConfig.address}
                onChange={handleInputChange}
              />
            </div>

            {/* 🧩 Minor-Consent — shown only for documents that declare the 'guardian' field */}
            {hasField('guardian') && (
            <div className="dynamic-fade-in">
                <div className="section-label text-purple">📝 MINOR CONSENT (PAGE 2)</div>
                <div className="doc-hint-text" style={{ fontSize: '11px', color: '#666', marginBottom: '10px' }}>
                  Only required if the applicant is under 18 years old.
                </div>
                <div className="field-group">
                  <label>GUARDIAN NAME</label>
                  <input
                    type="text"
                    name="guardianName"
                    className="strict-input"
                    placeholder="Name of Parent/Guardian"
                    value={docConfig.guardianName}
                    onChange={handleInputChange}
                  />
                </div>
                <div className="field-group-row">
                  <div className="field-group">
                    <label>GUARDIAN AGE</label>
                    <input
                      type="number"
                      name="guardianAge"
                      className="strict-input"
                      placeholder="e.g. 45"
                      value={docConfig.guardianAge}
                      onChange={handleInputChange}
                    />
                  </div>
                  <div className="field-group">
                    <label>YEARS IN BRGY</label>
                    <input
                      type="number"
                      name="guardianResidency"
                      className="strict-input"
                      placeholder="e.g. 10"
                      value={docConfig.guardianResidency}
                      onChange={handleInputChange}
                    />
                  </div>
                </div>
                <div className="field-group">
                  <label>GUARDIAN ADDRESS</label>
                  <input
                    type="text"
                    name="guardianAddress"
                    className="strict-input"
                    placeholder="Complete Address"
                    value={docConfig.guardianAddress}
                    onChange={handleInputChange}
                  />
                </div>
              </div>
            )}
            {/* 🧩 Payment & Purpose — shown only for documents that declare the 'payment' field */}
            {hasField('payment') && (
            <div className="dynamic-fade-in">
                <div className="section-label text-orange">💰 PAYMENT & PURPOSE</div>
                <div className="field-group">
                  <label>PURPOSE</label>
                  <input
                    type="text"
                    name="purpose"
                    className="strict-input"
                    placeholder="e.g. Medical, Financial, General"
                    value={docConfig.purpose}
                    onChange={handleInputChange}
                  />
                </div>
                <div className="field-group-row">
                  <div className="field-group">
                    <label>CTC NO.</label>
                    <input
                      type="text"
                      name="ctcNo"
                      className="strict-input"
                      value={docConfig.ctcNo}
                      onChange={handleInputChange}
                    />
                  </div>
                  <div className="field-group">
                    <label>FEES PAID</label>
                    <input
                      type="text"
                      name="feesPaid"
                      className="strict-input"
                      value={docConfig.feesPaid}
                      onChange={handleInputChange}
                    />
                  </div>
                </div>
                <div className="field-group-row">
                  <div className="field-group">
                    <label>GOR SERIAL NO.</label>
                    <input
                      type="text"
                      name="orNo"
                      className="strict-input"
                      value={docConfig.orNo}
                      onChange={handleInputChange}
                    />
                  </div>
                  <div className="field-group">
                    <label>DATE OF PAYMENT</label>
                    <input
                      type="date"
                      name="paymentDate"
                      className="strict-input"
                      value={docConfig.paymentDate}
                      onChange={handleInputChange}
                    />
                  </div>
                </div>
              </div>
            )}

            {hasField('witnesses') && (
              <div className="dynamic-fade-in" style={{ marginTop: '20px' }}>
                <div className="section-label text-purple">👥 WITNESSES</div>
                <div className="doc-hint-text" style={{ fontSize: '11px', color: '#666', marginBottom: '10px' }}>
                  Enter the witnesses for this affidavit. They also appear directly editable in the document preview.
                </div>

                {(docConfig.witnesses || []).map((w: any, i: number) => (
                  <div
                    key={i}
                    style={{
                      marginBottom: '10px',
                      padding: '10px',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      background: '#fafafa',
                      position: 'relative',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '11px',
                        fontWeight: 'bold',
                        color: '#666',
                        marginBottom: '6px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span>WITNESS #{i + 1}</span>
                      {(docConfig.witnesses || []).length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveWitness(i)}
                          style={{
                            background: 'transparent',
                            border: '1px solid #c0392b',
                            color: '#c0392b',
                            cursor: 'pointer',
                            fontSize: '10px',
                            padding: '2px 8px',
                            borderRadius: '3px',
                          }}
                        >
                          ✕ Remove
                        </button>
                      )}
                    </div>
                    <div className="field-group">
                      <label>NAME</label>
                      <input
                        type="text"
                        className="strict-input"
                        placeholder="Full name"
                        value={w.name || ''}
                        onChange={(e) => handleWitnessChange(i, 'name', e.target.value)}
                      />
                    </div>
                    <div className="field-group">
                      <label>ADDRESS</label>
                      <input
                        type="text"
                        className="strict-input"
                        placeholder="Complete address"
                        value={w.address || ''}
                        onChange={(e) => handleWitnessChange(i, 'address', e.target.value)}
                      />
                    </div>
                    <div className="field-group">
                      <label>CONTACT NO</label>
                      <input
                        type="text"
                        className="strict-input"
                        placeholder="e.g. 09171234567"
                        value={w.contactNo || ''}
                        onChange={(e) => handleWitnessChange(i, 'contactNo', e.target.value)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {hasField('table') && (
              <div className="dynamic-fade-in" style={{ marginTop: '20px' }}>
                <div className="section-label text-blue">📊 TABLE CONTROLS</div>
                <button
                  type="button"
                  className="btn-print"
                  style={{ width: '100%', background: '#f0f0f0', color: '#333', border: '1px dashed #999' }}
                  onClick={() =>
                    setDocConfig(prev => ({
                      ...prev,
                      tableRows: [...(prev.tableRows || []), ['', '', '']]
                    }))
                  }
                >
                  + Add Blank Table Row
                </button>
              </div>
            )}
          </div>

          <div className="sidebar-mini-footer">
            <span>Ref# {refNumber}</span>
            <div className="sidebar-stats">
              <span className="live-dot"></span>
              <span>1/{pages.length || 1} page</span>
              <span>{wordCount} words</span>
            </div>
          </div>
        </aside>

        <main className="doc-desk">
          <div className="desk-scroll-area">
            <A4Ruler zoom={zoom} />
            <div
              className="doc-canvas-wrapper"
              style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }}
            >
              {pages.length > 0 ? (
                pages.map((pageContent, idx) => (
                  <div key={idx} className="a4-sheet drop-shadow">
                    {pageContent}
                  </div>
                ))
              ) : (
                <div className="a4-sheet drop-shadow empty-state">
                  Loading Document Blueprint...
                </div>
              )}
            </div>
          </div>

          <div className="desk-status-bar hidden-mobile">
            <div className="status-left">
              <span className="status-live">
                <span className="live-dot-green"></span> Live Editable
              </span>
              <span className="status-doc-type">{docConfig.type}</span>
            </div>
            <div className="status-right">
              <span>{wordCount} words</span>
              <span>Zoom {zoom}%</span>
              <span>{pages.length} page{pages.length !== 1 ? 's' : ''}</span>
              <span>A4 - 210×297mm</span>
              <span className="status-ref">Ref# {refNumber}</span>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};