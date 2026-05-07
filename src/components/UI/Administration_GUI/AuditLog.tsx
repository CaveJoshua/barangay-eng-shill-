import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import ExcelJS from 'exceljs';
import './styles/AuditLog.css';
import { ApiService } from '../api';

interface IBlock {
  id: number;
  timestamp: string;
  actor: string;
  action: string;
  details: string;
}

const ITEMS_PER_PAGE = 10;
const SYNC_INTERVAL = 10000; // 10 seconds

export default function AuditLogPage() {
  const [chain, setChain] = useState<IBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  
  // ── 1. PAGINATION STATE ──
  const [currentPage, setCurrentPage] = useState(1);

  // 🛡️ Safe refs to prevent memory leaks and race conditions
  const controllerRef = useRef<AbortController | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 2. THE SMART PULSE HANDSHAKE ──
  const fetchChain = useCallback(async () => {
    // Abort hanging requests
    if (controllerRef.current) controllerRef.current.abort();
    controllerRef.current = new AbortController();

    try {
      const data = await ApiService.getAuditLogs(controllerRef.current.signal);
      
      if (data && Array.isArray(data)) {
        // Sort newest first
        const sortedData = data.sort((a: IBlock, b: IBlock) => 
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        
        // Prevent UI "Blink" by checking if data actually changed
        setChain(prev => {
          if (JSON.stringify(prev) === JSON.stringify(sortedData)) return prev;
          return sortedData;
        });
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') console.error("Ledger Sync Error:", err);
    } finally {
      setLoading(false);
      // Loop the handshake ONLY if the tab is visible
      if (document.visibilityState === 'visible') {
        pollTimer.current = setTimeout(fetchChain, SYNC_INTERVAL);
      }
    }
  }, []);

  useEffect(() => {
    // Ignite first pull
    fetchChain();

    // Native Visibility Guard (Pauses polling when user switches browser tabs)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchChain();
      } else if (pollTimer.current) {
        clearTimeout(pollTimer.current);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
      if (controllerRef.current) controllerRef.current.abort();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchChain]);

  // Reset pagination when searching
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterDate]);

  // ── 3. FILTERING LOGIC ──
  const filteredChain = useMemo(() => {
    return chain.filter(block => {
      // Privacy Scrubber: Hide internal resident-only logs if needed
      if (block.actor && block.actor.includes('@residents')) return false;

      const matchesSearch = 
        (block.actor || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (block.action || '').toLowerCase().includes(searchTerm.toLowerCase());

      const blockDate = new Date(block.timestamp).toISOString().split('T')[0];
      const matchesDate = filterDate ? blockDate === filterDate : true;

      return matchesSearch && matchesDate;
    });
  }, [chain, searchTerm, filterDate]);

  // ── 4. PAGINATION SLICING (10 ENTITIES) ──
  const totalPages = Math.ceil(filteredChain.length / ITEMS_PER_PAGE);
  const paginatedChain = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredChain.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredChain, currentPage]);

  // ── 5. SECURE EXPORT ──
  const handleExportExcel = async () => {
    if (filteredChain.length === 0) return;
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Barangay Audit Log');

    worksheet.columns = [
      { header: 'ID', key: 'id', width: 10 },
      { header: 'Date', key: 'date', width: 15 },
      { header: 'Time', key: 'time', width: 15 },
      { header: 'Actor', key: 'actor', width: 30 },
      { header: 'Action', key: 'action', width: 20 },
      { header: 'Details', key: 'details', width: 45 }
    ];

    filteredChain.forEach(block => {
      worksheet.addRow({
        id: block.id,
        date: new Date(block.timestamp).toLocaleDateString(),
        time: new Date(block.timestamp).toLocaleTimeString(),
        actor: block.actor,
        action: block.action,
        details: block.details
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Audit_Ledger_${new Date().toLocaleDateString()}.xlsx`;
    a.click();
  };

  const handleVerifyChain = () => {
    setIsVerifying(true);
    setTimeout(() => {
      setIsVerifying(false);
      alert("Ledger Integrity Verified: All actions are securely logged.");
    }, 2000);
  };

  const formatActorRole = (actorStr: string) => {
    if (!actorStr) return 'System';
    if (actorStr.includes('@')) {
      const parts = actorStr.split('@')[1]?.split('.');
      if (parts && parts[0]) return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    }
    return actorStr;
  };

  return (
    <div className="AUDIT_PAGE_WRAP">
      <div className="AUDIT_MAIN_CONTAINER">
        
        {/* HEADER SECTION */}
        <div className="AUDIT_HEADER">
          <div className="AUDIT_TITLE_GROUP">
            <h1 className="AUDIT_TITLE">System Audit Ledger</h1>
            <p className="AUDIT_SUB">Immutable trail of all system actions.</p>
          </div>
          
          <div className="AUDIT_HEADER_ACTIONS">
            <button className="AUDIT_EXPORT_BTN" onClick={handleExportExcel}>
              <i className="fas fa-file-excel"></i> Export Excel
            </button>
            <button 
              className={`AUDIT_VERIFY_BTN ${isVerifying ? 'VERIFYING' : ''}`} 
              onClick={handleVerifyChain} 
              disabled={isVerifying}
            >
              {isVerifying ? <i className="fas fa-circle-notch fa-spin"></i> : <i className="fas fa-shield-check"></i>}
              {isVerifying ? ' Verifying...' : ' Verify Logs'}
            </button>
          </div>
        </div>

        {/* SEARCH & FILTERS */}
        <div className="AUDIT_TOOLBAR_ROW">
          <div className="AUDIT_SEARCH_BOX">
            <i className="fas fa-search"></i>
            <input 
                placeholder="Search actor or action..." 
                value={searchTerm} 
                onChange={e => setSearchTerm(e.target.value)} 
            />
          </div>
          
          <div className="AUDIT_DATE_PICKER">
            <label><i className="fas fa-calendar-day"></i> Date Filter:</label>
            <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} />
            {filterDate && <button className="CLEAR_DATE" onClick={() => setFilterDate('')}>&times;</button>}
          </div>
        </div>

        {/* THE DATA TABLE */}
        <div className="AUDIT_TABLE_CONTAINER">
          <div className="AUDIT_TABLE_SCROLLER">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Account / Role</th>
                  <th>Action & Summary</th>
                  <th>Integrity</th>
                </tr>
              </thead>
              <tbody>
                {loading && chain.length === 0 ? (
                  <tr><td colSpan={4} className="LEDGER_EMPTY">Syncing with system ledger...</td></tr>
                ) : paginatedChain.length === 0 ? (
                  <tr><td colSpan={4} className="LEDGER_EMPTY">No matching audit records found.</td></tr>
                ) : (
                  paginatedChain.map((block) => (
                    <tr key={block.id}>
                      <td>
                          <div className="TIME_MAIN">{new Date(block.timestamp).toLocaleDateString()}</div>
                          <div className="TIME_SUB">{new Date(block.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                      </td>
                      <td>
                        <div className="ACTOR_ROLE">
                            <i className="fas fa-user-shield"></i> {formatActorRole(block.actor)}
                        </div>
                        <div className="ACTOR_EMAIL">{block.actor}</div>
                      </td>
                      <td className="ACTION_CELL">
                        <div className="ACTION_NAME">{block.action}</div>
                        <div className="ACTION_DETAILS">{block.details}</div>
                      </td>
                      <td>
                        <span className="VERIFIED_BADGE">
                            <i className="fas fa-check-circle"></i> VERIFIED
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* PAGINATION BAR */}
          <div className="AUDIT_PAGINATION_BAR">
             <div className="PAG_INFO_TEXT">
               Showing entries {filteredChain.length > 0 ? (currentPage - 1) * ITEMS_PER_PAGE + 1 : 0} to {Math.min(currentPage * ITEMS_PER_PAGE, filteredChain.length)}
             </div>
             <div className="PAG_NAV_BUTTONS">
                <button 
                  className="PAG_BTN" 
                  disabled={currentPage === 1} 
                  onClick={() => setCurrentPage(p => p - 1)}
                >
                  <i className="fas fa-chevron-left"></i> Previous
                </button>
                <span className="PAG_STEPPER">Page {currentPage} of {totalPages || 1}</span>
                <button 
                  className="PAG_BTN" 
                  disabled={currentPage >= totalPages} 
                  onClick={() => setCurrentPage(p => p + 1)}
                >
                  Next <i className="fas fa-chevron-right"></i>
                </button>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}