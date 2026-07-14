import React, { useState, useEffect, useRef } from 'react';
import './styles/Officials_modal.css';
import { ApiService, OFFICIALS_API, getAuthHeaders } from '../UI/api';
import { cleanSignatureBackground } from '../UI/utils/signatureImage';

interface IOfficial {
  id?: string;
  full_name: string;
  email?: string;
  position: 'Barangay Hall' | 'Punong Barangay' | 'Barangay Secretary' | 'Barangay Treasurer' | 'Barangay Kagawad' | 'SK Chairperson' | 'Barangay Health Worker' | 'Barangay Nutrition Scholar';
  status: 'Active' | 'Inactive';
  contact_number?: string;
  role?: string;
  signature_url?: string;
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
  
  const [masterEmail, setMasterEmail] = useState('');
  
  const [residents, setResidents] = useState<IResident[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchWrapperRef = useRef<HTMLDivElement>(null);

  // ✍️ Signature upload — processed client-side (background removed) before
  // ever leaving the browser, so what's uploaded is always a clean transparent PNG.
  const signatureInputRef = useRef<HTMLInputElement>(null);
  const [isProcessingSignature, setIsProcessingSignature] = useState(false);
  const [signatureError, setSignatureError] = useState('');

  const [formData, setFormData] = useState<Partial<IOfficial>>({
    full_name: '',
    email: '',
    position: 'Barangay Kagawad',
    status: 'Active',
    contact_number: '',
    role: 'staff',
    signature_url: ''
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
          status: 'Active',
          contact_number: '',
          role: 'staff',
          signature_url: ''
        });
      }
      setOtpSent(false);
      setVerificationCode('');
      setTraceId('');
      setMasterEmail('');
      setSignatureError('');
      setIsProcessingSignature(false);
    }
  }, [isOpen, officialToEdit]);

  const handleSignatureUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; 
    if (!file) return;

    setSignatureError('');
    setIsProcessingSignature(true);
    try {
      const cleaned = await cleanSignatureBackground(file);
      setFormData(prev => ({ ...prev, signature_url: cleaned }));
    } catch (err: any) {
      setSignatureError(err.message || 'Could not process the signature image.');
    } finally {
      setIsProcessingSignature(false);
    }
  };

  const handleRemoveSignature = () => {
    setFormData(prev => ({ ...prev, signature_url: '' }));
    setSignatureError('');
  };

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

  // An official blocks a single-seat position while Active.
  // Setting their status to Inactive frees the seat for a replacement.
  const stillHoldsSeat = (o: IOfficial) => o.status === 'Active';

  const canAddPosition = (pos: string) => {
    if (officialToEdit && officialToEdit.position === pos) return true;
    const singleRoles = ['Barangay Hall', 'Punong Barangay', 'Barangay Secretary', 'Barangay Treasurer', 'SK Chairperson'];
    if (singleRoles.includes(pos)) {
      if (Array.isArray(existingOfficials)) {
        const exists = existingOfficials.find(o => o.position === pos && stillHoldsSeat(o));
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
        body: JSON.stringify({ email: masterEmail })
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

    if (!isBarangayHallMode && formData.full_name) {
      const nameExists = residents.some(r => {
         const middle = r.middle_name ? `${r.middle_name} ` : '';
         const fullName = `${r.first_name} ${middle}${r.last_name}`.trim().toUpperCase();
         return fullName === formData.full_name;
      });

      if (!nameExists) {
         return alert("Registration Error: Official must be an existing registered resident. Please select a valid name from the search dropdown.");
      }
    }

    if (isBarangayHallMode && (!verificationCode || !traceId)) {
      return alert("Request and verify the Gmail code first.");
    }

    if (!canAddPosition(formData.position!)) {
      return alert(`${formData.position} position is already filled.`);
    }

    if (formData.contact_number && formData.contact_number.length !== 11) {
       return alert("Contact number must be exactly 11 digits.");
    }

    setIsSubmitting(true);

    try {
      const method = officialToEdit ? 'PUT' : 'POST';
      const url = officialToEdit ? `${OFFICIALS_API}/${officialToEdit.id}` : OFFICIALS_API;

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

          {!isBarangayHallMode && (
            <div className="OM_NOTICE">
              <i className="fas fa-circle-info" />
              <div>
                <strong>{officialToEdit ? 'Modification Constraints' : 'Registration Notice'}:</strong> Single-seat positions (Punong Barangay, Barangay Secretary, Barangay Treasurer, and SK Chairperson) may only be occupied by one <strong>Active</strong> official at any given time. To assign a new official to these roles, the status of the current occupant must first be updated to <strong>Inactive</strong>.
              </div>
            </div>
          )}

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
                  full_name: isHall ? "Barangay Engineer's Hill" : '',
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
                value={isBarangayHallMode ? masterEmail : formData.full_name}
                onChange={e => {
                  const val = e.target.value;
                  if (isBarangayHallMode) {
                    setMasterEmail(val.toLowerCase());
                  } else {
                    const sanitizedName = val.replace(/[^a-zA-Z\s-ñÑ]/g, '');
                    setFormData({ ...formData, full_name: sanitizedName.toUpperCase() });
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
                  placeholder="09XXXXXXXXX"
                  value={formData.contact_number}
                  maxLength={11}
                  onChange={e => {
                    let val = e.target.value.replace(/\D/g, ''); 
                    
                    if (val.length > 0) {
                      if (val === '0') {
                        val = '09';
                      } else if (!val.startsWith('09')) {
                        val = '09' + val.replace(/^0+/, ''); 
                      }
                    }
                    
                    setFormData({ ...formData, contact_number: val.substring(0, 11) });
                  }}
                />
              </div>

              <div className="OM_FORM_GROUP">
                <label>E-Signature</label>
                <div className="OM_SIG_ROW">
                  <div className="OM_SIG_PREVIEW">
                    {isProcessingSignature ? (
                      <i className="fas fa-spinner fa-spin" />
                    ) : formData.signature_url ? (
                      <img src={formData.signature_url} alt="Signature preview" />
                    ) : (
                      <span className="OM_SIG_EMPTY">No signature</span>
                    )}
                  </div>
                  <div className="OM_SIG_ACTIONS">
                    <button
                      type="button"
                      className="OM_BTN_SECONDARY"
                      onClick={() => signatureInputRef.current?.click()}
                      disabled={isProcessingSignature}
                    >
                      {formData.signature_url ? 'Replace' : 'Upload'}
                    </button>
                    {formData.signature_url && (
                      <button type="button" className="OM_BTN_SECONDARY" onClick={handleRemoveSignature}>
                        Remove
                      </button>
                    )}
                    <input
                      ref={signatureInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      hidden
                      onChange={handleSignatureUpload}
                    />
                  </div>
                </div>
                <p className="OM_SIG_HINT">
                  Upload a photo/scan of the signature — the background is cleaned automatically.
                </p>
                {signatureError && <p className="OM_SIG_ERROR">{signatureError}</p>}
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