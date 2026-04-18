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

  // ── HELPER: IS THIS THE MASTER ACCOUNT? ───────────────
  const isSuperAdminMode = formData.position === 'Super Admin';

  // ── 1. RESIDENT DATA SYNC ───────────────────────────────────
  useEffect(() => {
    const fetchResidents = async () => {
      // Skip fetching resident list if setting up the Master Gmail account
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

  // ── 4. ROLE VALIDATION (SINGLE-OCCUPANCY CHECK) ────────────
  const canAddPosition = (pos: string) => {
    if (officialToEdit && officialToEdit.position === pos) return true;
    
    // Roles that can only have ONE active person at a time
    const singleRoles = [
      'Super Admin',
      'Punong Barangay', 
      'Barangay Secretary', 
      'Barangay Treasurer', 
      'SK Chairperson'
    ];
    
    if (singleRoles.includes(pos)) {
      if (Array.isArray(existingOfficials)) {
        const exists = existingOfficials.find(o => o.position === pos && o.status === 'Active');
        if (exists) return false;
      }
    }
    return true;
  };

  // ── 5. FINAL SUBMISSION ─────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.full_name) {
      return alert("Error: Required Identity Field (Name or Gmail) is missing.");
    }

    // Term Start is only required if the user is NOT a Super Admin
    if (!isSuperAdminMode && !formData.term_start) {
      return alert("Error: Service Start date is required for standard officials.");
    }

    if (!canAddPosition(formData.position!)) {
      return alert(`Access Denied: The ${formData.position} slot is already occupied.`);
    }

    setIsSubmitting(true);

    try {
      const method = officialToEdit ? 'PUT' : 'POST';
      const url = officialToEdit ? `${OFFICIALS_API}/${officialToEdit.id}` : OFFICIALS_API;

      const res = await fetch(url, {
        method,
        headers: getAuthHeaders(false, method),
        body: JSON.stringify(formData) 
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
          <p>{isSuperAdminMode ? 'Barangay Hall Master Gmail Configuration.' : 'Registering authorized personnel identity.'}</p>
        </div>

        <form onSubmit={handleSubmit} className="OM_FORM">
          
          <div className="OM_FORM_GROUP" ref={searchWrapperRef}>
            <label>{isSuperAdminMode ? 'Barangay Hall Gmail (Super Admin)' : 'Legal Full Name'}</label>
            <div className="OM_SEARCH_INPUT_WRAP">
              <input 
                type={isSuperAdminMode ? "email" : "text"} 
                required 
                className="OM_INPUT" 
                placeholder={isSuperAdminMode ? "e.g. samplehall@gmail.com" : "Search resident or enter name..."}
                value={formData.full_name}
                onChange={e => {
                  const val = e.target.value;
                  // Gmail = Lowercase | Names = Uppercase
                  setFormData({
                    ...formData, 
                    full_name: isSuperAdminMode ? val.toLowerCase() : val.toUpperCase()
                  });
                  if (!isSuperAdminMode) setShowDropdown(true);
                }}
                onFocus={() => !isSuperAdminMode && setShowDropdown(true)}
                autoComplete="off"
              />
              
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
                setFormData({
                  ...formData, 
                  position: e.target.value as any, 
                  full_name: '',
                  // Reset terms if switching back to an official role
                  term_start: e.target.value === 'Super Admin' ? '' : new Date().toISOString().split('T')[0],
                  term_end: ''
                });
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

          {/* 🎯 UI TICKET: Hide Terms and Dates entirely if this is the Master Account */}
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
            <button type="submit" className="OM_BTN_PRIMARY" disabled={isSubmitting}>
              {isSubmitting ? 'Syncing...' : 'Validate & Authorize'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}