import React, { useState, useEffect, useRef } from 'react';
import './styles/Officials_modal.css';

// ALIGNED: Importing the Mastermind API Service
import { ApiService, OFFICIALS_API, getAuthHeaders } from '../UI/api'; 

// --- INTERFACES ---
interface IOfficial {
  id?: string;
  full_name: string;
  // 🎯 STRICTLY FILTERED: Only positions from the government profile page.
  position: 
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

// ALIGNED: Matches the new snake_case residents_records database
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
  existingOfficials?: IOfficial[]; // Make optional to prevent hard crashes
}

// 🎯 STRICTLY FILTERED: The exact positions on the Engineer's Hill profile.
const POSITIONS = [
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

  // 1. FETCH RESIDENTS (For Search using ApiService)
  useEffect(() => {
    const fetchResidents = async () => {
      // ApiService handles the try/catch and headers automatically
      const data = await ApiService.getResidents();
      
      if (data) {
        setResidents(Array.isArray(data) ? data : data.residents || []);
      } else {
        console.error("Failed to load residents. Backend may be offline or unauthorized.");
        setResidents([]); // Fallback to prevent crashes
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
  }, [isOpen]);

  // 2. LOAD DATA IF EDITING
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

  // 3. FILTER RESIDENTS (Null-safe and aligned to snake_case)
  const filteredResidents = residents.filter(r => {
    const safeFirst = r.first_name || '';
    const safeLast = r.last_name || '';
    const fullName = `${safeFirst} ${safeLast}`.toLowerCase();
    const query = (formData.full_name || '').toLowerCase();
    return fullName.includes(query) && fullName !== query;
  });

  const handleSelectResident = (r: IResident) => {
    const middle = r.middle_name ? `${r.middle_name} ` : '';
    const fullName = `${r.first_name} ${middle}${r.last_name}`.trim();
    
    setFormData(prev => ({
      ...prev,
      full_name: fullName,
      contact_number: r.contact_number || prev.contact_number
    }));
    setShowDropdown(false);
  };

  // VALIDATION (Bulletproof)
  const canAddPosition = (pos: string) => {
    if (officialToEdit && officialToEdit.position === pos) return true;
    
    // 🎯 FILTERED: Single roles specific to this filtered list.
    const singleRoles = [
      'Punong Barangay', 
      'Barangay Secretary', 
      'Barangay Treasurer', 
      'SK Chairperson',
      'Barangay Health Worker',
      'Barangay Nutrition Scholar'
    ];
    
    if (singleRoles.includes(pos)) {
      if (Array.isArray(existingOfficials)) {
        const exists = existingOfficials.find(o => o.position === pos && o.status === 'Active');
        if (exists) return false;
      }
    }
    return true;
  };

  // SUBMIT
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.full_name || !formData.term_start) {
      return alert("Full Name and Term Start are required.");
    }
    if (!canAddPosition(formData.position!)) {
      return alert(`Error: There is already an Active ${formData.position}.`);
    }

    setIsSubmitting(true);

    try {
      const method = officialToEdit ? 'PUT' : 'POST';
      const url = officialToEdit ? `${OFFICIALS_API}/${officialToEdit.id}` : OFFICIALS_API;

      const res = await fetch(url, {
        method,
        headers: getAuthHeaders(false, method), // Using the global handshake
        body: JSON.stringify(formData) 
      });

      if (res.ok) {
        const result = await res.json();
        
        // ALIGNED: Pop up the automated credentials returned from the backend
        if (method === 'POST' && result.account) {
          alert(`
            Official Registered Successfully!
            
            SYSTEM AUTO-GENERATED ACCOUNT:
            -----------------------------------
            Username: ${result.account.username}
            Password: ${result.account.password}
            -----------------------------------
            Please provide these credentials to the official.
          `);
        } else {
          alert(officialToEdit ? 'Official updated successfully.' : 'Official registered successfully.');
        }

        onSuccess();
        onClose();
      } else {
        const errorData = await res.json().catch(() => ({}));
        alert(errorData.error || "Failed to save record. Check backend logs.");
      }
    } catch (err) {
      alert("System error connecting to backend. Is the server running?");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="OM_OVERLAY" onClick={onClose}>
      <div className="OM_CONTENT" onClick={e => e.stopPropagation()}>
        
        <div className="OM_HEADER">
          <h3>{officialToEdit ? 'Update Official' : 'Register Official'}</h3>
          <p>System account will be auto-generated upon saving.</p>
        </div>

        <form onSubmit={handleSubmit} className="OM_FORM">
          
          <div className="OM_FORM_GROUP" ref={searchWrapperRef}>
            <label>Full Name</label>
            <div className="OM_SEARCH_INPUT_WRAP">
              <input 
                type="text" 
                required 
                className="OM_INPUT" 
                placeholder="Search resident or type name..."
                value={formData.full_name}
                onChange={e => {
                  setFormData({...formData, full_name: e.target.value});
                  setShowDropdown(true);
                }}
                onFocus={() => setShowDropdown(true)}
                autoComplete="off"
              />
              
              {showDropdown && filteredResidents.length > 0 && (
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
            <label>Position</label>
            <select 
              className="OM_SELECT" 
              value={formData.position}
              onChange={e => setFormData({...formData, position: e.target.value as any})}
            >
              {POSITIONS.map(p => (
                <option key={p} value={p} disabled={!canAddPosition(p)}>
                  {p} {!canAddPosition(p) ? '(Filled)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="OM_ROW">
            <div className="OM_FORM_GROUP">
              <label>Term Start</label>
              <input 
                type="date" 
                required 
                className="OM_INPUT" 
                value={formData.term_start} 
                onChange={e => setFormData({...formData, term_start: e.target.value})} 
              />
            </div>
            <div className="OM_FORM_GROUP">
              <label>Term End</label>
              <input 
                type="date" 
                className="OM_INPUT" 
                value={formData.term_end} 
                onChange={e => setFormData({...formData, term_end: e.target.value})} 
              />
            </div>
          </div>

          <div className="OM_FORM_GROUP">
            <label>Contact Number</label>
            <input 
              type="text" 
              className="OM_INPUT" 
              placeholder="Contact Details" 
              value={formData.contact_number} 
              onChange={e => setFormData({...formData, contact_number: e.target.value})} 
            />
          </div>

          <div className="OM_FOOTER">
            <button type="button" className="OM_BTN_SECONDARY" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="OM_BTN_PRIMARY" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save & Generate Account'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}