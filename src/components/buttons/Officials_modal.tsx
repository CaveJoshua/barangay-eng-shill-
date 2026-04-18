import React, { useState, useEffect, useRef } from 'react';
import './styles/Officials_modal.css';

// ── MASTER API INTEGRATION ────────────────────────────────────
import { ApiService, OFFICIALS_API, getAuthHeaders } from '../UI/api'; 

// --- INTERFACES ---
interface IOfficial {
  id?: string;
  full_name: string;
  position: 
    | 'Super Admin' 
    | 'Punong Barangay' 
    | 'Barangay Secretary' 
    | 'Barangay Treasurer' 
    | 'Barangay Kagawad' 
    | 'SK Chairperson' 
    | 'Barangay Health Worker' 
    | 'Barangay Nutrition Scholar';
  term_start: string;
  term_end: string;
  status: 'Active' | 'End of Term' | 'Resigned';
  contact_number?: string;
}

interface IResident {
  record_id: string; 
  first_name: string;
  last_name: string;
  middle_name?: string;
  contact_number?: string;
}

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  officialToEdit?: IOfficial | null;
  existingOfficials?: IOfficial[]; 
}

// ── POSITION CONFIGURATION ────────────────────────────────────
const POSITIONS = [
  'Super Admin',      // 🏛️ The Barangay Hall Master Account (Timeless)
  'Punong Barangay',  // 👑 The Primary Village Administrator
  'Barangay Secretary',
  'Barangay Treasurer',
  'Barangay Kagawad',
  'SK Chairperson',
  'Barangay Health Worker',
  'Barangay Nutrition Scholar'
];

export default function Officials_modal({ isOpen, onClose, onSuccess, officialToEdit, existingOfficials = [] }: ModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [traceId, setTraceId] = useState(''); // 🛡️ Stores the session ID for OTP
  const [verificationCode, setVerificationCode] = useState('');
  
  const [residents, setResidents] = useState<IResident[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchWrapperRef = useRef<HTMLDivElement>(null);

  const [formData, setFormData] = useState<Partial<IOfficial>>({
    full_name: '',
    position: 'Barangay Kagawad',
    term_start: new Date().toISOString().split('T')[0],
    term_end: '',
    status: 'Active',
    contact_number: ''
  });

  const isSuperAdminMode = formData.position === 'Super Admin';

  // ── 1. RESIDENT DATA SYNC ───────────────────────────────────
  useEffect(() => {
    const fetchResidents = async () => {
      if (isSuperAdminMode) {
        setResidents([]);
        return;
      }
      
      const data = await ApiService.getResidents();
      if (data) {
        setResidents(Array.isArray(data) ? data : data.residents || []);
      }
    };
    
    if (isOpen) fetchResidents();

    const handleClickOutside = (event: MouseEvent) => {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, isSuperAdminMode]);

  // ── 2. EDIT MODE INITIALIZATION ─────────────────────────────
  useEffect(() => {
    if (isOpen) {
      if (officialToEdit) {
        setFormData(officialToEdit);
      } else {
        setFormData({
          full_name: '',
          position: 'Barangay Kagawad',
          term_start: new Date().toISOString().split('T')[0],
          term_end: '',
          status: 'Active',
          contact_number: ''
        });
      }
      // Reset OTP states when opening modal
      setOtpSent(false);
      setVerificationCode('');
      setTraceId('');
    }
  }, [isOpen, officialToEdit]);

  // ── 3. SEARCH & SELECTION LOGIC ─────────────────────────────
  const filteredResidents = residents.filter(r => {
    const safeFirst = r.first_name || '';
    const safeLast = r.last_name || '';
    const fullName = `${safeFirst} ${safeLast}`.toLowerCase();
    const query = (formData.full_name || '').toLowerCase();
    return fullName.includes(query) && fullName !== query;
  });

  const handleSelectResident = (r: IResident) => {
    if (isSuperAdminMode) return; 

    const middle = r.middle_name ? `${r.middle_name} ` : '';
    const fullName = `${r.first_name} ${middle}${r.last_name}`.trim().toUpperCase();
    
    setFormData(prev => ({
      ...prev,
      full_name: fullName,
      contact_number: r.contact_number || prev.contact_number
    }));
    setShowDropdown(false);
  };

  const canAddPosition = (pos: string) => {
    if (officialToEdit && officialToEdit.position === pos) return true;
    
    const singleRoles = [
      'Super Admin', 'Punong Barangay', 'Barangay Secretary', 
      'Barangay Treasurer', 'SK Chairperson'
    ];
    
    if (singleRoles.includes(pos)) {
      if (Array.isArray(existingOfficials)) {
        const exists = existingOfficials.find(o => o.position === pos && o.status === 'Active');
        if (exists) return false;
      }
    }
    return true;
  };

  // ── 4. REQUEST OTP LOGIC ────────────────────────────────────
  const handleRequestOTP = async () => {
    if (!formData.full_name || !formData.full_name.includes('@')) {
      return alert("Please enter a valid Barangay Hall Gmail first.");
    }

    setIsSendingOtp(true);
    try {
      const response = await fetch(`${OFFICIALS_API}/request-otp`, {
        method: 'POST',
        headers: getAuthHeaders(false, 'POST'),
        credentials: 'include', // 🛡️ CRITICAL: Forces cookie inclusion to bypass 401 error
        body: JSON.stringify({ email: formData.full_name })
      });

      const result = await response.json();
      if (response.ok) {
        setTraceId(result.trace_id);
        setOtpSent(true);
        alert("Verification code successfully dispatched to Gmail.");
      } else {
        alert(result.error || "Failed to send verification code.");
      }
    } catch (err) {
      alert("Connectivity error. Check backend logs.");
    } finally {
      setIsSendingOtp(false);
    }
  };

  // ── 5. FINAL SUBMISSION ─────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.full_name) {
      return alert("Error: Required Identity Field (Name or Gmail) is missing.");
    }

    if (!isSuperAdminMode && !formData.term_start) {
      return alert("Error: Service Start date is required for standard officials.");
    }

    if (isSuperAdminMode && (!verificationCode || !traceId)) {
      return alert("Error: You must request and verify the Gmail code before authorizing.");
    }

    if (!canAddPosition(formData.position!)) {
      return alert(`Access Denied: The ${formData.position} slot is already occupied.`);
    }

    setIsSubmitting(true);

    try {
      const method = officialToEdit ? 'PUT' : 'POST';
      const url = officialToEdit ? `${OFFICIALS_API}/${officialToEdit.id}` : OFFICIALS_API;

      // Pack the payload exactly as the backend expects it
      const payload = {
        ...formData,
        ...(isSuperAdminMode && { otp: verificationCode, trace_id: traceId })
      };

      const res = await fetch(url, {
        method,
        headers: getAuthHeaders(false, method),
        credentials: 'include', // 🛡️ CRITICAL: Sends secure cookies (fixes 401 Unauthorized)
        body: JSON.stringify(payload) 
      });

      if (res.ok) {
        const result = await res.json();
        
        if (method === 'POST' && result.account) {
          alert(`
            ${isSuperAdminMode ? 'BARANGAY MASTER ACCOUNT AUTHORIZED' : 'OFFICIAL IDENTITY REGISTERED'}
            
            GENERATED CREDENTIALS:
            -----------------------------------
            Username: ${result.account.username}
            Password: ${result.account.password}
            -----------------------------------
            Save these immediately. This is the only time they are displayed.
          `);
        } else {
          alert('System ledger updated successfully.');
        }

        onSuccess();
        onClose();
      } else {
        const errorData = await res.json().catch(() => ({}));
        alert(errorData.error || "Backend rejected the authorization request.");
      }
    } catch (err) {
      alert("Encryption link failure. Verify backend connectivity.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="OM_OVERLAY" onClick={onClose}>
      <div className="OM_CONTENT" onClick={e => e.stopPropagation()}>
        
        <div className="OM_HEADER">
          <h3>{officialToEdit ? 'Modify System Block' : 'Identity Authorization'}</h3>
          <p>{isSuperAdminMode ? 'Master Gmail Handshake Required.' : 'Registering authorized personnel identity.'}</p>
        </div>

        <form onSubmit={handleSubmit} className="OM_FORM">
          
          <div className="OM_FORM_GROUP" ref={searchWrapperRef}>
            <label>{isSuperAdminMode ? 'Barangay Hall Gmail (Super Admin)' : 'Legal Full Name'}</label>
            <div style={{ display: 'flex', gap: '8px', position: 'relative' }}>
              <input 
                type={isSuperAdminMode ? "email" : "text"} 
                required 
                className="OM_INPUT" 
                placeholder={isSuperAdminMode ? "e.g. samplehall@gmail.com" : "Search resident or enter name..."}
                value={formData.full_name}
                onChange={e => {
                  const val = e.target.value;
                  setFormData({
                    ...formData, 
                    full_name: isSuperAdminMode ? val.toLowerCase() : val.toUpperCase()
                  });
                  if (!isSuperAdminMode) setShowDropdown(true);
                }}
                onFocus={() => !isSuperAdminMode && setShowDropdown(true)}
                autoComplete="off"
                style={{ flex: 1 }}
              />
              
              {/* 🛡️ THE NEW TRIGGER BUTTON */}
              {isSuperAdminMode && !otpSent && (
                <button 
                  type="button" 
                  onClick={handleRequestOTP}
                  className="OM_BTN_SECONDARY"
                  disabled={isSendingOtp}
                  style={{ whiteSpace: 'nowrap', padding: '0 16px', height: 'auto' }}
                >
                  {isSendingOtp ? 'Sending...' : 'Send Code'}
                </button>
              )}

              {showDropdown && !isSuperAdminMode && filteredResidents.length > 0 && (
                <ul className="OM_DROPDOWN_LIST">
                  {filteredResidents.map(r => (
                    <li 
                      key={r.record_id} 
                      onClick={() => handleSelectResident(r)} 
                      className="OM_DROPDOWN_ITEM"
                    >
                      {r.first_name} {r.last_name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="OM_FORM_GROUP">
            <label>System Designation / Role</label>
            <select 
              className="OM_SELECT" 
              value={formData.position}
              onChange={e => {
                const newPos = e.target.value as any;
                setFormData({
                  ...formData, 
                  position: newPos, 
                  full_name: '',
                  term_start: newPos === 'Super Admin' ? '' : new Date().toISOString().split('T')[0],
                  term_end: ''
                });
                // Reset OTP flow if they switch away and come back
                setOtpSent(false);
                setVerificationCode('');
                setShowDropdown(false);
              }}
            >
              {POSITIONS.map(p => (
                <option key={p} value={p} disabled={!canAddPosition(p)}>
                  {p} {!canAddPosition(p) ? '(At Capacity)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* 🛡️ CONDITIONAL AUTHENTICATION CODE INPUT */}
          {isSuperAdminMode && otpSent && (
            <div className="OM_FORM_GROUP">
              <label style={{ color: '#d97706' }}>Gmail Verification Code</label>
              <input 
                type="text" 
                required 
                className="OM_INPUT" 
                placeholder="Enter 6-digit code"
                value={verificationCode}
                onChange={e => setVerificationCode(e.target.value.toUpperCase())}
                maxLength={6}
                style={{ letterSpacing: '4px', fontWeight: 'bold', borderColor: '#d97706' }}
              />
              <small style={{ display: 'block', marginTop: '6px', color: '#64748b', fontSize: '12px' }}>
                Check the provided Gmail inbox for the setup code.
              </small>
            </div>
          )}

          {!isSuperAdminMode && (
            <>
              <div className="OM_ROW">
                <div className="OM_FORM_GROUP">
                  <label>Service Start</label>
                  <input 
                    type="date" 
                    required 
                    className="OM_INPUT" 
                    value={formData.term_start} 
                    onChange={e => setFormData({...formData, term_start: e.target.value})} 
                  />
                </div>
                <div className="OM_FORM_GROUP">
                  <label>Service End</label>
                  <input 
                    type="date" 
                    className="OM_INPUT" 
                    value={formData.term_end} 
                    onChange={e => setFormData({...formData, term_end: e.target.value})} 
                  />
                </div>
              </div>

              <div className="OM_FORM_GROUP">
                <label>Authorized Contact Number</label>
                <input 
                  type="text" 
                  className="OM_INPUT" 
                  placeholder="Active Mobile/Tel" 
                  value={formData.contact_number} 
                  onChange={e => setFormData({...formData, contact_number: e.target.value})} 
                />
              </div>
            </>
          )}

          <div className="OM_FOOTER">
            <button type="button" className="OM_BTN_SECONDARY" onClick={onClose}>
              Abort
            </button>
            <button type="submit" className="OM_BTN_PRIMARY" disabled={isSubmitting || (isSuperAdminMode && !otpSent)}>
              {isSubmitting ? 'Syncing...' : 'Validate & Authorize'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}