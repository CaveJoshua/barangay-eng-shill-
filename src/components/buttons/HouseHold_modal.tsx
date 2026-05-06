import { useState, useRef, useEffect } from 'react';
import './styles/Household_modal.css'; 
import { ApiService } from '../UI/api';

export interface HouseholdModalProps {
  onClose: () => void;
  onSaveSuccess?: () => void;
  initialData?: any; 
}

// ─── TYPES & INTERFACES ───
export interface IMemberForm {
  ui_key: string; 
  record_id: string; 
  name: string;
  relation: string;
  age: string;
}

export interface IHouseholdForm {
  head_id: string; 
  head_name: string;
  head_age: string;
  zone: string;
  tenure: string;
  water: string;
  toilet: string;
  members: IMemberForm[];
}

interface ISearchableResident {
  id: string; 
  name: string;
  age: number;
  zone: string;
}

// ─── INITIAL STATE ───
const initialHouseholdState: IHouseholdForm = {
  head_id: '',
  head_name: '',
  head_age: '',
  zone: '',
  tenure: 'Owned',
  water: 'Deep Well',
  toilet: 'Water Sealed',
  members: []
};

// ─── STANDARD RELATIONSHIPS (Boarder included) ───
const PRESET_RELATIONS = ['Spouse', 'Child', 'Parent', 'Sibling', 'Grandfather', 'Grandmother', 'Boarder'];

// ─── SUB-COMPONENT: MEMBER ROW ───
const MemberRow = ({ member, onUpdate, onRemove, residents, headId, currentMemberIds }: { 
  member: IMemberForm; 
  onUpdate: (key: string, field: keyof IMemberForm, value: any) => void;
  onRemove: (key: string) => void;
  residents: ISearchableResident[];
  headId: string;
  currentMemberIds: string[];
}) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const wrapperRef = useRef<HTMLTableRowElement>(null);

  const safeName = member.name || "";
  
  // 🛡️ DYNAMIC "OTHER" STATE LOGIC
  const [isCustomRelation, setIsCustomRelation] = useState(() => {
    if (!member.relation) return false;
    return !PRESET_RELATIONS.includes(member.relation);
  });
  
  // 🛡️ SMART FILTER
  const filtered = residents.filter(r => {
    if (!r.name.toLowerCase().includes(safeName.toLowerCase())) return false;
    if (String(r.id) === String(headId)) return false; 
    if (currentMemberIds.includes(r.id) && r.id !== member.record_id) return false; 
    return true;
  });

  useEffect(() => {
    const clickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", clickOutside);
    return () => document.removeEventListener("mousedown", clickOutside);
  }, []);

  const handleRelationDropdownChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === 'Other') {
      setIsCustomRelation(true);
      onUpdate(member.ui_key, 'relation', ''); 
    } else {
      setIsCustomRelation(false);
      onUpdate(member.ui_key, 'relation', val);
    }
  };

  return (
    <tr ref={wrapperRef} className="HP_TABLE_ROW">
      {/* 1. Name Search Cell */}
      <td className="HP_MEMBER_CELL HP_RELATIVE_CELL">
        <div className="HP_COMBOBOX_WRAP">
          <input 
            className="HP_MEMBER_FIELD" 
            placeholder="Search Resident..." 
            value={safeName} 
            onFocus={() => setIsDropdownOpen(true)}
            onChange={(e) => { 
              onUpdate(member.ui_key, 'name', e.target.value); 
              onUpdate(member.ui_key, 'record_id', ''); 
              setIsDropdownOpen(true); 
            }} 
          />
          {isDropdownOpen && safeName && (
            <div className="HP_DROP_RESULTS">
              {filtered.length === 0 ? (
                <div className="HP_DROP_ITEM HP_DROP_ITEM_EMPTY">
                  No matches (or already added to household)
                </div>
              ) : (
                filtered.slice(0, 5).map(res => (
                  <div key={res.id} className="HP_DROP_ITEM" onClick={() => { 
                    onUpdate(member.ui_key, 'record_id', res.id); 
                    onUpdate(member.ui_key, 'name', res.name); 
                    onUpdate(member.ui_key, 'age', res.age.toString()); 
                    setIsDropdownOpen(false); 
                  }}>
                    <span className="HP_DROP_NAME">{res.name}</span>
                    <span className="HP_DROP_SUB">{res.age} yrs</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </td>

      {/* 2. Relation Dropdown & Custom Input Cell */}
      <td className="HP_MEMBER_CELL">
        <div className="HP_RELATION_WRAP">
          <select 
            className="HP_MEMBER_FIELD" 
            value={isCustomRelation ? "Other" : (member.relation || "")} 
            onChange={handleRelationDropdownChange}
          >
            <option value="">Select Relation...</option>
            {PRESET_RELATIONS.map(rel => (
              <option key={rel} value={rel}>{rel}</option>
            ))}
            <option value="Other">Other (Specify)</option>
          </select>
          
          {/* Appears smoothly when 'Other' is selected */}
          {isCustomRelation && (
            <input 
              type="text" 
              className="HP_MEMBER_FIELD HP_CUSTOM_RELATION_INPUT" 
              placeholder="E.g., Uncle, Niece..." 
              value={member.relation} 
              onChange={(e) => onUpdate(member.ui_key, 'relation', e.target.value)}
              autoFocus
            />
          )}
        </div>
      </td>

      {/* 3. Age Cell */}
      <td className="HP_MEMBER_CELL HP_AGE_CELL">
        {member.age ? `${member.age} yrs` : ''}
      </td>

      {/* 4. Action Cell */}
      <td className="HP_MEMBER_CELL HP_CENTERED_ACTION_CELL">
        <button type="button" className="HP_REMOVE_ROW_BTN" onClick={() => onRemove(member.ui_key)} title="Remove Member">
          <i className="fas fa-times"></i>
        </button>
      </td>
    </tr>
  );
};

// ─── MAIN COMPONENT ───
export default function HouseHold_modal({ onClose, onSaveSuccess, initialData }: HouseholdModalProps) {
  const headDropdownRef = useRef<HTMLDivElement>(null);
  const [isHeadDropdownOpen, setIsHeadDropdownOpen] = useState(false);
  
  const [formData, setFormData] = useState<IHouseholdForm>(initialHouseholdState);
  const [isLoading, setIsLoading] = useState(false);
  const [residentList, setResidentList] = useState<ISearchableResident[]>([]);
  
  const isMounted = useRef(true);

  // 1 & 2. COMBINED FETCH FOR SPEED (Handshake Mode)
  useEffect(() => {
    isMounted.current = true;
    const valve = new AbortController();

    const initializeData = async () => {
      setIsLoading(true);
      try {
        const [resData, hhData] = await Promise.all([
          ApiService.getResidents(valve.signal),
          initialData ? ApiService.getHouseholds(valve.signal) : Promise.resolve(null)
        ]);

        if (!isMounted.current) return;

        let rawResidents: any[] = [];

        if (resData) {
          rawResidents = Array.isArray(resData) ? resData : [];
          const formatted: ISearchableResident[] = rawResidents.map((r: any) => ({
            id: String(r.record_id || r.id), 
            name: `${r.last_name}, ${r.first_name}`,
            age: r.dob ? new Date().getFullYear() - new Date(r.dob).getFullYear() : 0,
            zone: r.purok || ""
          }));
          setResidentList(formatted);
        }

        if (initialData && hhData) {
          const data = hhData.find((h: any) => h.id === initialData.id) || initialData;
          
          if (data) {
            const addr = data.address || "";
            const parts = addr.split('|').map((s: string) => s.split(':')[1]?.trim() || '');

            let headName = data.head?.first_name ? `${data.head.last_name}, ${data.head.first_name}` : (data.head || initialData.head || '');
            let actualHeadId = String(data.head_id || data.head?.id || initialData.head_id || '');
            let headAge = data.head?.dob ? (new Date().getFullYear() - new Date(data.head.dob).getFullYear()).toString() : '';

            if (!actualHeadId && headName) {
              const matchedHead = rawResidents.find((r: any) => 
                `${r.last_name}, ${r.first_name}`.toLowerCase() === headName.toLowerCase() ||
                (r.name || '').toLowerCase() === headName.toLowerCase()
              );
              if (matchedHead) {
                actualHeadId = String(matchedHead.record_id || matchedHead.id);
                headAge = matchedHead.dob ? (new Date().getFullYear() - new Date(matchedHead.dob).getFullYear()).toString() : '';
              }
            }

            let sourceMembers = data.members || initialData.members || [];
            
            if (sourceMembers.length === 0 && rawResidents.length > 0) {
              sourceMembers = rawResidents.filter((r: any) => String(r.household_id) === String(data.id));
            }

            const subMembers = sourceMembers
              .filter((m: any) => {
                const isSameId = String(m.record_id || m.id) === actualHeadId;
                const isLabeledHead = String(m.relationship_to_head || m.relationship).toLowerCase().includes('head');
                return !isSameId && !isLabeledHead; 
              })
              .map((m: any, idx: number) => {
                const profile = rawResidents.find((r: any) => String(r.record_id || r.id) === String(m.record_id || m.id)) || m;
                const lastName = profile.last_name || m.last_name || '';
                const firstName = profile.first_name || m.first_name || '';
                
                return {
                  ui_key: `mem-${Date.now()}-${idx}`,
                  record_id: String(profile.record_id || profile.id || ''),
                  name: lastName && firstName ? `${lastName}, ${firstName}` : (profile.name || ''),
                  relation: m.relationship_to_head || m.relationship || 'Member',
                  age: profile.dob ? (new Date().getFullYear() - new Date(profile.dob).getFullYear()).toString() : ''
                };
              });

            setFormData({
              head_id: actualHeadId,
              head_name: headName,
              head_age: headAge,
              zone: data.zone || '',
              tenure: parts[0] || 'Owned',
              water: parts[1] || 'Deep Well',
              toilet: parts[2] || 'Water Sealed',
              members: subMembers
            });
          }
        }
      } catch (err: any) { 
        if (err.name !== 'AbortError' && isMounted.current) {
          console.error("Failed to load household details", err); 
        }
      } finally { 
        if (isMounted.current) setIsLoading(false); 
      }
    };

    initializeData();

    return () => {
      isMounted.current = false;
      valve.abort();
    };
  }, [initialData]);

  // ─── FORM UPDATERS ───
  const updateForm = (field: keyof IHouseholdForm, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const updateMember = (ui_key: string, field: keyof IMemberForm, value: any) => {
    setFormData(prev => ({
      ...prev,
      members: prev.members.map(m => m.ui_key === ui_key ? { ...m, [field]: value } : m)
    }));
  };

  const removeMember = (ui_key: string) => {
    setFormData(prev => ({ 
      ...prev, 
      members: prev.members.filter(m => m.ui_key !== ui_key) 
    }));
  };

  const addMemberRow = () => {
    setFormData(prev => ({
      ...prev,
      members: [...prev.members, { ui_key: `new-${Date.now()}`, record_id: '', name: '', relation: '', age: '' }]
    }));
  };

  // Click-outside listener for Head Dropdown
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (headDropdownRef.current && !headDropdownRef.current.contains(e.target as Node)) {
        setIsHeadDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // ─── SAVE HANDLER ───
  const handleSave = async () => {
    if (!formData.head_id) {
      return alert("A Family Head is required to save a household profile.");
    }

    const unifiedPayload = {
      head_id: formData.head_id,
      zone: formData.zone || 'Unassigned',
      address: `Tenure: ${formData.tenure} | Water: ${formData.water} | Toilet: ${formData.toilet}`,
      members: formData.members
        .filter(m => m.record_id !== '') 
        .map(m => ({
          record_id: m.record_id,
          // Fallback to "Other" if they left the custom input blank to prevent database errors
          relationship: m.relation.trim() === '' ? 'Other' : m.relation
        }))
    };

    setIsLoading(true);

    try {
      const result = await ApiService.saveHousehold(initialData?.id, unifiedPayload);

      if (result.success) {
        if (onSaveSuccess) onSaveSuccess();
        onClose();
      } else {
        alert(`Failed to save: ${result.error}`);
      }
    } catch (error: any) { 
      alert(`Connection failed.`); 
    } finally { 
      setIsLoading(false); 
    }
  };

  // ─── SMART FILTER FOR HEAD DROPDOWN ───
  const safeHeadName = formData.head_name || "";
  const currentMemberIds = formData.members.map(m => m.record_id).filter(id => id !== '');
  
  const filteredHead = residentList.filter(r => {
    if (!r.name.toLowerCase().includes(safeHeadName.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="HP_MODAL_OVERLAY">
      <div className="HP_MODAL_CARD">
        
        <div className="HP_MODAL_HEADER">
          <h2 className="HP_MODAL_TITLE">
            {initialData ? 'Edit Household Profile' : 'New Household Profile'}
          </h2>
          <button type="button" className="HP_MODAL_CLOSE_X" onClick={onClose}>&times;</button>
        </div>
        
        <div className="HP_MODAL_SCROLL_BODY">
          
          <div className="HP_FORM_SECTION">
            <div className="HP_SECTION_INDICATOR">1. Family Head Details</div>
            <div className="HP_FORM_GRID">
              
              <div className="HP_FORM_GROUP HP_GRID_FULL" ref={headDropdownRef}>
                <label className="HP_FORM_LABEL">Family Head (Search by Name)</label>
                <div className="HP_COMBOBOX_WRAP">
                  <input 
                    className="HP_FORM_INPUT" 
                    placeholder="Type to search..." 
                    value={safeHeadName} 
                    onFocus={() => setIsHeadDropdownOpen(true)}
                    onChange={(e) => { 
                      updateForm('head_name', e.target.value); 
                      updateForm('head_id', ''); 
                    }} 
                  />
                  {formData.head_age && <span className="HP_INPUT_AGE_BADGE">{formData.head_age} yrs old</span>}
                  
                  {isHeadDropdownOpen && safeHeadName && (
                    <div className="HP_DROP_RESULTS">
                      {filteredHead.length === 0 ? (
                        <div className="HP_DROP_ITEM HP_DROP_ITEM_EMPTY">
                          No matching residents found
                        </div>
                      ) : (
                        filteredHead.slice(0, 6).map(res => (
                          <div key={res.id} className="HP_DROP_ITEM" onClick={() => { 
                            // 🛡️ THE PROMOTION FIX: Set new head AND remove them from the members list
                            setFormData(prev => ({
                              ...prev,
                              head_id: res.id,
                              head_name: res.name,
                              head_age: res.age.toString(),
                              zone: res.zone,
                              members: prev.members.filter(m => m.record_id !== res.id)
                            }));
                            setIsHeadDropdownOpen(false); 
                          }}>
                            <span className="HP_DROP_NAME">{res.name}</span>
                            <span className="HP_DROP_SUB">{res.zone || "Unassigned Zone"} • {res.age} yrs</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="HP_FORM_GROUP">
                <label className="HP_FORM_LABEL">Address Zone / Purok</label>
                <div className="HP_STATIC_FIELD">{formData.zone || "Auto-detected from Head"}</div>
              </div>

              <div className="HP_FORM_GROUP">
                <label className="HP_FORM_LABEL">Tenurial Status</label>
                <select className="HP_FORM_SELECT" value={formData.tenure} onChange={(e) => updateForm('tenure', e.target.value)}>
                  <option value="Owned">Owned</option>
                  <option value="Rented">Rented</option>
                  <option value="Living with Relatives">Living with Relatives</option>
                </select>
              </div>

            </div>
          </div>

          <div className="HP_FORM_SECTION">
            <div className="HP_SECTION_INDICATOR">2. Assign Family Members</div>
            
            {/* 🛡️ ADDED: Proper semantic table setup with a Thead to make it look like a real data table */}
            <table className="HP_MEMBERS_TABLE">
              <thead className="HP_MEMBERS_HEAD">
                <tr>
                  <th className="HP_TH_NAME">Resident Name</th>
                  <th className="HP_TH_RELATION">Relationship</th>
                  <th className="HP_TH_AGE">Age</th>
                  <th className="HP_TH_ACTION"></th>
                </tr>
              </thead>
              <tbody className="HP_MEMBERS_BODY">
                {formData.members.map(m => (
                  <MemberRow 
                    key={m.ui_key} 
                    member={m} 
                    residents={residentList} 
                    onUpdate={updateMember} 
                    onRemove={removeMember}
                    headId={formData.head_id}
                    currentMemberIds={currentMemberIds}
                  />
                ))}
              </tbody>
            </table>
            
            <button className="HP_ADD_ROW_TRIGGER" onClick={addMemberRow} type="button">
              <i className="fas fa-plus HP_ADD_ICON"></i> Add Member Row
            </button>
          </div>

        </div>

        <div className="HP_MODAL_FOOTER">
          <button className="HP_CANCEL_BTN" onClick={onClose} disabled={isLoading} type="button">Cancel</button>
          <button className="HP_SAVE_BTN" onClick={handleSave} disabled={isLoading || !formData.head_id} type="button">
            {isLoading ? 'Processing...' : 'Save Household Profile'}
          </button>
        </div>

      </div>
    </div>
  );
}