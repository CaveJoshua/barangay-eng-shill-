import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import './styles/Resident.css'; 
import { ResidentModal, type IResident } from '../../buttons/Resident_modal'; 
import { ResidentMapper } from '../../buttons/Tools/Resident_Model/DataMapper';
import { exportResidentsToCSV, importResidentsFromCSV } from '../../buttons/Tools/Resident_Model/data_backup';
// Using the Universal Handshake Service
import { ApiService } from '../api'; 

export default function ResidentsPage() {
  const [residents, setResidents] = useState<IResident[]>([]);
  const [error, setError] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

  // UI STATES
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [filter, setFilter] = useState('All Residents');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedResident, setSelectedResident] = useState<IResident | null>(null);

  // PROGRESS & SECURITY STATES
  const [importProgress, setImportProgress] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  // 🛡️ BLOCKCHAIN LEDGER STATES
  const [isVerifyingChain, setIsVerifyingChain] = useState(false);
  const [chainLogs, setChainLogs] = useState<string[]>([]);
  const [chainStatus, setChainStatus] = useState<'hidden' | 'scanning' | 'valid' | 'compromised'>('hidden');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);

  // ==========================================================
  // SYSTEM GUARD: PREVENT DATA INTERRUPTION
  // ==========================================================
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (importProgress !== null || isVerifyingChain) {
        const msg = "Warning: Critical system operation in progress. Closing now is unsafe.";
        e.preventDefault();
        e.returnValue = msg;
        return msg;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [importProgress, isVerifyingChain]);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [chainLogs]);

  /**
   * REFACTORED FETCH: Uses the Universal Handshake
   */
  const fetchResidents = useCallback(async (silent = false, signal?: AbortSignal) => {
    if (!silent) setIsSyncing(true);
    try {
      const data = await ApiService.getResidents(signal);
      if (data === null) return;

      // Ensure we keep the raw genesis_hash during mapping for verification
      const mappedData = data.map((row: any) => ({
          ...ResidentMapper.toUI(row),
          genesisHash: row.genesis_hash // Explicitly attach the ledger hash
      }));
      
      setResidents(mappedData);
      setError(''); 
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error("[FETCH ERROR]", err);
        if (!silent) setError('Cannot reach server. Resident data sync failed.');
      }
    } finally {
      setIsSyncing(false);
    }
  }, []);

  useEffect(() => {
    const valve = new AbortController();
    fetchResidents(false, valve.signal); 
    
    const autoLoader = setInterval(() => fetchResidents(true, valve.signal), 300000); 
    return () => {
        valve.abort();
        clearInterval(autoLoader);
    };
  }, [fetchResidents]);

  const handleArchive = async (id: string | undefined) => {
    if (!id) return;
    if (!window.confirm('Archive this resident identity? This action is logged.')) return;

    const previousResidents = [...residents];

    try {
      setResidents(prev => prev.filter(r => r.id !== id));
      
      const response = await ApiService.deleteResident(id); 
      
      if (!response.success) {
          throw new Error(response.error || 'Server rejected archive request');
      }
      
      fetchResidents(true); 
    } catch (err: any) {
      console.error("[ARCHIVE ERROR]:", err.message);
      alert(`Archive failed: ${err.message}. Check connection.`);
      setResidents(previousResidents);
    }
  };

  // ==========================================================
  // 🛡️ THE IMMUTABLE LEDGER SCANNER (CLIENT-SIDE VERIFICATION)
  // ==========================================================
  const verifyChainIntegrity = async () => {
      // 1. Force the terminal open immediately so the user sees activity
      setChainStatus('scanning');
      setIsVerifyingChain(true);
      setChainLogs(['[SYSTEM] Initializing Blockchain Integrity Engine...']);

      // 2. Check for Data
      if (residents.length === 0) {
          setChainLogs(prev => [...prev, '❌ [ERROR] No resident records found in memory. Scan aborted.']);
          setIsVerifyingChain(false);
          setChainStatus('compromised');
          return;
      }

      // 3. Check for Secure Context (WebCrypto requirement)
      if (!window.isSecureContext || !crypto.subtle) {
          setChainLogs(prev => [
              ...prev, 
              '❌ [CRITICAL] WebCrypto API is disabled.',
              'ℹ️ [REASON] This feature requires a Secure Context (HTTPS or localhost).',
              '⚠️ Verification cannot proceed over insecure HTTP.'
          ]);
          setIsVerifyingChain(false);
          setChainStatus('compromised');
          return;
      }

      try {
          let compromisedCount = 0;
          let tempLogs = [...chainLogs, `[SYSTEM] Auditing ${residents.length} identity blocks...` ];
          
          await new Promise(resolve => setTimeout(resolve, 800));

          for (let i = 0; i < residents.length; i++) {
              const res = residents[i] as any;
              
              if (!res.genesisHash) {
                  tempLogs.push(`⚠️ [SKIPPED] Block ${res.id?.substring(0,8)} is a Legacy Record (No Hash).`);
                  continue;
              }

              // Normalization Logic (Must match backend EXACTLY)
              const normalized = `${res.firstName?.trim().toLowerCase()}|${res.middleName?.trim().toLowerCase()}|${res.lastName?.trim().toLowerCase()}|${res.dob}`.replace(/\s+/g, '');
              
              // Generate Local Hash
              const msgBuffer = new TextEncoder().encode(normalized);
              const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
              const hashArray = Array.from(new Uint8Array(hashBuffer));
              const computedHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

              // Integrity Check
              if (computedHash !== res.genesisHash) {
                  compromisedCount++;
                  tempLogs.push(`❌ [TAMPER DETECTED] Block ${res.id?.substring(0,8)}: Hash Mismatch!`);
                  tempLogs.push(`   > Expected: ${res.genesisHash.substring(0,10)}...`);
                  tempLogs.push(`   > Actual:   ${computedHash.substring(0,10)}...`);
              } else if (i % 20 === 0 || i === residents.length - 1) {
                  tempLogs.push(`✅ [OK] Block ${res.id?.substring(0,8)} verified.`);
              }

              // Periodic UI Update to prevent freezing
              if (i % 10 === 0) setChainLogs([...tempLogs]);
          }

          if (compromisedCount === 0) {
              tempLogs.push(`\n[RESULT] 🟢 CHAIN SECURE. All blocks match their cryptographic signatures.`);
              setChainStatus('valid');
          } else {
              tempLogs.push(`\n[RESULT] 🔴 COMPROMISED. Found ${compromisedCount} tampered records.`);
              setChainStatus('compromised');
          }
          setChainLogs(tempLogs);

      } catch (err: any) {
          setChainLogs(prev => [...prev, `❌ [RUNTIME ERROR] ${err.message}`]);
          setChainStatus('compromised');
      } finally {
          setIsVerifyingChain(false);
      }
  };


  // --- FILTER & SEARCH ENGINE ---
  const filteredResidents = useMemo(() => {
    return residents.filter((res) => {
      const currentStatus = (res.activityStatus || '').toUpperCase();
      if (currentStatus.includes('ARCHIVE')) return false;

      const fullName = `${res.lastName || ''}, ${res.firstName || ''}`.toLowerCase();
      if (searchTerm && !fullName.includes(searchTerm.toLowerCase())) return false;
      
      if (filter === 'All Residents') return true;
      if (filter === 'Active Residents') return res.activityStatus === 'Active';
      if (filter === 'Inactive/Leave') return res.activityStatus !== 'Active';

      let age = 0;
      if (res.dob) {
        const birth = new Date(res.dob);
        if (!isNaN(birth.getTime())) {
            const today = new Date();
            age = today.getFullYear() - birth.getFullYear();
            const m = today.getMonth() - birth.getMonth();
            if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
        }
      }

      if (filter === 'Minors (0-17)') return age < 18;
      if (filter === 'Seniors (60+)') return age >= 60;
      if (filter === 'Adults (18-59)') return age >= 18 && age < 60;
      if (filter === 'Voters') return res.isVoter;
      if (filter === '4Ps Beneficiaries') return res.is4Ps;
      if (filter === 'PWD') return res.isPWD;
      return true;
    });
  }, [residents, filter, searchTerm]);

  useEffect(() => { setCurrentPage(1); }, [filter, searchTerm]);

  // PAGINATION
  const totalPages = Math.ceil(filteredResidents.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedResidents = filteredResidents.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  // STATS
  const totalCount = filteredResidents.length;
  const maleCount = filteredResidents.filter(r => r.sex === 'Male').length;
  const femaleCount = filteredResidents.filter(r => r.sex === 'Female').length;
  const malePercent = totalCount > 0 ? Math.round((maleCount / totalCount) * 100) : 0;
  const femalePercent = totalCount > 0 ? Math.round((femaleCount / totalCount) * 100) : 0;

  return (
    <div className="RES_PAGE_WRAP">
      <div className="RES_MAIN_CONTAINER">
        
        <div className="RES_STATS_PANEL">
           <div className="RES_STAT_COL">
              <div className="RES_STAT_TITLE">POPULATION SEGMENT</div>
              <div className="RES_STAT_HIGHLIGHT">{filter}</div>
           </div>

           <div className="RES_STAT_COL RES_STAT_WIDE">
              <div className="RES_STAT_TITLE">GENDER DISTRIBUTION</div>
              <div className="RES_GENDER_WRAP">
                 <div className="RES_GENDER_ROW"><span>Male ({maleCount})</span><span>{malePercent}%</span></div>
                 <div className="RES_BAR_TRACK"><div className="RES_BAR_MALE" style={{width: `${malePercent}%`}}></div></div>
                 <div className="RES_GENDER_ROW"><span>Female ({femaleCount})</span><span>{femalePercent}%</span></div>
                 <div className="RES_BAR_TRACK"><div className="RES_BAR_FEMALE" style={{width: `${femalePercent}%`}}></div></div>
              </div>
           </div>

           <div className="RES_STAT_COL">
              <div className="RES_STAT_TITLE">QUICK FILTER</div>
              <select className="RES_FILTER_SELECT" value={filter} onChange={(e) => setFilter(e.target.value)}>
                 <option>All Residents</option>
                 <option>Active Residents</option>
                 <option>Inactive/Leave</option>
                 <option>Minors (0-17)</option>
                 <option>Adults (18-59)</option>
                 <option>Seniors (60+)</option>
                 <option>Voters</option>
                 <option>4Ps Beneficiaries</option>
                 <option>PWD</option>
              </select>
           </div>

           <div className="RES_TOTAL_COL">
              <div className="RES_BIG_NUMBER">{isSyncing ? '...' : totalCount}</div>
              <div className="RES_STAT_TITLE">TOTAL</div>
           </div>
        </div>

        {importProgress !== null && (
          <div className="IMPORT_PROGRESS_CONTAINER">
            <div className="IMPORT_PROGRESS_HEADER">
              <div className="IMPORT_PROGRESS_TEXT">Restoring Database Identities & Accounts...</div>
              <div className="IMPORT_PROGRESS_PERCENT">{importProgress}%</div>
            </div>
            <div className="IMPORT_PROGRESS_BAR_TRACK">
              <div className="IMPORT_PROGRESS_BAR_FILL" style={{ width: `${importProgress}%` }}></div>
            </div>
          </div>
        )}

        <div className="RES_TABLE_CONTAINER">
           <div className="RES_SEARCH_ROW">
              <div style={{display:'flex', alignItems:'center', gap:'10px', flex:1, position: 'relative'}}>
                <i className="fas fa-search" style={{position:'absolute', left:'12px', color:'#94a3b8'}}></i>
                <input className="RES_SEARCH_INPUT" placeholder="Search resident..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
              </div>

              <div className="RES_ACTION_GROUP">
                <button className="RES_BTN_ALT BTN_IMPORT" disabled={importProgress !== null} onClick={() => fileInputRef.current?.click()}>
                  <i className="fas fa-file-import"></i> {importProgress !== null ? 'SYNCING...' : 'Import CSV'}
                </button>
                <input type="file" accept=".csv" style={{display: 'none'}} ref={fileInputRef} onChange={(e) => importResidentsFromCSV(e, fileInputRef, setImportProgress, () => { fetchResidents(true); setImportProgress(null); })} />
                
                {/* 🛡️ Verify Ledger Button */}
                <button className="RES_BTN_ALT" onClick={verifyChainIntegrity} disabled={isVerifyingChain} style={{ color: '#10b981', borderColor: '#10b981' }}>
                  <i className={`fas fa-link ${isVerifyingChain ? 'fa-spin' : ''}`}></i> Verify Chain
                </button>

                <button className="RES_BTN_ALT BTN_EXPORT" onClick={() => exportResidentsToCSV(residents)}>
                  <i className="fas fa-database"></i> Export Backup
                </button>

                <button className="RES_ADD_BTN" onClick={() => { setSelectedResident(null); setIsModalOpen(true); }}>
                  <i className="fas fa-plus"></i> Add Identity
                </button>
              </div>
           </div>

           <div className="RES_TABLE_WRAP">
               <table className="RES_TABLE_MAIN">
                 <thead>
                   <tr>
                     <th>IDENTITY BLOCK</th><th>AGE</th><th>PUROK</th><th>OCCUPATION</th><th>STATUS</th><th style={{textAlign:'right'}}>ACTIONS</th>
                   </tr>
                 </thead>
                 <tbody>
                   {error ? (
                     <tr><td colSpan={6} className="RES_ERROR_MSG">{error}</td></tr>
                   ) : paginatedResidents.length > 0 ? (
                     paginatedResidents.map((res: any) => {
                       const age = res.dob ? new Date().getFullYear() - new Date(res.dob).getFullYear() : '-';
                       return (
                         <tr key={res.id}>
                             <td>
                               <div className="RES_PROF_FLEX">
                                   <div className="RES_AVATAR">{res.firstName?.charAt(0)}</div>
                                   <div className="RES_PROF_NAME">
                                      {res.lastName}, {res.firstName}
                                      {/* 🛡️ THE VISUAL CHAIN: Display the first part of the hash under the name */}
                                      <span style={{ display: 'block', fontSize: '0.65rem', color: '#94a3b8', fontFamily: 'monospace', letterSpacing: '1px', marginTop: '2px' }}>
                                        <i className="fas fa-fingerprint" style={{ marginRight: '4px' }}></i>
                                        {res.genesisHash ? `0x${res.genesisHash.substring(0, 12)}...` : 'UNVERIFIED_LEGACY'}
                                      </span>
                                   </div>
                               </div>
                             </td>
                             <td>{age}</td><td>{res.purok || '-'}</td><td>{res.occupation || '-'}</td>
                             <td><span className={res.activityStatus === 'Active' ? 'RES_STATUS_ACTIVE' : 'RES_STATUS_WARN'}>{res.activityStatus || 'Active'}</span></td>
                             <td style={{textAlign:'right'}}>
                                 <select className="RES_ACTION_SELECT" defaultValue="" onChange={(e) => {
                                     const action = e.target.value;
                                     if (action === 'edit') { setSelectedResident(res); setIsModalOpen(true); } 
                                     else if (action === 'archive') { handleArchive(res.id); }
                                     e.target.value = "";
                                 }}>
                                   <option value="" disabled>Manage</option>
                                   <option value="edit">Edit Profile</option>
                                   <option value="archive">Archive Record</option>
                                 </select>
                             </td>
                         </tr>
                       );
                     })
                   ) : (
                     <tr><td colSpan={6} style={{textAlign:'center', padding: '20px', color: '#64748b'}}>No records found.</td></tr>
                   )}
                 </tbody>
               </table>

               <div className="RES_PAGINATION_BAR">
                  <div className="PAG_LEFT">Showing {filteredResidents.length > 0 ? startIndex + 1 : 0} to {Math.min(startIndex + ITEMS_PER_PAGE, totalCount)} of {totalCount} entries</div>
                  <div className="PAG_RIGHT">
                     <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="PAG_BTN"><i className="fas fa-chevron-left"></i> Previous</button>
                     <div className="PAG_NUMBER">Page {currentPage} of {totalPages || 1}</div>
                     <button disabled={currentPage >= totalPages || totalPages === 0} onClick={() => setCurrentPage(p => p + 1)} className="PAG_BTN">Next <i className="fas fa-chevron-right"></i></button>
                  </div>
               </div>
           </div>

           {/* 🛡️ BLOCKCHAIN TERMINAL UI */}
           {chainStatus !== 'hidden' && (
              <div style={{ 
                margin: '20px', background: '#0f172a', borderRadius: '8px', border: `1px solid ${chainStatus === 'valid' ? '#10b981' : chainStatus === 'compromised' ? '#ef4444' : '#334155'}`,
                overflow: 'hidden', fontFamily: 'monospace', boxShadow: '0 10px 25px rgba(0,0,0,0.1)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', background: '#1e293b', padding: '8px 15px', color: '#94a3b8', fontSize: '0.75rem', fontWeight: 'bold' }}>
                  <span><i className="fas fa-terminal"></i> LEDGER INTEGRITY SCANNER</span>
                  <button onClick={() => setChainStatus('hidden')} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}><i className="fas fa-times"></i></button>
                </div>
                <div ref={terminalRef} style={{ padding: '15px', height: '200px', overflowY: 'auto', color: '#10b981', fontSize: '0.8rem', lineHeight: '1.6' }}>
                  {chainLogs.map((log, index) => (
                    <div key={index} style={{ color: log.includes('❌') || log.includes('🔴') ? '#ef4444' : log.includes('⚠️') ? '#f59e0b' : '#10b981' }}>
                      {log}
                    </div>
                  ))}
                </div>
              </div>
           )}

        </div>

        {isModalOpen && (
            <ResidentModal 
              isOpen={isModalOpen} 
              residentData={selectedResident} 
              onClose={() => { setIsModalOpen(false); setSelectedResident(null); }} 
              onSuccess={() => fetchResidents(true)} 
            />
        )}
      </div>
    </div>
  );
}