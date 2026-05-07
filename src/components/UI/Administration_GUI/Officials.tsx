import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Officials_modal from '../../buttons/Officials_modal';
import './styles/Officials.css'; 
import { ApiService } from '../api'; 

interface IOfficial {
  id: string;
  full_name: string;
  position: 'Punong Barangay' | 'Barangay Secretary' | 'Barangay Treasurer' | 'Barangay Kagawad' | 'SK Chairperson' | 'Barangay Health Worker' | 'Barangay Nutrition Scholar';
  term_start: string;
  term_end: string;
  status: 'Active' | 'End of Term' | 'Resigned' | 'Archived' | 'Inactive' | 'Former';
  contact_number?: string;
}

export default function OfficialsPage() {
  const [officials, setOfficials] = useState<IOfficial[]>([]);
  const [loading, setLoading] = useState(true); 
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');
  
  const [hasAccess, setHasAccess] = useState<boolean | null>(null); 
  const [isModalOpen, setIsModalOpen] = useState(false);

  const isMounted = useRef(true);

  /**
   * 🛡️ ZERO TRUST FETCH LOGIC (WHITELIST ONLY)
   * Allowed: Superadmin, Admin, Punong Barangay, Barangay Secretary, Barangay Hall
   */
  const fetchOfficials = useCallback(async (signal?: AbortSignal) => {
    if (!isMounted.current) return;
    setLoading(true);
    
    try {
      // --- 🛡️ VERIFICATION STEP: WHO IS LOGGED IN? ---
      const activeId = localStorage.getItem('profile_id') || localStorage.getItem('account_id');
      
      if (!activeId) {
        setHasAccess(false);
        return;
      }

      const myProfile = await ApiService.getProfile(activeId, signal);
      
      if (!isMounted.current) return;
      if (!myProfile || myProfile.error) {
        setHasAccess(false);
        return;
      }

      // Normalize position and role for strict comparison
      const myPosition = (myProfile.position || '').toLowerCase().trim();
      const myRole = (myProfile.role || '').toLowerCase().trim();
      
      // ✅ WHITELIST CHECK (Includes Admin Bypass)
      const isAllowed = 
        myRole === 'superadmin' ||
        myRole === 'admin' ||
        myPosition === 'punong barangay' || 
        myPosition === 'barangay secretary' || 
        myPosition === 'barangay hall';

      if (!isAllowed) {
        setHasAccess(false);
        setError("Access Restricted: Only the Punong Barangay, Secretary, Hall Staff, or System Admins are authorized.");
        return;
      }

      // --- 🛡️ DATA FETCH STEP ---
      const data = await ApiService.getOfficials(signal);

      if (!isMounted.current) return;
      if (!data || data.error) {
        setHasAccess(false); 
        return;
      }

      // ✅ ACCESS GRANTED
      setHasAccess(true);
      const now = new Date();
        
      const processedData = data.map((item: IOfficial) => {
        let currentStatus = item.status;
          
        if (item.term_end) {
          const endDate = new Date(item.term_end);
          if (!isNaN(endDate.getTime()) && endDate < now && currentStatus === 'Active') {
            currentStatus = 'End of Term';
          }
        }
          
        return { ...item, status: currentStatus };
      });

      setOfficials(processedData);
      setError('');

    } catch (err: any) {
      if (err.name !== 'AbortError' && isMounted.current) {
        console.error("[FETCH ERROR]", err);
        if (hasAccess === null) setHasAccess(true); 
        setError('Cannot reach server. Sync failed.');
      }
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, [hasAccess]);

  useEffect(() => {
    isMounted.current = true;
    const valve = new AbortController();
    
    fetchOfficials(valve.signal);
    
    return () => {
      isMounted.current = false;
      valve.abort();
    };
  }, [fetchOfficials]);

  const handleAddNew = () => {
    setIsModalOpen(true);
  };

  const filteredOfficials = useMemo(() => {
    return officials.filter(o => {
      if (o.status !== 'Active') return false;

      if (!searchTerm.trim()) return true;

      const lowerSearch = searchTerm.toLowerCase();
      const safeName = (o.full_name || '').toLowerCase();
      const safePosition = (o.position || '').toLowerCase();
      
      return safeName.includes(lowerSearch) || safePosition.includes(lowerSearch);
    });
  }, [officials, searchTerm]);

  // --- 🔒 RENDER: ACCESS DENIED ---
  if (hasAccess === false) {
    return (
      <div className="OFFIC_PAGE_WRAP">
        <div className="OFFIC_MAIN_CONTAINER">
          <div className="OFFIC_DENIED_CARD">
            <div className="OFFIC_DENIED_ICON_WRAP">
              <i className="fas fa-shield-alt OFFIC_DENIED_ICON"></i>
            </div>
            <h2 className="OFFIC_DENIED_TITLE">Access Restricted</h2>
            <p className="OFFIC_DENIED_SUB">
              Your current administrative role does not have the required permissions to view the Officials Directory.
            </p>
            {error && <p style={{ color: '#ef4444', marginTop: '0.5rem', fontSize: '0.85rem', fontWeight: 600 }}>{error}</p>}
            <div className="OFFIC_DENIED_CODE" style={{ marginTop: '1.5rem' }}>ERROR 403 &mdash; FORBIDDEN</div>
          </div>
        </div>
      </div>
    );
  }

  // --- ⏳ RENDER: LOADING STATE ---
  if (hasAccess === null) {
    return (
      <div className="OFFIC_PAGE_WRAP">
        <div className="OFFIC_SPINNER_WRAP">
          <div className="OFFIC_SYNC_SPINNER"></div>
        </div>
      </div>
    ); 
  }

  // --- 🔓 RENDER: MAIN UI ---
  return (
    <div className="OFFIC_PAGE_WRAP">
      <div className="OFFIC_MAIN_CONTAINER">
        
        <div className="OFFIC_HEADER_FLEX">
          <div className="OFFIC_TITLE_GROUP">
            <h1 className="OFFIC_PAGE_TITLE">Barangay Officials</h1>
            <p className="OFFIC_PAGE_SUB">Directory of currently active elected and appointed personnel.</p>
          </div>
          <button className="OFFIC_ADD_BTN" onClick={handleAddNew}>
            <i className="fas fa-user-plus"></i> Add Official
          </button>
        </div>

        <div className="OFFIC_TABLE_CONTAINER">
          <div className="OFFIC_SEARCH_ROW">
            <div className="OFFIC_SEARCH_INPUT_WRAP">
              <i className="fas fa-search OFFIC_SEARCH_ICON"></i>
              <input 
                className="OFFIC_SEARCH_INPUT" 
                placeholder="Search active name or position..." 
                value={searchTerm} 
                onChange={(e) => setSearchTerm(e.target.value)} 
              />
            </div>
          </div>

          {error && (
            <div className="OFFIC_ERROR_MSG">
              <i className="fas fa-exclamation-circle"></i> {error}
            </div>
          )}

          <div className="OFFIC_TABLE_WRAP">
            <table className="OFFIC_TABLE_MAIN">
              <thead>
                <tr>
                  <th>NAME</th>
                  <th>POSITION</th>
                  <th>TERM START</th>
                  <th className="OFFIC_ALIGN_RIGHT">STATUS</th>
                </tr>
              </thead>
              <tbody>
                {loading && officials.length === 0 ? (
                   <tr><td colSpan={4} className="OFFIC_TABLE_LOAD"><div className="OFFIC_SYNC_SPINNER"></div>Syncing with server...</td></tr>
                ) : filteredOfficials.length === 0 ? (
                   <tr><td colSpan={4} className="OFFIC_TABLE_EMPTY">No active officials found. (Check Archive for past records)</td></tr>
                ) : (
                  filteredOfficials.map((off) => (
                    <tr key={off.id}>
                      <td className="OFFIC_NAME_CELL">
                        <div className="OFFIC_AVATAR_FLEX">
                          <div className={`OFFIC_AVATAR_CIRCLE ${off.position === 'Punong Barangay' ? 'CAPTAIN' : 'STAFF'}`}>
                            {(off.full_name || 'X').charAt(0)}
                          </div>
                          {off.full_name}
                        </div>
                      </td>
                      <td>{off.position}</td>
                      <td>{off.term_start || 'N/A'}</td>
                      <td className="OFFIC_ALIGN_RIGHT">
                        <span className="OFFIC_STATUS_BADGE ACTIVE">
                          {off.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Officials_modal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => fetchOfficials()}
        existingOfficials={officials as any} 
      />
    </div>
  );
}