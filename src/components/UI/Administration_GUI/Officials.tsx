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
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');
  const [hasAccess, setHasAccess] = useState<boolean | null>(null); // null = checking

  const [isModalOpen, setIsModalOpen] = useState(false);

  // --- SAFE REFS FOR SYNC ---
  const isMounted = useRef(true);

  // --- 🛡️ ACCESS CONTROL (RBAC) ---
  useEffect(() => {
    // Safely read credentials from local storage
    const rawRole = localStorage.getItem('user_role') || '';
    const rawPosition = localStorage.getItem('position') || '';

    // Normalize strings to prevent mismatch errors (e.g., 'BarangayHall' vs 'Barangay Hall')
    const role = rawRole.toLowerCase().replace(/\s+/g, ''); 
    const position = rawPosition.toLowerCase();

    // 1. Master Accounts automatically bypass (Role Check)
    if (role === 'barangayhall' || role === 'superadmin') {
      setHasAccess(true);
      return;
    }

    // 2. Explicit Position Checks (Strictly allowing Punong Barangay, Secretary, and Hall)
    if (
      position.includes('punong barangay') || 
      position.includes('barangay secretary') || 
      position.includes('barangay hall') ||
      position.includes('barangayhall')
    ) {
      setHasAccess(true);
    } else {
      setHasAccess(false);
    }
  }, []);

  /**
   * FETCH LOGIC: Uses the Universal ApiService
   */
  const fetchOfficials = useCallback(async (signal?: AbortSignal) => {
    if (!isMounted.current) return;
    setLoading(true);
    try {
      const data = await ApiService.getOfficials(signal);

      if (isMounted.current && data !== null) {
        const now = new Date();
        
        // Process data: automatically flag officials whose term_end has passed
        const processedData = data.map((item: IOfficial) => {
          let currentStatus = item.status;
          
          if (item.term_end) {
            const endDate = new Date(item.term_end);
            // If the date is valid and has passed, mark them as 'End of Term'
            if (!isNaN(endDate.getTime()) && endDate < now && currentStatus === 'Active') {
              currentStatus = 'End of Term';
            }
          }
          
          return {
            ...item,
            status: currentStatus
          };
        });

        setOfficials(processedData);
        setError('');
      }
    } catch (err: any) {
      if (err.name !== 'AbortError' && isMounted.current) {
        console.error("[FETCH ERROR]", err);
        setError('Cannot reach server. Sync failed.');
      }
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasAccess === false) return; // Don't fetch if blocked

    isMounted.current = true;
    const valve = new AbortController();
    fetchOfficials(valve.signal);
    return () => {
      isMounted.current = false;
      valve.abort();
    };
  }, [fetchOfficials, hasAccess]);

  const handleAddNew = () => {
    setIsModalOpen(true);
  };

  // --- SEARCH & VISIBILITY FILTER ---
  const filteredOfficials = useMemo(() => {
    return officials.filter(o => {
      // STRICT FILTER: Only show currently 'Active' officials on this main page.
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
        <div className="OFFIC_MAIN_CONTAINER" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', textAlign: 'center' }}>
          <i className="fas fa-lock" style={{ fontSize: '4rem', color: '#ef4444', marginBottom: '1.5rem' }}></i>
          <h2 style={{ color: '#0f172a', fontSize: '2rem', fontWeight: 700 }}>Authorized access only</h2>
        </div>
      </div>
    );
  }

  // Prevents UI flashing while checking credentials
  if (hasAccess === null) return null; 

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
                  <th style={{ textAlign: 'right' }}>STATUS</th>
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
                      <td style={{ textAlign: 'right' }}>
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
        // The 'as any' bypasses the strict string literal clash between this page and the modal interface
        existingOfficials={officials as any} 
      />
    </div>
  );
}