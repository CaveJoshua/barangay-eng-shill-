import React, { useState, useEffect, useRef } from 'react';
import './styles/Documeent_File.css';
import { useDocumentDataAPI } from './Types/Doc_data_api';
import { useDocumentEngine } from './Document_Engine';

interface DocumentFileProps {
  onClose: () => void;
  onSuccess?: () => void;
  initialData?: any;
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLE SOURCE OF TRUTH — type → default fee (mirrors /documents/types config)
// ═══════════════════════════════════════════════════════════════════════════
const TYPE_FEE_MAP: Record<string, string> = {
  'Barangay Clearance': '200.00',
  'Certificate of Residency': '75.00',
  'Certificate of Indigency': '0.00',
  'Barangay Certification': '500.00',
  'Affidavit of Barangay Official': '50.00',
};

// The five canonical values used by the <select> in the sidebar.
const DROPDOWN_OPTIONS = [
  'Barangay Clearance',
  'Certificate of Indigency',
  'Certificate of Residency',
  'Barangay Certification',
  'Affidavit of Barangay Official',
];

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

export const DocumentFile: React.FC<DocumentFileProps> = ({ onClose, onSuccess, initialData }) => {
  const [zoom, setZoom] = useState<number>(100);
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

  const { residents, captainName, kagawadName, autoFilledAddress } = useDocumentDataAPI(
    docConfig.residentName,
    docConfig.residentId
  );

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
      setDocConfig(prev => ({
        ...prev,
        id: incomingId,
        type: t,
        residentId: initialData?.residentId || prev.residentId,
        residentName: initialData?.residentName || prev.residentName,
        purpose: initialData?.purpose || prev.purpose,
        feesPaid: initialData?.feesPaid || TYPE_FEE_MAP[t] || prev.feesPaid,
        status: (!initialData?.status || initialData?.status === 'Pending') ? 'Processing' : initialData.status,
        requestMethod: initialData?.requestMethod || prev.requestMethod,
      }));
      // The auto-sync effect below would otherwise overwrite the freshly set
      // feesPaid; treat this as another "initial" run to keep them aligned.
      isInitialTypeMount.current = true;
    }
  }, [initialData]);

  // ═══════════════════════════════════════════════════════════════════════════
  // Type → Fees cascade: when the admin manually changes the dropdown, sync
  // feesPaid to match. Skips the initial mount + any re-init from initialData.
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (isInitialTypeMount.current) {
      isInitialTypeMount.current = false;
      return;
    }
    const mapped = TYPE_FEE_MAP[docConfig.type];
    if (mapped !== undefined) {
      setDocConfig(prev => ({ ...prev, feesPaid: mapped }));
    }
  }, [docConfig.type]);

  const handleSurfaceEdit = (key: string, value: string) => {
    setDocConfig(prev => {
      if (key.startsWith('table-')) {
        const parts = key.split('-');
        const rIdx = parseInt(parts[2]);
        const cIdx = parseInt(parts[3]);
        const newTableRows = [...(prev.tableRows || [])];
        if (!newTableRows[rIdx]) newTableRows[rIdx] = [];
        newTableRows[rIdx][cIdx] = value;
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

  const { pages, wordCount, isProcessing, handleSaveAndDownload } = useDocumentEngine(
    docConfig,
    captainName,
    kagawadName,
    handleSurfaceEdit
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

    setDocConfig(prev => ({
      ...prev,
      residentId: resident.record_id,
      residentName: fullName,
      address: fullAddress && fullAddress.toLowerCase() !== 'n/a' ? fullAddress : prev.address
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

  // 🔓 ALL OPTIONS EDITABLE: every section (guardian, payment, witnesses) is now
  // available for every document type — each schema uses only the fields it needs.
  const showWitnesses = true;

  return (
    <div className="doc-app-shell">
      <header className="doc-topbar">
        <button className="mobile-menu-btn" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>☰</button>

        <div className="topbar-left hidden-mobile">
          <div className="brand-wrap">
            <span className="brand-icon">🖨️</span>
            <span className="brand-text">Brgy Doc</span>
          </div>
          <div className="format-tools">
            <button className="tool-btn"><b>B</b></button>
            <button className="tool-btn"><i>I</i></button>
            <button className="tool-btn"><u>U</u></button>
            <div className="tool-divider"></div>
            <button className="tool-btn">≡</button>
            <button className="tool-btn">→</button>
          </div>
        </div>

        <div className="topbar-center">
          <div className="zoom-tools hidden-mobile">
            <select className="strict-select-dark" disabled><option>12pt</option></select>
            <div className="tool-divider"></div>
            <button className="tool-btn" onClick={() => setZoom(z => Math.max(50, z - 10))}>-</button>
            <span className="zoom-label">{zoom}%</span>
            <button className="tool-btn" onClick={() => setZoom(z => Math.min(200, z + 10))}>+</button>
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
                <option value="Barangay Clearance">Barangay Clearance</option>
                <option value="Certificate of Indigency">Certificate of Indigency</option>
                <option value="Certificate of Residency">Certificate of Residency</option>
                <option value="Barangay Certification">Barangay Certification (Jobseeker)</option>
                <option value="Affidavit of Barangay Official">Affidavit of Barangay Official</option>
              </select>
            </div>

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

            {/* 🔓 Guardian / Minor-Consent — now shown for EVERY document type */}
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
            {/* 🔓 Payment & Purpose — now shown for EVERY document type */}
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

            {showWitnesses && (
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