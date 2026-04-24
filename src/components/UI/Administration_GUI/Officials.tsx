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
  status: 'Active' | 'End of Term' | 'Resigned';
  contact_number?: string;
}

export default function OfficialsPage() {
  const [officials, setOfficials] = useState<IOfficial[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);

  // --- SAFE REFS FOR SYNC ---
  const isMounted = useRef(true);

  /**
   * FETCH LOGIC: Uses the Universal ApiService
   */
  const fetchOfficials = useCallback(async (signal?: AbortSignal) => {
    if (!isMounted.current) return;
    setLoading(true);
    try {
      const data = await ApiService.getOfficials(signal);

      if (isMounted.current && data !== null) {
        setOfficials(data);
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

  // --- SEARCH FILTER ---
  const filteredOfficials = useMemo(() => {
    if (!searchTerm.trim()) return officials;
    const lowerSearch = searchTerm.toLowerCase();

    return officials.filter(o => {
      const safeName = (o.full_name || '').toLowerCase();
      const safePosition = (o.position || '').toLowerCase();
      return safeName.includes(lowerSearch) || safePosition.includes(lowerSearch);
    });
  }, [officials, searchTerm]);

  return (
    <div className="OFFIC_PAGE_WRAP">
      <div className="OFFIC_MAIN_CONTAINER">
        
        <div className="OFFIC_HEADER_FLEX">
          <div className="OFFIC_TITLE_GROUP">
            <h1 className="OFFIC_PAGE_TITLE">Barangay Officials</h1>
            <p className="OFFIC_PAGE_SUB">Directory of elected and appointed personnel.</p>
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
                placeholder="Search name or position..." 
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
                   <tr><td colSpan={4} className="OFFIC_TABLE_EMPTY">No officials found.</td></tr>
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
                        <span className={`OFFIC_STATUS_BADGE ${off.status === 'Active' ? 'ACTIVE' : 'INACTIVE'}`}>
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
        existingOfficials={officials}
      />
    </div>
  );
}