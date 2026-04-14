import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import './styles/Resident.css';
import { ResidentModal, type IResident } from '../../buttons/Resident_modal';
import { ResidentMapper } from '../../buttons/Tools/Resident_Model/DataMapper';
import { exportResidentsToCSV, importResidentsFromCSV } from '../../buttons/Tools/Resident_Model/data_backup';
import { ApiService } from '../api';
import { VerifyChainModal } from '../../buttons/VerifyChainModal';

export default function ResidentsPage() {
  const [residents, setResidents] = useState<IResident[]>([]);
  const [error, setError] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

  // UI STATES
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isVerifyModalOpen, setIsVerifyModalOpen] = useState(false);
  const [filter, setFilter] = useState('All Residents');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedResident, setSelectedResident] = useState<IResident | null>(null);

  // PROGRESS STATE
  const [importProgress, setImportProgress] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ==========================================================
  // SYSTEM GUARD: PREVENT DATA INTERRUPTION DURING IMPORT
  // ==========================================================
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (importProgress !== null) {
        const msg = 'Warning: Critical system operation in progress. Closing now is unsafe.';
        e.preventDefault();
        e.returnValue = msg;
        return msg;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [importProgress]);

  // ==========================================================
  // FETCH — Uses the Universal Handshake Service
  // ==========================================================
  const fetchResidents = useCallback(async (silent = false, signal?: AbortSignal) => {
    if (!silent) setIsSyncing(true);
    try {
      const data = await ApiService.getResidents(signal);
      if (data === null) return;

      const mappedData = data.map((row: any) => ({
        ...ResidentMapper.toUI(row),
        genesisHash: row.genesis_hash,
      }));

      setResidents(mappedData);
      setError('');
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('[FETCH ERROR]', err);
        if (!silent) setError('Cannot reach server. Resident data sync failed.');
      }
    } finally {
      setIsSyncing(false);
    }
  }, []);

  useEffect(() => {
    const valve = new AbortController();
    fetchResidents(false, valve.signal);

    // Auto-refresh every 5 minutes
    const autoLoader = setInterval(() => fetchResidents(true, valve.signal), 300000);
    return () => {
      valve.abort();
      clearInterval(autoLoader);
    };
  }, [fetchResidents]);

  // ==========================================================
  // ARCHIVE
  // ==========================================================
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
      console.error('[ARCHIVE ERROR]:', err.message);
      alert(`Archive failed: ${err.message}. Check connection.`);
      setResidents(previousResidents);
    }
  };

  // ==========================================================
  // FILTER & SEARCH ENGINE
  // ==========================================================
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

        {/* ── Stats Panel ── */}
        <div className="RES_STATS_PANEL">
          <div className="RES_STAT_COL">
            <div className="RES_STAT_TITLE">POPULATION SEGMENT</div>
            <div className="RES_STAT_HIGHLIGHT">{filter}</div>
          </div>

          <div className="RES_STAT_COL RES_STAT_WIDE">
            <div className="RES_STAT_TITLE">GENDER DISTRIBUTION</div>
            <div className="RES_GENDER_WRAP">
              <div className="RES_GENDER_ROW">
                <span>Male ({maleCount})</span>
                <span>{malePercent}%</span>
              </div>
              <div className="RES_BAR_TRACK">
                <div className="RES_BAR_MALE" style={{ width: `${malePercent}%` }}></div>
              </div>
              <div className="RES_GENDER_ROW">
                <span>Female ({femaleCount})</span>
                <span>{femalePercent}%</span>
              </div>
              <div className="RES_BAR_TRACK">
                <div className="RES_BAR_FEMALE" style={{ width: `${femalePercent}%` }}></div>
              </div>
            </div>
          </div>

          <div className="RES_STAT_COL">
            <div className="RES_STAT_TITLE">QUICK FILTER</div>
            <select
              className="RES_FILTER_SELECT"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
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

        {/* ── Import Progress Banner ── */}
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

        {/* ── Table Container ── */}
        <div className="RES_TABLE_CONTAINER">

          {/* Search & Actions Row */}
          <div className="RES_SEARCH_ROW">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, position: 'relative' }}>
              <i className="fas fa-search" style={{ position: 'absolute', left: '12px', color: '#94a3b8' }}></i>
              <input
                className="RES_SEARCH_INPUT"
                placeholder="Search resident..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <div className="RES_ACTION_GROUP">
              {/* Import CSV */}
              <button
                className="RES_BTN_ALT BTN_IMPORT"
                disabled={importProgress !== null}
                onClick={() => fileInputRef.current?.click()}
              >
                <i className="fas fa-file-import"></i>
                {importProgress !== null ? 'SYNCING...' : 'Import CSV'}
              </button>
              <input
                type="file"
                accept=".csv"
                style={{ display: 'none' }}
                ref={fileInputRef}
                onChange={(e) =>
                  importResidentsFromCSV(e, fileInputRef, setImportProgress, () => {
                    fetchResidents(true);
                    setImportProgress(null);
                  })
                }
              />

              {/* Verify Chain — now opens the modal */}
              <button
                className="RES_BTN_ALT"
                onClick={() => setIsVerifyModalOpen(true)}
                style={{ color: '#10b981', borderColor: '#10b981' }}
              >
                <i className="fas fa-link"></i> Verify Chain
              </button>

              {/* Export Backup */}
              <button
                className="RES_BTN_ALT BTN_EXPORT"
                onClick={() => exportResidentsToCSV(residents)}
              >
                <i className="fas fa-database"></i> Export Backup
              </button>

              {/* Add Identity */}
              <button
                className="RES_ADD_BTN"
                onClick={() => { setSelectedResident(null); setIsModalOpen(true); }}
              >
                <i className="fas fa-plus"></i> Add Identity
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="RES_TABLE_WRAP">
            <table className="RES_TABLE_MAIN">
              <thead>
                <tr>
                  <th>IDENTITY BLOCK</th>
                  <th>AGE</th>
                  <th>PUROK</th>
                  <th>OCCUPATION</th>
                  <th>STATUS</th>
                  <th style={{ textAlign: 'right' }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {error ? (
                  <tr>
                    <td colSpan={6} className="RES_ERROR_MSG">{error}</td>
                  </tr>
                ) : paginatedResidents.length > 0 ? (
                  paginatedResidents.map((res: any) => {
                    let age: number | string = '-';
                    if (res.dob) {
                      const birth = new Date(res.dob);
                      if (!isNaN(birth.getTime())) {
                        const today = new Date();
                        let calcAge = today.getFullYear() - birth.getFullYear();
                        const m = today.getMonth() - birth.getMonth();
                        if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) calcAge--;
                        age = calcAge;
                      }
                    }

                    return (
                      <tr key={res.id}>
                        <td>
                          <div className="RES_PROF_FLEX">
                            <div className="RES_AVATAR">{res.firstName?.charAt(0)}</div>
                            <div className="RES_PROF_NAME">
                              {res.lastName}, {res.firstName}
                              <span style={{
                                display: 'block',
                                fontSize: '0.65rem',
                                color: '#94a3b8',
                                fontFamily: 'monospace',
                                letterSpacing: '1px',
                                marginTop: '2px',
                              }}>
                                <i className="fas fa-fingerprint" style={{ marginRight: '4px' }}></i>
                                {res.genesisHash
                                  ? `0x${res.genesisHash.substring(0, 12)}...`
                                  : 'UNVERIFIED_LEGACY'}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td>{age}</td>
                        <td>{res.purok || '-'}</td>
                        <td>{res.occupation || '-'}</td>
                        <td>
                          <span className={res.activityStatus === 'Active' ? 'RES_STATUS_ACTIVE' : 'RES_STATUS_WARN'}>
                            {res.activityStatus || 'Active'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <select
                            className="RES_ACTION_SELECT"
                            defaultValue=""
                            onChange={(e) => {
                              const action = e.target.value;
                              if (action === 'edit') {
                                setSelectedResident(res);
                                setIsModalOpen(true);
                              } else if (action === 'archive') {
                                handleArchive(res.id);
                              }
                              e.target.value = '';
                            }}
                          >
                            <option value="" disabled>Manage</option>
                            <option value="edit">Edit Profile</option>
                            <option value="archive">Archive Record</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '20px', color: '#64748b' }}>
                      No records found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {/* Pagination */}
            <div className="RES_PAGINATION_BAR">
              <div className="PAG_LEFT">
                Showing {filteredResidents.length > 0 ? startIndex + 1 : 0} to{' '}
                {Math.min(startIndex + ITEMS_PER_PAGE, totalCount)} of {totalCount} entries
              </div>
              <div className="PAG_RIGHT">
                <button
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(p => p - 1)}
                  className="PAG_BTN"
                >
                  <i className="fas fa-chevron-left"></i> Previous
                </button>
                <div className="PAG_NUMBER">Page {currentPage} of {totalPages || 1}</div>
                <button
                  disabled={currentPage >= totalPages || totalPages === 0}
                  onClick={() => setCurrentPage(p => p + 1)}
                  className="PAG_BTN"
                >
                  Next <i className="fas fa-chevron-right"></i>
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* ── Resident Add / Edit Modal ── */}
      {isModalOpen && (
        <ResidentModal
          isOpen={isModalOpen}
          residentData={selectedResident}
          onClose={() => { setIsModalOpen(false); setSelectedResident(null); }}
          onSuccess={() => fetchResidents(true)}
        />
      )}

      {/* ── Verify Chain Modal ── */}
      <VerifyChainModal
        isOpen={isVerifyModalOpen}
        onClose={() => setIsVerifyModalOpen(false)}
        residents={residents}
      />
    </div>
  );
}