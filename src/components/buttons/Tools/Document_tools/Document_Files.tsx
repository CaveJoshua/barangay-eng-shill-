import React, { useState, useEffect, useRef } from 'react';
import './styles/Documeent_File.css';
import { useDocumentDataAPI } from './Types/Doc_data_api';
import { useDocumentEngine } from './Document_Engine';

interface DocumentFileProps {
  onClose: () => void;
  onSuccess?: () => void;
  initialData?: any;
}

export const DocumentFile: React.FC<DocumentFileProps> = ({ onClose, onSuccess, initialData }) => {
  const [zoom, setZoom] = useState<number>(100);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [docConfig, setDocConfig] = useState({
    // ✅ THE KEY FIX: Pass the existing DB record's id so the engine
    // can UPDATE the row instead of INSERTing a duplicate.
    id: initialData?.id || null,

    residentId: initialData?.residentId || '',
    residentName: initialData?.residentName || '',
    address: '',
    type: initialData?.type || 'Barangay Clearance',
    purpose: initialData?.purpose || '',
    dateIssued: new Date().toISOString().split('T')[0],
    ctcNo: '',
    orNo: '',
    feesPaid: initialData?.feesPaid || '200.00',
    certificateNo: `2026-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`,
    guardianName: '',
    guardianAge: '',
    guardianAddress: '',
    guardianResidency: '',
    tableRows: [['', '', '']],

    // 🎯 NEW: typed witness records — surfaces in the Affidavit & Jobseeker schemas
    // and is also editable in the document preview itself.
    witnesses: initialData?.witnesses || [
      { name: '', address: '', contactNo: '' }
    ],

    // Force manual creations and newly opened Pending requests straight to 'Processing'
    status: (!initialData?.status || initialData?.status === 'Pending') ? 'Processing' : initialData.status,

    // Walk-in is always the default for this DocumentFile (admin side)
    requestMethod: initialData?.requestMethod || 'Walk-in',
  });

  const refNumber = useRef(
    initialData?.referenceNo || `WALK-IN-${Date.now().toString().slice(-6)}`
  ).current;

  const { residents, captainName, kagawadName, autoFilledAddress } = useDocumentDataAPI(
    docConfig.residentName,
    docConfig.residentId
  );

  const handleSurfaceEdit = (key: string, value: string) => {
    setDocConfig(prev => {
      // Special logic to handle table cell edits (table-index-row-col)
      if (key.startsWith('table-')) {
        const parts = key.split('-');
        const rIdx = parseInt(parts[2]);
        const cIdx = parseInt(parts[3]);
        const newTableRows = [...(prev.tableRows || [])];
        if (!newTableRows[rIdx]) newTableRows[rIdx] = [];
        newTableRows[rIdx][cIdx] = value;
        return { ...prev, tableRows: newTableRows };
      }
      // 🎯 NEW: route witness-N-field edits coming from the preview (witness-0-name, etc.)
      // back into docConfig.witnesses. The schema renders these with editableKey="witness-N-field".
      if (key.startsWith('witness-')) {
        const parts = key.split('-');
        const wIdx = parseInt(parts[1]);
        const field = parts[2]; // 'name' | 'address' | 'contactNo'
        const newWitnesses = [...(prev.witnesses || [])];
        if (!newWitnesses[wIdx]) newWitnesses[wIdx] = { name: '', address: '', contactNo: '' };
        // Strip HTML wrappers so saved values are clean plain text
        const plain = value.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
        newWitnesses[wIdx] = { ...newWitnesses[wIdx], [field]: plain };
        return { ...prev, witnesses: newWitnesses };
      }
      // Standard text edits
      return { ...prev, [key]: value };
    });
  };

  // 🎯 NEW: witness row handlers (sidebar input table)
  const handleWitnessChange = (idx: number, field: 'name' | 'address' | 'contactNo', value: string) => {
    setDocConfig(prev => {
      const newWitnesses = [...(prev.witnesses || [])];
      if (!newWitnesses[idx]) newWitnesses[idx] = { name: '', address: '', contactNo: '' };
      newWitnesses[idx] = { ...newWitnesses[idx], [field]: value };
      return { ...prev, witnesses: newWitnesses };
    });
  };

  const handleAddWitness = () => {
    setDocConfig(prev => ({
      ...prev,
      witnesses: [...(prev.witnesses || []), { name: '', address: '', contactNo: '' }]
    }));
  };

  const handleRemoveWitness = (idx: number) => {
    setDocConfig(prev => {
      const newWitnesses = (prev.witnesses || []).filter((_: any, i: number) => i !== idx);
      // Always keep at least one row so the schema has something to render
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

  // ✅ After PDF downloads successfully:
  // 1. The engine has already updated/inserted the DB record as 'Completed'
  // 2. onSuccess() fires → triggers refresh() in the parent (Community_Document / Admin list)
  // 3. The community document list re-fetches and shows the updated 'Completed' status
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

  const isJobseeker = docConfig.type === 'Barangay Certification';
  const isAffidavit = docConfig.type === 'Affidavit of Barangay Official';
  // 🎯 Witnesses are now AFFIDAVIT-ONLY (the Jobseeker has its own "Witnessed by" line
  // baked into the schema; it doesn't need a separate witness input table).
  const showWitnesses = isAffidavit;

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
            {/* 🎯 Save (💾) tool removed — saving is handled exclusively by the Print/Download flow */}
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

            {isJobseeker ? (
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
            ) : (
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
                <div className="field-group">
                  <label>O.R. NO.</label>
                  <input
                    type="text"
                    name="orNo"
                    className="strict-input"
                    value={docConfig.orNo}
                    onChange={handleInputChange}
                  />
                </div>
              </div>
            )}

            {/* 🎯 NEW: Witnesses input table (Affidavit + Jobseeker only) */}
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

                <button
                  type="button"
                  className="btn-print"
                  style={{
                    width: '100%',
                    background: '#f0f0f0',
                    color: '#333',
                    border: '1px dashed #999',
                    marginTop: '4px',
                  }}
                  onClick={handleAddWitness}
                >
                  + Add Another Witness
                </button>
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