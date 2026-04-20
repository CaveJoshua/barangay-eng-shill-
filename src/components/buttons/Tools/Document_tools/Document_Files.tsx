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
    // 👇 NEW: Default state for table rows
    tableRows: [['', '', '']] 
  });

  const refNumber = useRef(initialData?.referenceNo || `WALK-IN-${Date.now().toString().slice(-6)}`).current;

  const { residents, captainName, kagawadName, autoFilledAddress } = useDocumentDataAPI(docConfig.residentName, docConfig.residentId);

  // 👇 NEW: The function that catches edits from the PDF surface
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
      // Standard text edits (like captainName, feesPaid)
      return { ...prev, [key]: value };
    });
  };

  // Passed handleSurfaceEdit into the engine
  const { pages, wordCount, isProcessing, handleSaveAndDownload } = useDocumentEngine(
    docConfig,
    captainName,
    kagawadName,
    handleSurfaceEdit 
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
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
    if (success && onSuccess) {
      onSuccess(); 
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
            <button className="tool-btn">💾</button>
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
        {isSidebarOpen && <div className="sidebar-overlay" onClick={() => setIsSidebarOpen(false)}></div>}

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
                <input type="text" name="certificateNo" className="strict-input" value={docConfig.certificateNo} onChange={handleInputChange} />
              </div>
              <div className="field-group">
                <label>DATE ISSUED</label>
                <input type="date" name="dateIssued" className="strict-input" value={docConfig.dateIssued} onChange={handleInputChange} />
              </div>
            </div>

            <div className="section-label text-blue">👤 RESIDENT</div>
            <div className="field-group relative" ref={dropdownRef}>
              <label>REQUESTOR NAME <span className="req">*</span></label>
              <input 
                type="text" name="residentName" className="strict-input" placeholder="Search or type full name..."
                value={docConfig.residentName} 
                onChange={(e) => {
                  handleInputChange(e); setShowDropdown(true); setDocConfig(prev => ({ ...prev, residentId: '' }));
                }}
                onFocus={() => setShowDropdown(true)}
              />
              {showDropdown && residents && residents.length > 0 && (
                <ul className="doc-dropdown-menu">
                  {residents
                    .filter(r => `${r.first_name} ${r.last_name}`.toLowerCase().includes(docConfig.residentName.toLowerCase()))
                    .map(r => (
                      <li key={r.record_id} className="doc-dropdown-item" onClick={() => handleResidentSelect(r)}>
                        <span className="doc-dropdown-name">{r.first_name} {r.last_name}</span>
                        <span className="doc-dropdown-meta">{[r.current_address, r.purok].filter(Boolean).join(', ') || 'No address on file'}</span>
                      </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="field-group">
              <label>RESIDENTIAL ADDRESS <span className="req">*</span></label>
              <input type="text" name="address" className="strict-input" placeholder="Street / Purok / Barangay" value={docConfig.address} onChange={handleInputChange} />
            </div>

            {isJobseeker ? (
              <div className="dynamic-fade-in">
                <div className="section-label text-purple">📝 MINOR CONSENT (PAGE 2)</div>
                <div className="doc-hint-text" style={{ fontSize: '11px', color: '#666', marginBottom: '10px' }}>
                  Only required if the applicant is under 18 years old.
                </div>
                <div className="field-group">
                  <label>GUARDIAN NAME</label>
                  <input type="text" name="guardianName" className="strict-input" placeholder="Name of Parent/Guardian" value={docConfig.guardianName} onChange={handleInputChange} />
                </div>
                <div className="field-group-row">
                  <div className="field-group">
                    <label>GUARDIAN AGE</label>
                    <input type="number" name="guardianAge" className="strict-input" placeholder="e.g. 45" value={docConfig.guardianAge} onChange={handleInputChange} />
                  </div>
                  <div className="field-group">
                    <label>YEARS IN BRGY</label>
                    <input type="number" name="guardianResidency" className="strict-input" placeholder="e.g. 10" value={docConfig.guardianResidency} onChange={handleInputChange} />
                  </div>
                </div>
                <div className="field-group">
                  <label>GUARDIAN ADDRESS</label>
                  <input type="text" name="guardianAddress" className="strict-input" placeholder="Complete Address" value={docConfig.guardianAddress} onChange={handleInputChange} />
                </div>
              </div>
            ) : (
              <div className="dynamic-fade-in">
                <div className="section-label text-orange">💰 PAYMENT & PURPOSE</div>
                <div className="field-group">
                  <label>PURPOSE</label>
                  <input type="text" name="purpose" className="strict-input" placeholder="e.g. Medical, Financial, General" value={docConfig.purpose} onChange={handleInputChange} />
                </div>
                <div className="field-group-row">
                  <div className="field-group">
                    <label>CTC NO.</label>
                    <input type="text" name="ctcNo" className="strict-input" value={docConfig.ctcNo} onChange={handleInputChange} />
                  </div>
                  <div className="field-group">
                    <label>FEES PAID</label>
                    <input type="text" name="feesPaid" className="strict-input" value={docConfig.feesPaid} onChange={handleInputChange} />
                  </div>
                </div>
                <div className="field-group">
                  <label>O.R. NO.</label>
                  <input type="text" name="orNo" className="strict-input" value={docConfig.orNo} onChange={handleInputChange} />
                </div>
              </div>
            )}

            {/* 👇 NEW: TABLE CONTROLS */}
            <div className="dynamic-fade-in" style={{ marginTop: '20px' }}>
              <div className="section-label text-blue">📊 TABLE CONTROLS</div>
              <button 
                type="button" 
                className="btn-print" 
                style={{ width: '100%', background: '#f0f0f0', color: '#333', border: '1px dashed #999' }}
                onClick={() => setDocConfig(prev => ({ 
                  ...prev, 
                  tableRows: [...(prev.tableRows || []), ['', '', '']] 
                }))}
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
            <div className="doc-canvas-wrapper" style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }}>
              {pages.length > 0 ? (
                pages.map((pageContent, idx) => (
                  <div key={idx} className="a4-sheet drop-shadow">
                    {pageContent}
                  </div>
                ))
              ) : (
                <div className="a4-sheet drop-shadow empty-state">Loading Document Blueprint...</div>
              )}
            </div>
          </div>

          <div className="desk-status-bar hidden-mobile">
            <div className="status-left">
              <span className="status-live"><span className="live-dot-green"></span> Live Editable</span>
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