import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Officials_modal from '../../buttons/Officials_modal';
import './styles/Officials.css'; 
import { ApiService } from '../api'; 

interface IOfficial {
  id: string;
  full_name: string;
  position: string;
  status: 'Active' | 'Inactive' | 'Archived' | 'Former';
  contact_number?: string;
}

export default function OfficialsPage() {
  const [officials, setOfficials] = useState<IOfficial[]>([]);
  const [loading, setLoading] = useState(true); 
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');
  
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  const [canAddOfficial, setCanAddOfficial] = useState(false); // 🛡️ NEW: Track Write Access
  const [canManageOfficial, setCanManageOfficial] = useState(false); // 🔒 Status / archive control
  const [savingId, setSavingId] = useState<string | null>(null); // Row currently being updated
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Statuses the Punong Barangay may assign from the directory dropdown.
  // Suspended is hidden for now. Resigned is now Inactive.
  const STATUS_OPTIONS = ['Active', 'Inactive'];

  const isMounted = useRef(true);

  /**
   * 🛡️ DYNAMIC PERMISSION CHECK
   * Split into View Access vs Write Access to safely allow 'admin' to read only.
   */
  const checkPermissions = useCallback(() => {
    try {
      const sessionStr = localStorage.getItem('admin_session');
      if (!sessionStr) return { canView: false, canAdd: false, canManage: false };

      const session = JSON.parse(sessionStr);
      
      const rawRole = session.role || session.user?.role || '';
      const rawPos = session.position || session.profile?.position || '';

      const role = rawRole.toLowerCase().replace(/\s+/g, '');
      const pos = rawPos.toLowerCase().replace(/\s+/g, '');

      // Admins can see the page
      const viewWhitelist = [
        'superadmin', 
        'admin', // 👈 Added admin here
        'punongbarangay', 
        'barangaysecretary', 
        'barangayhall'
      ];

      // Admins CANNOT add officials
      const addWhitelist = [
        'superadmin',
        'punongbarangay',
        'barangaysecretary',
        'barangayhall'
      ];

      // 🔒 Only the Punong Barangay (superadmin) and Barangay Hall may reassign an
      // official's Status or archive them — this controls other people's access.
      const manageWhitelist = ['superadmin', 'punongbarangay', 'barangayhall'];

      return {
        canView: viewWhitelist.includes(role) || viewWhitelist.includes(pos),
        canAdd: addWhitelist.includes(role) || addWhitelist.includes(pos),
        canManage: manageWhitelist.includes(role) || manageWhitelist.includes(pos)
      };
    } catch (e) {
      console.error("Permission check failed", e);
      return { canView: false, canAdd: false, canManage: false };
    }
  }, []);

  const fetchOfficials = useCallback(async (signal?: AbortSignal) => {
    if (!isMounted.current) return;
    
    // 1. Check permissions locally first
    const perms = checkPermissions();
    
    if (!perms.canView) {
      setHasAccess(false);
      setLoading(false);
      setError("Access Restricted: Only the authorized users are authorized.");
      return;
    }

    // 2. Access Granted -> Fetch Data & Set Add Permission
    setHasAccess(true);
    setCanAddOfficial(perms.canAdd);
    setCanManageOfficial(perms.canManage);
    setLoading(true);
    
    try {
      const data = await ApiService.getOfficials(signal);

      if (!isMounted.current) return;
      if (!data || data.error) {
        setError(data?.error || "Failed to load directory.");
        return;
      }

      // Status is the sole source of truth — officials no longer track terms.
      setOfficials(data);
      setError('');
    } catch (err: any) {
      if (err.name !== 'AbortError' && isMounted.current) {
        setError('Connection Error: Sync with server failed.');
      }
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, [checkPermissions]);

  useEffect(() => {
    isMounted.current = true;
    const valve = new AbortController();
    fetchOfficials(valve.signal);
    return () => {
      isMounted.current = false;
      valve.abort();
    };
  }, [fetchOfficials]);

  const filteredOfficials = useMemo(() => {
    return officials.filter(o => {
      // Active stays in the live directory — Inactive leaves it (and lands in the Archive).
      // (Suspended is intentionally hidden from this view for now).
      const stat = o.status.toLowerCase();
      const isVisible = stat === 'active';
      if (!isVisible) return false;

      if (!searchTerm.trim()) return true;
      const lowerSearch = searchTerm.toLowerCase();
      return (
        o.full_name.toLowerCase().includes(lowerSearch) || 
        o.position.toLowerCase().includes(lowerSearch)
      );
    });
  }, [officials, searchTerm]);

  // 🔁 Reassign an official's status. A non-Active status revokes their admin
  // access on their next session refresh (enforced server-side). Setting them
  // to Inactive actually removes them from this directory and archives them.
  const handleStatusChange = async (off: IOfficial, newStatus: string) => {
    if (newStatus === off.status) return;

    const target = newStatus.toLowerCase();
    const warn = target === 'active'
      ? `Restore ${off.full_name} to Active? Their admin access will be re-enabled.`
      : target === 'inactive'
        ? `Set ${off.full_name} to "${newStatus}"?\n\nThis immediately revokes their admin access and moves them to the Archive.`
        : `Set ${off.full_name} to "${newStatus}"?\n\nThis immediately revokes their admin access.`;
        
    if (!window.confirm(warn)) return;

    setSavingId(off.id);
    try {
      const result = await ApiService.updateOfficialStatus(off.id, newStatus);
      if (result?.error) {
        alert(result.error);
        return;
      }
      await fetchOfficials();
    } finally {
      setSavingId(null);
    }
  };

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
            <p className="OFFIC_DENIED_SUB">{error}</p>
            <div className="OFFIC_DENIED_CODE">ERROR 403 &mdash; FORBIDDEN</div>
          </div>
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
          
          {/* 🛡️ CONDITIONALLY RENDER ADD BUTTON */}
          {canAddOfficial && (
            <button className="OFFIC_ADD_BTN" onClick={() => setIsModalOpen(true)}>
              <i className="fas fa-user-plus"></i> Add Official
            </button>
          )}
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

          <div className="OFFIC_TABLE_WRAP">
            <table className="OFFIC_TABLE_MAIN">
              <thead>
                <tr>
                  <th>NAME</th>
                  <th>POSITION</th>
                  <th className={canManageOfficial ? '' : 'OFFIC_ALIGN_RIGHT'}>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                   <tr><td colSpan={3} className="OFFIC_TABLE_LOAD"><div className="OFFIC_SYNC_SPINNER"></div>Syncing...</td></tr>
                ) : filteredOfficials.length === 0 ? (
                   <tr><td colSpan={3} className="OFFIC_TABLE_EMPTY">No active officials found matching your search.</td></tr>
                ) : (
                  filteredOfficials.map((off) => {
                    // Master account is the system anchor — its status can't be changed/archived.
                    const isMaster = off.position === 'Barangay Hall';
                    const busy = savingId === off.id;
                    return (
                    <tr key={off.id}>
                      <td className="OFFIC_NAME_CELL">
                        <div className="OFFIC_AVATAR_FLEX">
                          <div className={`OFFIC_AVATAR_CIRCLE ${off.position.includes('Punong') ? 'CAPTAIN' : 'STAFF'}`}>
                            {off.full_name.charAt(0)}
                          </div>
                          {off.full_name}
                        </div>
                      </td>
                      <td>{off.position}</td>
                      <td className={canManageOfficial ? '' : 'OFFIC_ALIGN_RIGHT'}>
                        {canManageOfficial && !isMaster ? (
                          <select
                            className="OFFIC_STATUS_SELECT"
                            value={off.status}
                            disabled={busy}
                            onChange={(e) => handleStatusChange(off, e.target.value)}
                          >
                            {/* Keep the current status selectable even if it isn't a preset */}
                            {!STATUS_OPTIONS.includes(off.status) && (
                              <option value={off.status}>{off.status}</option>
                            )}
                            {STATUS_OPTIONS.map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="OFFIC_STATUS_BADGE ACTIVE">{off.status || 'Active'}</span>
                        )}
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {isModalOpen && canAddOfficial && (
        <Officials_modal 
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSuccess={() => fetchOfficials()}
          existingOfficials={officials as any} 
        />
      )}
    </div>
  );
}