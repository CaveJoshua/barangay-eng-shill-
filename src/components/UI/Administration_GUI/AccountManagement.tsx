import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import './styles/AccountManagement.css';
import { ApiService } from '../api';
import { getPasswordChecks, getPasswordStrength, strengthColor } from '../../buttons/Tools/PasswordChecks';

// ─── Types ────────────────────────────────────────────────────────────────────
interface IAccount {
  id:          string;
  username:    string;
  email?:      string; // 🛡️ ADDED: Allows fallback to email
  role:        string;
  status?:     string;
  created_at?: string;
  source:      'resident' | 'official';
  profileName: string;
}

type TabState = 'Officials' | 'Residents';
type ResetStep = 'INIT' | 'OTP' | 'PASSWORD';

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
  
  // ── RESET MODAL STATE ──
  const [selectedAccount,  setSelectedAccount] = useState<IAccount | null>(null);
  const [isResetOpen,      setIsResetOpen]     = useState(false);
  const [resetStep,        setResetStep]       = useState<ResetStep>('INIT');
  const [resetOtp,         setResetOtp]        = useState('');
  const [useFallback,      setUseFallback]     = useState<boolean>(false);
  const [viaPhone,         setViaPhone]        = useState<boolean>(false);
  const [newPassword,      setNewPassword]     = useState('');
  const [confirmPassword,  setConfirmPassword] = useState('');
  const [showPassword,     setShowPassword]    = useState(false);
  const [modalLoading,     setModalLoading]    = useState(false);
  const [modalError,       setModalError]      = useState('');

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

  // ── MODAL HANDLERS (3-STEP VERIFICATION) ───────────────────────────────────

  const handleRequestResetOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccount) return;
    setModalLoading(true);
    setModalError('');

    // 🛡️ THE FIX: Smart Identifier Fallback
    const targetIdentifier = selectedAccount.username || selectedAccount.email || selectedAccount.id;

    if (!targetIdentifier || targetIdentifier.trim() === '') {
      setModalError('This account is missing a username or email. Cannot process reset.');
      setModalLoading(false);
      return;
    }

    try {
      const response = await ApiService.requestPasswordResetOTP(targetIdentifier, useFallback, viaPhone);
      if (response.success) {
        setResetStep('OTP');
      } else {
        throw new Error(response.error || 'Failed to send verification code.');
      }
    } catch (err: any) {
      setModalError(err.message);
    } finally {
      setModalLoading(false);
    }
  };

  const handleVerifyResetOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccount) return;
    setModalLoading(true);
    setModalError('');

    // 🛡️ THE FIX: Smart Identifier Fallback matches request step
    const targetIdentifier = selectedAccount.username || selectedAccount.email || selectedAccount.id;

    try {
      const response = await ApiService.verifyOTP(targetIdentifier, resetOtp);
      if (response.success) {
        setResetStep('PASSWORD');
      } else {
        throw new Error(response.error || 'Invalid or expired code.');
      }
    } catch (err: any) {
      setModalError(err.message);
    } finally {
      setModalLoading(false);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccount) return;

    const targetFirstName = (selectedAccount.profileName || '').trim().split(/\s+/)[0] || '';
    const checks = getPasswordChecks(newPassword, targetFirstName);
    const failedCheck = checks.find(c => !c.met);
    if (failedCheck) return setModalError(failedCheck.label + ' — requirement not met.');
    if (newPassword !== confirmPassword) return setModalError('Passwords do not match. Please re-enter.');

    setModalLoading(true);
    setModalError('');

    try {
      const result = await ApiService.resetPassword(selectedAccount.id, {
        password: newPassword,
        otp: resetOtp // Send OTP in case backend validates it on this endpoint too
      });
      if (result.success) {
        alert('Password updated successfully.');
        setIsResetOpen(false);
        setNewPassword('');
        setConfirmPassword('');
        setResetOtp('');
        setShowPassword(false);
        setResetStep('INIT');
      } else {
        throw new Error(result.error); 
      }
    } catch (err: any) { 
      setModalError(`Reset failed: ${err.message}`); 
    } finally {
      setModalLoading(false);
    }
  };

  // 🛡️ Row-Level Password Reset Permission Check
  const canChangePassword = useCallback((targetAcc: IAccount) => {
    const targetRole = (targetAcc.role || '').toLowerCase().replace(/\s+/g, '');
    
    // 🛡️ Allow superadmin OR barangayhall itself to change the barangayhall password
    if (targetRole === 'barangayhall' && currentUserRole !== 'superadmin' && currentUserRole !== 'barangayhall') {
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
    return accounts.filter(acc => {
      // 🛡️ THE GHOST PROTOCOL: Instantly banish inactive/archived users from the roster
      const currentStatus = (acc.status || 'Active').toUpperCase();
      if (['INACTIVE', 'ARCHIVED', 'DECEASED', 'RELOCATED', 'SUSPENDED', 'RESIGNED'].includes(currentStatus)) {
        return false;
      }

      // Standard Search Logic
      if (!q) return true;
      return (
        acc.username?.toLowerCase().includes(q) ||
        acc.role?.toLowerCase().includes(q) ||
        acc.profileName?.toLowerCase().includes(q)
      );
    });
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
              Manage active credentials and security settings for {canViewOfficials ? 'all system users' : 'resident accounts'} across the barangay network.
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
                        <span className="ACC_TEXT_MUTED">{acc.username || acc.email}</span>
                      </td>
                      <td>
                        <span className={`ACC_BADGE ${isAdmin ? 'ACC_BADGE_ADMIN' : 'ACC_BADGE_RESIDENT'}`}>
                          {acc.role ? acc.role.toUpperCase() : 'RESIDENT'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', alignItems: 'center' }}>
                          {canChangePassword(acc) ? (
                            <button
                              className="ACC_CHANGE_PASS_BTN"
                              onClick={() => {
                                setSelectedAccount(acc);
                                setNewPassword('');
                                setConfirmPassword('');
                                setResetOtp('');
                                setShowPassword(false);
                                setResetStep('INIT');
                                setUseFallback(false);
                                setViaPhone(false);
                                setModalError('');
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
               Showing {paginatedData.length > 0 ? (currentPage - 1) * ITEMS_PER_PAGE + 1 : 0} to {Math.min(currentPage * ITEMS_PER_PAGE, tableData.length)} of {tableData.length} active accounts
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
            
            {modalError && (
              <div style={{ padding: '10px', backgroundColor: '#fee2e2', color: '#b91c1c', borderRadius: '4px', marginBottom: '15px', fontSize: '0.85rem' }}>
                <i className="fas fa-exclamation-triangle" style={{ marginRight: '5px' }}></i> {modalError}
              </div>
            )}

            {/* ── STEP 1: REQUEST OTP ── */}
            {resetStep === 'INIT' && (
              <form onSubmit={handleRequestResetOtp}>
                <div className="ACC_INPUT_GROUP" style={{ marginBottom: '20px' }}>
                  <label style={{ marginBottom: '8px', display: 'block', fontSize: '0.9rem', color: '#475569' }}>
                    Where should we send the verification code?
                  </label>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '10px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem' }}>
                      <input
                        type="radio"
                        name="recoveryMode"
                        checked={!useFallback && !viaPhone}
                        onChange={() => { setUseFallback(false); setViaPhone(false); }}
                        disabled={modalLoading}
                        style={{ accentColor: '#3b82f6', width: '16px', height: '16px' }}
                      />
                      <span>User's Registered Email</span>
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem' }}>
                      <input
                        type="radio"
                        name="recoveryMode"
                        checked={viaPhone}
                        onChange={() => { setViaPhone(true); setUseFallback(false); }}
                        disabled={modalLoading}
                        style={{ accentColor: '#059669', width: '16px', height: '16px' }}
                      />
                      <span style={{ color: viaPhone ? '#047857' : 'inherit', fontWeight: viaPhone ? '600' : 'normal' }}>
                        User's Registered Phone Number <small style={{ fontWeight: 'normal', color: '#94a3b8' }}>(SMS)</small>
                      </span>
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem' }}>
                      <input
                        type="radio"
                        name="recoveryMode"
                        checked={useFallback}
                        onChange={() => { setUseFallback(true); setViaPhone(false); }}
                        disabled={modalLoading}
                        style={{ accentColor: '#d97706', width: '16px', height: '16px' }}
                      />
                      <span style={{ color: useFallback ? '#b45309' : 'inherit', fontWeight: useFallback ? '600' : 'normal' }}>
                        Barangay Hall Master Email <small style={{ fontWeight: 'normal', color: '#94a3b8' }}>(Fallback)</small>
                      </span>
                    </label>
                  </div>
                </div>

                <div className="ACC_MODAL_ACTIONS">
                  <button type="button" className="ACC_BTN_CANCEL" onClick={() => setIsResetOpen(false)} disabled={modalLoading}>
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="ACC_BTN_SAVE"
                    disabled={modalLoading}
                    style={useFallback ? { backgroundColor: '#d97706', borderColor: '#b45309' } : viaPhone ? { backgroundColor: '#059669', borderColor: '#047857' } : {}}
                  >
                    {modalLoading ? <i className="fas fa-spinner fa-spin" /> : 'Send Code'}
                  </button>
                </div>
              </form>
            )}

            {/* ── STEP 2: VERIFY OTP ── */}
            {resetStep === 'OTP' && (
              <form onSubmit={handleVerifyResetOtp}>
                <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '15px' }}>
                  A verification code has been sent. Please enter it below to authorize this password change.
                </p>
                <div className="ACC_INPUT_GROUP">
                  <label>6-Character Code</label>
                  <div className="ACC_PASS_INPUT_WRAPPER">
                    <i className="fas fa-key ACC_INPUT_ICON" style={useFallback ? { color: '#d97706' } : {}}></i>
                    <input
                      type="text"
                      required
                      maxLength={6}
                      autoComplete="off"
                      className="ACC_PRO_INPUT"
                      placeholder="000000"
                      value={resetOtp}
                      onChange={e => setResetOtp(e.target.value.toUpperCase())}
                      disabled={modalLoading}
                      style={useFallback ? { borderColor: '#d97706', color: '#b45309', letterSpacing: '2px', fontWeight: 'bold' } : { letterSpacing: '2px', fontWeight: 'bold' }}
                    />
                  </div>
                </div>

                <div className="ACC_MODAL_ACTIONS">
                  <button type="button" className="ACC_BTN_CANCEL" onClick={() => { setResetStep('INIT'); setResetOtp(''); }} disabled={modalLoading}>
                    Back
                  </button>
                  <button type="submit" className="ACC_BTN_SAVE" disabled={modalLoading} style={useFallback ? { backgroundColor: '#d97706', borderColor: '#b45309' } : {}}>
                    {modalLoading ? <i className="fas fa-spinner fa-spin" /> : 'Verify Code'}
                  </button>
                </div>
              </form>
            )}

            {/* ── STEP 3: NEW PASSWORD ── */}
            {resetStep === 'PASSWORD' && (() => {
              const targetFirstName = (selectedAccount?.profileName || '').trim().split(/\s+/)[0] || '';
              const checks = getPasswordChecks(newPassword, targetFirstName);
              const passwordDirty = newPassword.length > 0;
              const allChecksMet = checks.every(c => c.met);
              const strength = getPasswordStrength(newPassword, checks);

              const confirmDirty = confirmPassword.length > 0;
              const passwordsMatch = confirmDirty && newPassword === confirmPassword;

              return (
              <form onSubmit={handlePasswordReset}>
                <div className="ACC_INPUT_GROUP">
                  <label htmlFor="acc-new-password">New Password</label>
                  <div className="ACC_PASS_INPUT_WRAPPER">
                    <i className="fas fa-lock ACC_INPUT_ICON"></i>
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
                      disabled={modalLoading}
                      style={{ borderColor: !passwordDirty ? undefined : allChecksMet ? '#16a34a' : '#dc2626' }}
                    />
                    <button
                      type="button"
                      className="ACC_PASS_TOGGLE"
                      onClick={() => setShowPassword(!showPassword)}
                      tabIndex={-1}
                      disabled={modalLoading}
                    >
                      <i className={showPassword ? "fas fa-eye-slash" : "fas fa-eye"}></i>
                    </button>
                  </div>
                </div>

                {passwordDirty && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', fontSize: '0.75rem', fontWeight: 700, color: strengthColor(strength), margin: '4px 0 0' }}>
                    {strength.toUpperCase()} PASSWORD
                  </div>
                )}

                <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px', margin: '8px 0 0', fontSize: '0.78rem', color: '#475569' }}>
                  {checks.map(c => (
                    <div key={c.label} style={{ display: 'flex', alignItems: 'center', padding: '2px 0', color: !passwordDirty ? '#64748b' : c.met ? '#166534' : '#991b1b' }}>
                      <span style={{
                        display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', marginRight: '7px', flexShrink: 0,
                        backgroundColor: !passwordDirty ? '#cbd5e1' : c.met ? '#16a34a' : '#dc2626',
                      }} />
                      {c.label}
                    </div>
                  ))}
                  <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid #e2e8f0', color: '#94a3b8', fontSize: '0.72rem' }}>
                    Also checked on submit: must differ from the current password, and must not be their username.
                  </div>
                </div>

                <div className="ACC_INPUT_GROUP" style={{ marginTop: '16px' }}>
                  <label htmlFor="acc-confirm-password">Re-enter New Password</label>
                  <div className="ACC_PASS_INPUT_WRAPPER">
                    <i className="fas fa-lock ACC_INPUT_ICON"></i>
                    <input
                      id="acc-confirm-password"
                      name="confirm-password"
                      type={showPassword ? "text" : "password"}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      className="ACC_PRO_INPUT"
                      placeholder="Confirm the password above..."
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      disabled={modalLoading}
                      style={{ borderColor: !confirmDirty ? undefined : passwordsMatch ? '#16a34a' : '#dc2626' }}
                    />
                  </div>
                  {confirmDirty && !passwordsMatch && (
                    <div style={{ display: 'flex', alignItems: 'center', fontSize: '0.75rem', color: '#991b1b', margin: '4px 0 0' }}>
                      <span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', marginRight: '7px', backgroundColor: '#dc2626' }} />
                      Passwords do not match
                    </div>
                  )}
                </div>

                <div className="ACC_MODAL_ACTIONS">
                  <button type="button" className="ACC_BTN_CANCEL" onClick={() => setIsResetOpen(false)} disabled={modalLoading}>
                    Cancel
                  </button>
                  <button type="submit" className="ACC_BTN_SAVE" disabled={modalLoading || !allChecksMet || !passwordsMatch}>
                    {modalLoading ? <i className="fas fa-spinner fa-spin" /> : 'Update Password'}
                  </button>
                </div>
              </form>
              );
            })()}

          </div>
        </div>
      )}
    </div>
  );
}