import React, { useState, useEffect, useRef } from 'react';
import './styles/Officials_modal.css';

// ── MASTER API INTEGRATION ────────────────────────────────────
import { ApiService, OFFICIALS_API, getAuthHeaders } from '../UI/api'; 

// --- INTERFACES ---
interface IOfficial {
  id?: string;
  full_name: string;
  position: 
    | 'Barangay Hall' 
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
  'Barangay Hall',      // 🏛️ The Barangay Hall Master Account (Timeless)
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
  const [traceId, setTraceId] = useState(''); 
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

  const isBarangayHallMode = formData.position === 'Barangay Hall';

  // ── 1. RESIDENT DATA SYNC ───────────────────────────────────
  useEffect(() => {
    const fetchResidents = async () => {
      if (isBarangayHallMode) {
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
  }, [isOpen, isBarangayHallMode]);

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
    if (isBarangayHallMode) return; 

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
      'Barangay Hall', 'Punong Barangay', 'Barangay Secretary', 
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
        credentials: 'include', 
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

    if (!isBarangayHallMode && !formData.term_start) {
      return alert("Error: Service Start date is required for standard officials.");
    }

    if (isBarangayHallMode && (!verificationCode || !traceId)) {
      return alert("Error: You must request and verify the Gmail code before authorizing.");
    }

    if (!canAddPosition(formData.position!)) {
      return alert(`Access Denied: The ${formData.position} slot is already occupied.`);
    }

    setIsSubmitting(true);

    try {
      const method = officialToEdit ? 'PUT' : 'POST';
      const url = officialToEdit ? `${OFFICIALS_API}/${officialToEdit.id}` : OFFICIALS_API;

      const payload = {
        ...formData,
        ...(isBarangayHallMode && { otp: verificationCode, trace_id: traceId })
      };

      const res = await fetch(url, {
        method,
        headers: getAuthHeaders(false, method),
        credentials: 'include', 
        body: JSON.stringify(payload) 
      });

      if (res.ok) {
        const result = await res.json();
        
        if (method === 'POST' && result.account) {
          alert(`
            ${isBarangayHallMode ? 'BARANGAY MASTER ACCOUNT AUTHORIZED' : 'OFFICIAL IDENTITY REGISTERED'}
            
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
          <p>{isBarangayHallMode ? 'Master Gmail Handshake Required.' : 'Registering authorized personnel identity.'}</p>
        </div>

        <form onSubmit={handleSubmit} className="OM_FORM">
          
          <div className="OM_FORM_GROUP" ref={searchWrapperRef}>
            <label>{isBarangayHallMode ? 'Barangay Hall Gmail' : 'Legal Full Name'}</label>
            <div style={{ display: 'flex', gap: '8px', position: 'relative' }}>
              <input 
                type={isBarangayHallMode ? "email" : "text"} 
                required 
                className="OM_INPUT" 
                placeholder={isBarangayHallMode ? "e.g. samplehall@gmail.com" : "Search resident or enter name..."}
                value={formData.full_name}
                onChange={e => {
                  const val = e.target.value;
                  setFormData({
                    ...formData, 
                    full_name: isBarangayHallMode ? val.toLowerCase() : val.toUpperCase()
                  });
                  if (!isBarangayHallMode) setShowDropdown(true);
                }}
                onFocus={() => !isBarangayHallMode && setShowDropdown(true)}
                autoComplete="off"
                style={{ flex: 1 }}
              />
              
              {isBarangayHallMode && !otpSent && (
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

              {showDropdown && !isBarangayHallMode && filteredResidents.length > 0 && (
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
                  term_start: newPos === 'Barangay Hall' ? '' : new Date().toISOString().split('T')[0],
                  term_end: ''
                });
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

          {isBarangayHallMode && otpSent && (
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

          {!isBarangayHallMode && (
            <>
              <div className="OM_ROW">
                <div className="OM_FORM_GROUP">
                  <label>Service Start</label>
                  <input 
                    type="date" 
                    required 
                    className={`OM_INPUT ${!!officialToEdit ? 'OM_INPUT_LOCKED' : ''}`} 
                    value={formData.term_start} 
                    // 🛡️ LOCK: Prevent modification once registered
                    disabled={!!officialToEdit}
                    onChange={e => setFormData({...formData, term_start: e.target.value})} 
                  />
                </div>
                <div className="OM_FORM_GROUP">
                  <label>Service End</label>
                  <input 
                    type="date" 
                    className={`OM_INPUT ${!!officialToEdit ? 'OM_INPUT_LOCKED' : ''}`} 
                    value={formData.term_end} 
                    // 🛡️ LOCK: Prevent modification once registered
                    disabled={!!officialToEdit}
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
            <button type="submit" className="OM_BTN_PRIMARY" disabled={isSubmitting || (isBarangayHallMode && !otpSent)}>
              {isSubmitting ? 'Syncing...' : 'Validate & Authorize'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}