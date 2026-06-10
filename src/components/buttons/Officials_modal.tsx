import React, { useState, useEffect, useRef } from 'react';
import './styles/Officials_modal.css';
import { ApiService, OFFICIALS_API, getAuthHeaders } from '../UI/api';

interface IOfficial {
  id?: string;
  full_name: string;
  email?: string;
  position: 'Barangay Hall' | 'Punong Barangay' | 'Barangay Secretary' | 'Barangay Treasurer' | 'Barangay Kagawad' | 'SK Chairperson' | 'Barangay Health Worker' | 'Barangay Nutrition Scholar';
  term_start: string;
  term_end: string;
  status: 'Active' | 'End of Term' | 'Resigned';
  contact_number?: string;
  role?: string;
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

const POSITIONS = [
  'Barangay Hall',
  'Punong Barangay',
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
  
  // 🛡️ NEW STATE: Isolate the master email from the actual account name
  const [masterEmail, setMasterEmail] = useState('');
  
  const [residents, setResidents] = useState<IResident[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchWrapperRef = useRef<HTMLDivElement>(null);

  const [formData, setFormData] = useState<Partial<IOfficial>>({
    full_name: '',
    email: '',
    position: 'Barangay Kagawad',
    term_start: new Date().toISOString().split('T')[0],
    term_end: '',
    status: 'Active',
    contact_number: '',
    role: 'staff'
  });

  const isBarangayHallMode = formData.position === 'Barangay Hall';

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

  useEffect(() => {
    if (isOpen) {
      if (officialToEdit) {
        setFormData(officialToEdit);
      } else {
        setFormData({
          full_name: '',
          email: '',
          position: 'Barangay Kagawad',
          term_start: new Date().toISOString().split('T')[0],
          term_end: '',
          status: 'Active',
          contact_number: '',
          role: 'staff'
        });
      }
      setOtpSent(false);
      setVerificationCode('');
      setTraceId('');
      setMasterEmail(''); // Reset email
    }
  }, [isOpen, officialToEdit]);

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
    const singleRoles = ['Barangay Hall', 'Punong Barangay', 'Barangay Secretary', 'Barangay Treasurer', 'SK Chairperson'];
    if (singleRoles.includes(pos)) {
      if (Array.isArray(existingOfficials)) {
        const exists = existingOfficials.find(o => o.position === pos && o.status === 'Active');
        if (exists) return false;
      }
    }
    return true;
  };

  const handleRequestOTP = async () => {
    if (!masterEmail || !masterEmail.includes('@')) {
      return alert("Enter a valid Gmail address for Barangay Hall.");
    }
    setIsSendingOtp(true);
    try {
      const response = await fetch(`${OFFICIALS_API}/request-otp`, {
        method: 'POST',
        headers: getAuthHeaders(false, 'POST'),
        credentials: 'include',
        body: JSON.stringify({ email: masterEmail }) // Send the dedicated email state
      });
      const result = await response.json();
      if (response.ok) {
        setTraceId(result.trace_id);
        setOtpSent(true);
        alert("Verification code sent to Gmail.");
      } else {
        alert(result.error || "Failed to send code.");
      }
    } catch (err) {
      alert("Connection error. Check backend.");
    } finally {
      setIsSendingOtp(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isBarangayHallMode && !formData.full_name) {
      return alert("Full name required.");
    }

    if (!isBarangayHallMode) {
      if (!formData.term_start) return alert("Service start date required.");
      if (!formData.term_end) return alert("Service end date required.");
      if (new Date(formData.term_end) <= new Date(formData.term_start)) {
        return alert("End date must be after start date.");
      }
    }

    if (isBarangayHallMode && (!verificationCode || !traceId)) {
      return alert("Request and verify the Gmail code first.");
    }

    if (!canAddPosition(formData.position!)) {
      return alert(`${formData.position} position is already filled.`);
    }

    setIsSubmitting(true);

    try {
      const method = officialToEdit ? 'PUT' : 'POST';
      const url = officialToEdit ? `${OFFICIALS_API}/${officialToEdit.id}` : OFFICIALS_API;

      // 🛡️ Send the hardcoded full name and the master email in the payload
      const payload = {
        ...formData,
        role: isBarangayHallMode ? 'superadmin' : formData.role || 'staff',
        ...(isBarangayHallMode && { otp: verificationCode, trace_id: traceId, email: masterEmail })
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
✅ BARANGAY HALL SUPERADMIN ACCOUNT CREATED

USERNAME: ${result.account.username}
PASSWORD: ${result.account.password}
ROLE: SUPERADMIN

⚠️ Save these immediately. Not shown again.
          `);
        } else {
          alert('Account updated successfully.');
        }
        onSuccess();
        onClose();
      } else {
        const errorData = await res.json().catch(() => ({}));
        alert(errorData.error || "Backend rejected request.");
      }
    } catch (err) {
      alert("Connection error. Verify backend is running.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="OM_OVERLAY" onClick={onClose}>
      <div className="OM_CONTENT" onClick={e => e.stopPropagation()}>
        <div className="OM_HEADER">
          <h3>{officialToEdit ? 'Modify Official' : 'Register Official'}</h3>
          <p>{isBarangayHallMode ? '🏛️ Creating Superadmin Account' : 'Add new barangay official'}</p>
        </div>

        <form onSubmit={handleSubmit} className="OM_FORM">
          
          <div className="OM_FORM_GROUP">
            <label>Position / Role</label>
            <select
              className="OM_SELECT"
              value={formData.position}
              onChange={e => {
                const newPos = e.target.value as any;
                const isHall = newPos === 'Barangay Hall';
                
                setFormData({
                  ...formData,
                  position: newPos,
                  // 🛡️ THE FIX: Auto-fill the proper entity name instantly
                  full_name: isHall ? "Barangay Engineer's Hill" : '',
                  term_start: isHall ? '' : new Date().toISOString().split('T')[0],
                  term_end: '',
                  role: isHall ? 'superadmin' : 'staff'
                });
                setOtpSent(false);
                setVerificationCode('');
                setShowDropdown(false);
              }}
            >
              {POSITIONS.map(p => (
                <option key={p} value={p} disabled={!canAddPosition(p)}>
                  {p} {!canAddPosition(p) ? '(Filled)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* 🛡️ If Barangay Hall, show the fixed Account Name */}
          {isBarangayHallMode && (
            <div className="OM_FORM_GROUP">
              <label>System Account Name</label>
              <input
                type="text"
                className="OM_INPUT"
                value="Barangay Engineer's Hill"
                disabled
                style={{ backgroundColor: '#f1f5f9', color: '#475569', fontWeight: 'bold' }}
              />
            </div>
          )}

          <div className="OM_FORM_GROUP" ref={searchWrapperRef}>
            <label>{isBarangayHallMode ? 'Master Gmail Address' : 'Full Name'}</label>
            <div style={{ display: 'flex', gap: '8px', position: 'relative' }}>
              <input
                type={isBarangayHallMode ? "email" : "text"}
                required
                className="OM_INPUT"
                placeholder={isBarangayHallMode ? "hall@gmail.com" : "Search or enter name..."}
                // 🛡️ Bind directly to masterEmail if Hall Mode, otherwise bind to full_name
                value={isBarangayHallMode ? masterEmail : formData.full_name}
                onChange={e => {
                  const val = e.target.value;
                  if (isBarangayHallMode) {
                    setMasterEmail(val.toLowerCase());
                  } else {
                    setFormData({ ...formData, full_name: val.toUpperCase() });
                    setShowDropdown(true);
                  }
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
                  disabled={isSendingOtp || !masterEmail.includes('@')}
                  style={{ whiteSpace: 'nowrap', padding: '0 16px' }}
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

          {isBarangayHallMode && otpSent && (
            <div className="OM_FORM_GROUP">
              <label style={{ color: '#d97706', fontWeight: 'bold' }}>Gmail Code</label>
              <input
                type="text"
                required
                className="OM_INPUT"
                placeholder="6-digit code"
                value={verificationCode}
                onChange={e => setVerificationCode(e.target.value.toUpperCase())}
                maxLength={6}
                style={{ letterSpacing: '4px', fontWeight: 'bold', borderColor: '#d97706' }}
              />
            </div>
          )}

          {!isBarangayHallMode && (
            <>
              <div className="OM_ROW">
                <div className="OM_FORM_GROUP">
                  <label>Start Date</label>
                  <input
                    type="date"
                    required
                    className="OM_INPUT"
                    value={formData.term_start}
                    disabled={!!officialToEdit}
                    onChange={e => setFormData({ ...formData, term_start: e.target.value })}
                  />
                </div>
                <div className="OM_FORM_GROUP">
                  <label>End Date</label>
                  <input
                    type="date"
                    required
                    className="OM_INPUT"
                    value={formData.term_end}
                    disabled={!!officialToEdit}
                    onChange={e => setFormData({ ...formData, term_end: e.target.value })}
                  />
                </div>
              </div>

              <div className="OM_FORM_GROUP">
                <label>Email Address</label>
                <input
                  type="email"
                  className="OM_INPUT"
                  placeholder="official@gmail.com"
                  value={formData.email || ''}
                  onChange={e => setFormData({ ...formData, email: e.target.value.toLowerCase() })}
                />
              </div>

              <div className="OM_FORM_GROUP">
                <label>Contact</label>
                <input
                  type="text"
                  className="OM_INPUT"
                  placeholder="Phone number"
                  value={formData.contact_number}
                  onChange={e => setFormData({ ...formData, contact_number: e.target.value })}
                />
              </div>
            </>
          )}

          <div className="OM_FOOTER">
            <button type="button" className="OM_BTN_SECONDARY" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="OM_BTN_PRIMARY" disabled={isSubmitting || (isBarangayHallMode && !otpSent)}>
              {isSubmitting ? 'Creating...' : 'Create Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}