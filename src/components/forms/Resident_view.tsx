import React from 'react';
import './styles/Resident_view.css'; 

interface IResident {
  id?: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  dob: string;
  gender: string;
  civilStatus: string;
  contactNumber?: string;
  purok: string;
  occupation?: string;
  monthlyIncome?: string;
  housingType: string;
  activityStatus: string;
  isVoter: boolean;
  is4Ps: boolean;
  isPWD: boolean;
  isSoloParent: boolean;
  // --- Added Account Fields ---
  username?: string;
  accountStatus?: string;
}

interface ResidentViewProps {
  isOpen: boolean;
  residentData: IResident | null;
  onClose: () => void;
}

export const Resident_view: React.FC<ResidentViewProps> = ({ isOpen, residentData, onClose }) => {
  if (!isOpen || !residentData) return null;

  // Calculate Age
  const calculateAge = (dobString: string) => {
    if (!dobString) return 'N/A';
    const birthDate = new Date(dobString);
    if (isNaN(birthDate.getTime())) return 'N/A';
    
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  };

  const fullName = `${residentData.firstName} ${residentData.middleName ? residentData.middleName + ' ' : ''}${residentData.lastName}`;
  const initial = residentData.firstName?.charAt(0) || '?';

  return (
    <div className="RES_VIEW_OVERLAY" onClick={onClose}>
      <div className="RES_VIEW_MODAL" onClick={(e) => e.stopPropagation()}>
        
        {/* --- HEADER --- */}
        <div className="RES_VIEW_HEADER">
          <div className="RES_VIEW_PROFILE_MAIN">
             <div className="RES_VIEW_AVATAR_LARGE">{initial}</div>
             <div className="RES_VIEW_NAME_BLOCK">
                <h2>{fullName}</h2>
                <span className={`RES_VIEW_STATUS ${residentData.activityStatus === 'Active' ? 'ACTIVE' : 'INACTIVE'}`}>
                   {residentData.activityStatus || 'Active'} Resident
                </span>
             </div>
          </div>
          <button className="RES_VIEW_CLOSE_BTN" onClick={onClose}>
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* --- BODY --- */}
        <div className="RES_VIEW_BODY">
          
          {/* SECTION 1: Personal Information */}
          <div className="RES_VIEW_SECTION">
            <h4 className="RES_VIEW_SEC_TITLE"><i className="fas fa-id-card"></i> Personal Information</h4>
            <div className="RES_VIEW_GRID">
               <div className="RES_VIEW_DATA_ITEM">
                 <label>Date of Birth</label>
                 <span>{residentData.dob ? new Date(residentData.dob).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A'}</span>
               </div>
               <div className="RES_VIEW_DATA_ITEM">
                 <label>Age</label>
                 <span>{calculateAge(residentData.dob)} years old</span>
               </div>
               <div className="RES_VIEW_DATA_ITEM">
                 <label>Gender</label>
                 <span>{residentData.gender || 'N/A'}</span>
               </div>
               <div className="RES_VIEW_DATA_ITEM">
                 <label>Civil Status</label>
                 <span>{residentData.civilStatus || 'N/A'}</span>
               </div>
            </div>
          </div>

          {/* SECTION 2: Contact & Address */}
          <div className="RES_VIEW_SECTION">
            <h4 className="RES_VIEW_SEC_TITLE"><i className="fas fa-map-marker-alt"></i> Contact & Address</h4>
            <div className="RES_VIEW_GRID">
               <div className="RES_VIEW_DATA_ITEM">
                 <label>Zone / Purok</label>
                 <span>{residentData.purok ? `Purok ${residentData.purok}` : 'N/A'}</span>
               </div>
               <div className="RES_VIEW_DATA_ITEM">
                 <label>Contact Number</label>
                 <span>{residentData.contactNumber || 'No Contact Provided'}</span>
               </div>
               <div className="RES_VIEW_DATA_ITEM" style={{gridColumn: 'span 2'}}>
                 <label>Full Address</label>
                 <span>{residentData.purok ? `Purok ${residentData.purok}, Barangay Engineer's Hill, Baguio City` : 'Barangay Engineer\'s Hill, Baguio City'}</span>
               </div>
            </div>
          </div>

          {/* SECTION 3: Socio-Economic Data */}
          <div className="RES_VIEW_SECTION">
            <h4 className="RES_VIEW_SEC_TITLE"><i className="fas fa-briefcase"></i> Socio-Economic Data</h4>
            <div className="RES_VIEW_GRID">
               <div className="RES_VIEW_DATA_ITEM">
                 <label>Occupation</label>
                 <span>{residentData.occupation || 'Unemployed / N/A'}</span>
               </div>
               <div className="RES_VIEW_DATA_ITEM">
                 <label>Monthly Income</label>
                 <span>{residentData.monthlyIncome || 'N/A'}</span>
               </div>
               <div className="RES_VIEW_DATA_ITEM">
                 <label>Housing Type</label>
                 <span>{residentData.housingType || 'N/A'}</span>
               </div>
            </div>
          </div>

          {/* SECTION 4: Category Memberships */}
          <div className="RES_VIEW_SECTION">
            <h4 className="RES_VIEW_SEC_TITLE"><i className="fas fa-tags"></i> Sectoral Memberships</h4>
            <div className="RES_VIEW_BADGES_AREA">
               {residentData.isVoter ? <div className="R_BADGE BLUE"><i className="fas fa-check-circle"></i> Registered Voter</div> : <div className="R_BADGE GRAY"><i className="fas fa-times-circle"></i> Not a Voter</div>}
               {residentData.is4Ps && <div className="R_BADGE ORANGE"><i className="fas fa-hands-helping"></i> 4Ps Beneficiary</div>}
               {residentData.isPWD && <div className="R_BADGE PURPLE"><i className="fas fa-wheelchair"></i> PWD</div>}
               {residentData.isSoloParent && <div className="R_BADGE PINK"><i className="fas fa-user-friends"></i> Solo Parent</div>}
               
               {/* Show empty state if none applied besides voter status */}
               {!residentData.is4Ps && !residentData.isPWD && !residentData.isSoloParent && (
                 <span style={{fontSize: '0.85rem', color: '#94a3b8', alignSelf: 'center', marginLeft: '10px'}}>No special sectors applied.</span>
               )}
            </div>
          </div>

          {/* SECTION 5: Account Information */}
          <div className="RES_VIEW_SECTION">
            <h4 className="RES_VIEW_SEC_TITLE"><i className="fas fa-user-shield"></i> Portal Account</h4>
            <div className="RES_VIEW_GRID">
               <div className="RES_VIEW_DATA_ITEM">
                 <label>Username</label>
                 <span style={{fontFamily: 'monospace', fontWeight: 'bold', color: '#0f172a'}}>
                   {residentData.username || 'Not Generated / N/A'}
                 </span>
               </div>
               <div className="RES_VIEW_DATA_ITEM">
                 <label>Account Status</label>
                 <span>
                    {residentData.accountStatus ? (
                      <span style={{color: residentData.accountStatus === 'Active' ? '#16a34a' : '#ef4444', fontWeight: 'bold'}}>
                        {residentData.accountStatus}
                      </span>
                    ) : 'N/A'}
                 </span>
               </div>
               <div className="RES_VIEW_DATA_ITEM" style={{gridColumn: 'span 2'}}>
                 <label>Access Note</label>
                 <span style={{fontSize: '0.85rem', color: '#64748b'}}>
                   Residents log in to the portal using their assigned username. By default, new accounts use a standardized password format based on their first name until changed by the resident.
                 </span>
               </div>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
};