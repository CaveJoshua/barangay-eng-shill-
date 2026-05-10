import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import './styles/AccountManagement.css';
import { ApiService } from '../api'; 

// ─── Types ────────────────────────────────────────────────────────────────────
interface IAccount {
  id:          string;
  username:    string;
  role:        string;
  status?:     string;
  created_at?: string;
  source:      'resident' | 'official';
  profileName: string;
}

type TabState = 'Officials' | 'Residents';
const ITEMS_PER_PAGE = 10;

export default function AccountManagement() {
  // 🛡️ ALIGNED ACCESS CONTROL STATE
  const [hasAccess,          setHasAccess]       = useState<boolean | null>(null);
  const [canViewOfficials,   setCanViewOfficials]= useState<boolean>(false); 
  const [canEditPasswords,   setCanEditPasswords]= useState<boolean>(false);
  const [currentUserRole,    setCurrentUserRole] = useState<string>(''); 

  const [accounts,         setAccounts]        = useState<IAccount[]>([]);
  const [error,            setError]           = useState('');
  const [isSyncing,        setIsSyncing]       = useState(false);
  const [activeTab,        setActiveTab]       = useState<TabState>('Officials');
  const [searchTerm,       setSearchTerm]      = useState('');
  const [selectedAccount,  setSelectedAccount] = useState<IAccount | null>(null);
  const [isResetOpen,      setIsResetOpen]     = useState(false);
  const [newPassword,      setNewPassword]     = useState('');
  const [showPassword,     setShowPassword]    = useState(false); 

  // ── PAGINATION STATE ──
  const [currentPage,      setCurrentPage]     = useState(1);

  // ── SAFE REFS FOR THE HANDSHAKE ──
  const isFetching = useRef(false);
  const isMounted = useRef(true);

  // 🛡️ ── ALIGNED DYNAMIC PERMISSION CHECK ──
  useEffect(() => {
    try {
      const sessionStr = localStorage.getItem('admin_session');
      let role = '';
      let pos = '';

      if (sessionStr) {
        const session = JSON.parse(sessionStr);
        const rawRole = session.role || session.user?.role || session.user_role || '';
        const rawPos = session.position || session.profile?.position || '';

        role = rawRole.toLowerCase().replace(/\s+/g, '');
        pos = rawPos.toLowerCase().replace(/\s+/g, '');
      } else {
        role = (localStorage.getItem('user_role') || '').toLowerCase().replace(/\s+/g, '');
      }

      // Prioritize whichever has a value
      const activeRole = pos || role;
      setCurrentUserRole(activeRole);

      // 👁️ VIEW ALL ACCESS: Can see both tabs (Officials & Residents)
      const fullViewWhitelist = [
        'superadmin',  
        'punongbarangay', 
        'barangaysecretary', 
        'barangayhall',
        // --- View Only Roles Below ---
        'kagawad',
        'barangaykagawad', 
        'skchairperson',
        'barangayskchairperson',
        'treasurer',
        'barangaytreasurer'
      ];

      // ✏️ EDIT ACCESS: Roles that can actually change passwords
      // Notice: Kagawad, SK, and Treasurer are NOT here, so they can only view.
      const editAllRoles = [
        'superadmin', 
        'punongbarangay', 
        'barangaysecretary', 
        'barangayhall'
      ];

      // 👁️ VIEW RESTRICTED ACCESS: Can ONLY see Resident Accounts
      const residentViewWhitelist = [
        'bhw',
        'barangayhealthworker'
      ];

      // Check Edit permissions
      if (editAllRoles.includes(role) || editAllRoles.includes(pos)) {
        setCanEditPasswords(true);
      } else {
        setCanEditPasswords(false);
      }

      // Check View Permissions 
      if (fullViewWhitelist.includes(role) || fullViewWhitelist.includes(pos)) {
        setHasAccess(true);
        setCanViewOfficials(true);
      } else if (residentViewWhitelist.includes(role) || residentViewWhitelist.includes(pos)) {
        setHasAccess(true);
        setCanViewOfficials(false);
        setActiveTab('Residents'); 
      } else {
        setHasAccess(false);
      }
    } catch (err) {
      setHasAccess(false);
    }
  }, []);
  
  // ── Fetch (Smart Handshake) ───────────────────────────────────────────
  const fetchAccounts = useCallback(async (silent = false, signal?: AbortSignal) => {
    if (!isMounted.current || isFetching.current || !hasAccess) return;
    
    if (!silent) setIsSyncing(true);
    isFetching.current = true;
    
    try {
      const data = await ApiService.getAccounts(signal);
      
      if (isMounted.current && data !== null) {
        setAccounts(data);
        setError(''); 
      }
    } catch (err: any) {
      if (err.name !== 'AbortError' && isMounted.current) {
        if (accounts.length === 0) setError('Cannot reach server. Sync failed.');
      }
    } finally {
      isFetching.current = false;
      if (isMounted.current) setIsSyncing(false);
    }
  }, [accounts.length, hasAccess]);

  useEffect(() => {
    if (hasAccess !== true) return;

    isMounted.current = true;
    const valve = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout>;

    const runPulse = async () => {
      if (!isMounted.current) return;
      
      if (document.visibilityState === 'visible') {
        await fetchAccounts(true, valve.signal);
      }

      if (isMounted.current) {
        timeoutId = setTimeout(runPulse, 300000); 
      }
    };

    fetchAccounts(false, valve.signal).then(() => {
      if (isMounted.current) {
        timeoutId = setTimeout(runPulse, 1000);
      }
    });

    return () => {
      isMounted.current = false;
      valve.abort();
      clearTimeout(timeoutId);
    };
  }, [fetchAccounts, hasAccess]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchTerm]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) return alert('Minimum 8 characters.');
    if (!selectedAccount) return;
    try {
      const result = await ApiService.resetPassword(selectedAccount.id, { password: newPassword });
      if (result.success) {
        alert('Password updated successfully.');
        setIsResetOpen(false);
        setNewPassword('');
        setShowPassword(false);
      } else { throw new Error(result.error); }
    } catch (err: any) { alert(`Reset failed: ${err.message}`); }
  };

  // 🛡️ Row-Level Password Reset Permission Check
  const canChangePassword = useCallback((targetAcc: IAccount) => {
    const targetRole = (targetAcc.role || '').toLowerCase().replace(/\s+/g, '');
    
    // No one can change 'barangayhall' password except a superadmin
    if (targetRole === 'barangayhall' && currentUserRole !== 'superadmin') {
      return false;
    }

    // If they are in the editAllRoles whitelist (determined on mount)
    if (canEditPasswords) {
      return true;
    }

    // BHW restricted strictly to editing residents
    if (currentUserRole === 'bhw' || currentUserRole === 'barangayhealthworker') {
      return targetAcc.source === 'resident';
    }

    // View-only roles (like Kagawad, SK, Treasurer) hit this and return false
    return false;
  }, [currentUserRole, canEditPasswords]);


  // ── Filter + Search Logic ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    return accounts.filter(acc =>
      !q ||
      acc.username?.toLowerCase().includes(q) ||
      acc.role?.toLowerCase().includes(q) ||
      acc.profileName?.toLowerCase().includes(q)
    );
  }, [accounts, searchTerm]);

  const officialAccounts = filtered.filter(a => a.source === 'official');
  const residentAccounts = filtered.filter(a => a.source === 'resident');
  
  // 🛡️ Ensure they can't see officials even if they hack the activeTab state
  const tableData = (activeTab === 'Officials' && canViewOfficials) ? officialAccounts : residentAccounts;

  // ── PAGINATION SLICING ──
  const totalPages = Math.ceil(tableData.length / ITEMS_PER_PAGE);
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return tableData.slice(start, start + ITEMS_PER_PAGE);
  }, [tableData, currentPage]);


  if (hasAccess === null) {
    return (
      <div className="ACC_PAGE_WRAP">
        <div className="ACC_MAIN_CONTAINER" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
          <div className="SPINNER" style={{ width: '40px', height: '40px', borderTopColor: '#3b82f6', borderRadius: '50%', border: '4px solid #e2e8f0', animation: 'spin 1s linear infinite' }} />
        </div>
      </div>
    );
  }

  // ── 🛑 ALIGNED DESIGN: Professional "Access Restricted" Card ──
  if (hasAccess === false) {
    return (
      <div className="ACC_PAGE_WRAP">
        <div className="ACC_MAIN_CONTAINER">
          <div className="ACC_DENIED_CARD">
            <div className="ACC_DENIED_ICON_WRAP">
              <i className="fas fa-shield-alt ACC_DENIED_ICON"></i>
            </div>
            <h2 className="ACC_DENIED_TITLE">Access Restricted</h2>
            <p className="ACC_DENIED_SUB">
              Your current administrative role does not have the required permissions to view the Account Management system.
            </p>
            {error && <p style={{ color: '#ef4444', marginTop: '0.5rem', fontSize: '0.85rem', fontWeight: 600 }}>{error}</p>}
            <div className="ACC_DENIED_CODE" style={{ marginTop: '1.5rem' }}>ERROR 403 &mdash; FORBIDDEN</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ACC_PAGE_WRAP">
      <div className="ACC_MAIN_CONTAINER">

        {error && (
          <div style={{ 
            backgroundColor: '#fee2e2', 
            color: '#b91c1c', 
            padding: '12px 16px', 
            borderRadius: '6px', 
            marginBottom: '16px', 
            border: '1px solid #f87171',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <i className="fas fa-exclamation-circle" />
            <span>{error}</span>
          </div>
        )}

        <div className="ACC_STATS_PANEL">
          <div className="ACC_STAT_COL">
            <div className="ACC_STAT_TITLE">
              SYSTEM ACCOUNTS
              {isSyncing && (
                <span style={{ fontSize: '10px', color: '#3b82f6', marginLeft: '10px' }}>
                  ● Syncing...
                </span>
              )}
            </div>
            <div className="ACC_STAT_SUB">Currently managing:</div>
            <div className="ACC_STAT_HIGHLIGHT">{activeTab} Group</div>
          </div>

          <div className="ACC_STAT_COL ACC_STAT_WIDE">
            <div className="ACC_STAT_TITLE">QUICK SUMMARY</div>
            <div className="ACC_STAT_SUB">
              Manage credentials and security settings for {canViewOfficials ? 'all system users' : 'resident accounts'} across the barangay network.
            </div>
          </div>

          <div className="ACC_TOTAL_COL">
            <div className="ACC_BIG_NUMBER">{filtered.length}</div>
            <div className="ACC_STAT_TITLE" style={{ textAlign: 'center' }}>
              TOTAL MATCHES
            </div>
          </div>
        </div>

        <div className="ACC_SEARCH_ROW">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, position: 'relative' }}>
            <i className="fas fa-search" style={{ position: 'absolute', left: '12px', color: '#94a3b8', fontSize: '0.9rem' }} />
            <input
              id="acc-search"
              name="acc-search"
              autoComplete="off"
              className="ACC_SEARCH_INPUT"
              style={{ paddingLeft: '36px' }}
              placeholder="Search by name, username, or role..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="ACC_TABS_CONTAINER">
          {canViewOfficials && (
            <button
              className={`ACC_TAB_BTN ${activeTab === 'Officials' ? 'ACTIVE' : ''}`}
              onClick={() => setActiveTab('Officials')}
            >
              Officials &amp; System Admins
            </button>
          )}
          <button
            className={`ACC_TAB_BTN ${activeTab === 'Residents' ? 'ACTIVE' : ''}`}
            onClick={() => setActiveTab('Residents')}
          >
            Resident Accounts
          </button>
        </div>

        <div className="ACC_TABLE_CARD">
          <div className="ACC_TABLE_WRAP">
            <table className="ACC_TABLE_MAIN">
              <thead>
                <tr>
                  <th>USER DETAILS</th>
                  <th>USERNAME</th>
                  <th>ROLE</th>
                  <th style={{ textAlign: 'right' }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {paginatedData.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="ACC_EMPTY_STATE">
                      No {activeTab.toLowerCase()} found
                      {searchTerm ? ` matching "${searchTerm}"` : ''}.
                    </td>
                  </tr>
                ) : paginatedData.map(acc => {
                  const isAdmin = ['admin', 'superadmin', 'staff'].includes(acc.role?.toLowerCase());
                  const shortId = acc.id?.split('-')[0] ?? '—';

                  return (
                    <tr key={acc.id}>
                      <td>
                        <div className="ACC_PROF_FLEX">
                          <div className={`ACC_AVATAR ${isAdmin ? 'ADMIN' : ''}`}>
                            {acc.profileName?.charAt(0) ?? '?'}
                          </div>
                          <div className="ACC_PROF_NAME">
                            {acc.profileName}
                            <span>UID: {shortId}...</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="ACC_TEXT_MUTED">{acc.username}</span>
                      </td>
                      <td>
                        <span className={`ACC_BADGE ${isAdmin ? 'ACC_BADGE_ADMIN' : 'ACC_BADGE_RESIDENT'}`}>
                          {acc.role ? acc.role.toUpperCase() : 'RESIDENT'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', alignItems: 'center' }}>
                          {/* 🛡️ Renders "Restricted" text for Kagawad, SK, Treasurer automatically! */}
                          {canChangePassword(acc) ? (
                            <button
                              className="ACC_CHANGE_PASS_BTN"
                              onClick={() => {
                                setSelectedAccount(acc);
                                setNewPassword('');
                                setShowPassword(false);
                                setIsResetOpen(true);
                              }}
                            >
                              <i className="fas fa-lock" /> Change Password
                            </button>
                          ) : (
                            <span className="ACC_TEXT_MUTED" style={{ fontSize: '0.8rem', fontStyle: 'italic', paddingRight: '8px' }}>
                              <i className="fas fa-ban" style={{ marginRight: '4px' }}/> Restricted
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="ACC_PAGINATION_BAR">
             <div className="ACC_PAG_INFO">
               Showing {paginatedData.length > 0 ? (currentPage - 1) * ITEMS_PER_PAGE + 1 : 0} to {Math.min(currentPage * ITEMS_PER_PAGE, tableData.length)} of {tableData.length} accounts
             </div>
             <div className="ACC_PAG_NAV">
                <button 
                  className="ACC_NAV_BTN" 
                  disabled={currentPage === 1} 
                  onClick={() => setCurrentPage(prev => prev - 1)}
                >
                  <i className="fas fa-chevron-left" /> Previous
                </button>
                <span className="ACC_PAGE_INDICATOR">Page {currentPage} of {totalPages || 1}</span>
                <button 
                  className="ACC_NAV_BTN" 
                  disabled={currentPage >= totalPages} 
                  onClick={() => setCurrentPage(prev => prev + 1)}
                >
                  Next <i className="fas fa-chevron-right" />
                </button>
             </div>
          </div>
        </div>
      </div>

      {isResetOpen && (
        <div className="ACC_MODAL_OVERLAY">
          <div className="ACC_MODAL_BOX">
            <h2><i className="fas fa-user-shield" /> Security Reset</h2>
            <p>Update credentials for <strong>{selectedAccount?.profileName}</strong>.</p>
            <form onSubmit={handlePasswordReset}>
              
              <div className="ACC_INPUT_GROUP">
                <label htmlFor="acc-new-password">New Password</label>
                <div className="ACC_PASS_INPUT_WRAPPER">
                  <i className="fas fa-key ACC_INPUT_ICON"></i>
                  <input
                    id="acc-new-password"
                    name="new-password"
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className="ACC_PRO_INPUT"
                    placeholder="Enter at least 8 characters..."
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                  />
                  <button 
                    type="button" 
                    className="ACC_PASS_TOGGLE" 
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                  >
                    <i className={showPassword ? "fas fa-eye-slash" : "fas fa-eye"}></i>
                  </button>
                </div>
              </div>

              <div className="ACC_MODAL_ACTIONS">
                <button type="button" className="ACC_BTN_CANCEL" onClick={() => setIsResetOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="ACC_BTN_SAVE">
                  Update Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}