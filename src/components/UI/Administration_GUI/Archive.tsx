import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import styles from './styles/Archive.module.css';
import { ApiService } from '../api';

type ArchiveTab = 'Documents' | 'Blotter' | 'Residents' | 'Officials' | 'Households' | 'Announcements';

export default function Archive() {
  const [activeTab, setActiveTab] = useState<ArchiveTab>('Documents');
  
  // Data States
  const [documents, setDocuments] = useState<any[]>([]);
  const [blotters, setBlotters] = useState<any[]>([]);
  const [residents, setResidents] = useState<any[]>([]);
  const [officials, setOfficials] = useState<any[]>([]);
  const [households, setHouseholds] = useState<any[]>([]);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  
  // Track which tabs have already been loaded to prevent redundant fetches
  const loadedTabs = useRef<Set<string>>(new Set());

  // UI States
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  
  // Pagination States
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  const isMounted = useRef(true);
  const isFetching = useRef(false);

  // --- 1. TARGETED HANDSHAKE (Only fetch what is needed) ---
  const fetchSpecificArchive = useCallback(async (tab: ArchiveTab, signal?: AbortSignal) => {
    if (isFetching.current) return;
    
    setLoading(true);
    isFetching.current = true;

    try {
      let data: any = null;
      const now = new Date();

      switch (tab) {
        case 'Documents':
          data = await ApiService.getDocuments(signal);
          if (data && isMounted.current) {
            setDocuments(data.filter((d: any) => ['Completed', 'Rejected', 'Archived'].includes(d.status)));
          }
          break;
        case 'Blotter':
          data = await ApiService.getBlotters(signal);
          if (data && isMounted.current) {
            setBlotters(data.filter((b: any) => ['Settled', 'Archived', 'Dismissed', 'Rejected'].includes(b.status)));
          }
          break;
        case 'Residents':
          data = await ApiService.getResidents(signal);
          if (data && isMounted.current) {
            setResidents(data.filter((r: any) => ['Archived', 'Deceased', 'Relocated'].includes(r.status || r.activity_status)));
          }
          break;
        case 'Officials':
          data = await ApiService.getOfficials(signal);
          if (data && isMounted.current) {
            setOfficials(data.filter((o: any) => {
              // 1. Check if their term is officially over based on the date
              const isExpired = o.term_end && !isNaN(new Date(o.term_end).getTime()) && new Date(o.term_end) < now;
              
              // 2. Check if their status marks them as no longer active
              const isInactiveStatus = ['Archived', 'Inactive', 'Former', 'End of Term', 'Resigned'].includes(o.status);
              
              // If either condition is met, they belong in the archive
              return isExpired || isInactiveStatus;
            }));
          }
          break;
        case 'Households':
          data = await ApiService.getHouseholds(signal);
          if (data && isMounted.current) {
            setHouseholds(data.filter((h: any) => ['Archived', 'Inactive', 'Relocated'].includes(h.status)));
          }
          break;
        case 'Announcements':
          data = await ApiService.getAnnouncements(signal);
          if (data && isMounted.current) {
            // Captures manually archived announcements OR naturally expired ones
            setAnnouncements(data.filter((a: any) => a.status === 'Archived' || new Date(a.expires_at) < now));
          }
          break;
      }

      if (isMounted.current) loadedTabs.current.add(tab);

    } catch (err) {
      console.error(`[ARCHIVE] Failed to load ${tab}:`, err);
    } finally {
      if (isMounted.current) {
        setLoading(false);
        isFetching.current = false;
      }
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;
    const valve = new AbortController();

    if (!loadedTabs.current.has(activeTab)) {
      fetchSpecificArchive(activeTab, valve.signal);
    } else {
      setLoading(false);
    }

    return () => {
      isMounted.current = false;
      valve.abort();
    };
  }, [activeTab, fetchSpecificArchive]);

  useEffect(() => { setCurrentPage(1); }, [activeTab, searchTerm, filterStatus]);
  useEffect(() => { setFilterStatus('All'); }, [activeTab]);

  // --- 2. SEARCH & DYNAMIC FILTERING ---
  const filteredData = useMemo(() => {
    const q = searchTerm.toLowerCase();

    switch (activeTab) {
      case 'Documents':
        return documents.filter(d => 
          (filterStatus === 'All' || d.status === filterStatus) &&
          ((d.reference_no || '').toLowerCase().includes(q) || (d.resident_name || '').toLowerCase().includes(q))
        ).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      case 'Blotter':
        return blotters.filter(b => 
          (filterStatus === 'All' || b.status === filterStatus) &&
          ((b.case_number || '').toLowerCase().includes(q) || (b.complainant_name || '').toLowerCase().includes(q))
        ).sort((a, b) => new Date(b.date_filed || b.created_at).getTime() - new Date(a.date_filed || a.created_at).getTime());

      case 'Residents':
        return residents.filter(r => 
          (filterStatus === 'All' || r.status === filterStatus) &&
          (`${r.first_name} ${r.last_name}`.toLowerCase().includes(q))
        ).sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime());

      case 'Officials':
        return officials.filter(o => 
          (filterStatus === 'All' || filterStatus === 'Archived') && // Keep filter simple for retired officials
          ((o.full_name || '').toLowerCase().includes(q) || (o.position || '').toLowerCase().includes(q))
        ).sort((a, b) => new Date(b.term_end || b.updated_at).getTime() - new Date(a.term_end || a.updated_at).getTime());

      case 'Households':
        return households.filter(h => 
          (filterStatus === 'All' || h.status === filterStatus) &&
          ((h.household_number || '').toLowerCase().includes(q) || (h.head || '').toLowerCase().includes(q))
        ).sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime());
      
      case 'Announcements':
        return announcements.filter(a => 
          (filterStatus === 'All' || filterStatus === 'Archived') &&
          ((a.title || '').toLowerCase().includes(q) || (a.category || '').toLowerCase().includes(q))
        ).sort((a, b) => new Date(b.expires_at).getTime() - new Date(a.expires_at).getTime());

      default: return [];
    }
  }, [documents, blotters, residents, officials, households, announcements, activeTab, searchTerm, filterStatus]);

  // --- 3. PAGINATION ---
  const totalPages = Math.ceil(filteredData.length / ITEMS_PER_PAGE);
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredData.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredData, currentPage]);

  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    const d = new Date(dateString);
    return isNaN(d.getTime()) ? 'Invalid Date' : d.toLocaleDateString();
  };

  const getFilterOptions = () => {
    switch (activeTab) {
      case 'Documents': return ['All', 'Completed', 'Rejected', 'Archived'];
      case 'Blotter': return ['All', 'Settled', 'Dismissed', 'Archived', 'Rejected'];
      case 'Residents': return ['All', 'Archived', 'Deceased', 'Relocated'];
      case 'Officials': return ['All', 'Archived']; // Simplified since they are all technically archived here
      case 'Households': return ['All', 'Archived', 'Inactive', 'Relocated'];
      case 'Announcements': return ['All', 'Archived'];
      default: return ['All'];
    }
  };

  return (
    <div className={styles.ARC_PAGE_WRAP}>
      <div className={styles.ARC_MAIN_CONTAINER}>
        
        <div className={styles.ARC_STATS_PANEL}>
           <div className={styles.ARC_STAT_COL}>
              <div className={styles.ARC_STAT_TITLE}>VAULT STATUS</div>
              <div className={styles.ARC_STAT_SUB}>Historical Records</div>
              <div className={styles.ARC_STAT_HIGHLIGHT}><i className="fas fa-lock"></i> Read-Only</div>
           </div>
           <div className={`${styles.ARC_STAT_COL} ${styles.ARC_STAT_WIDE}`}>
              <div className={styles.ARC_STAT_TITLE}>ARCHIVE DIRECTORY</div>
              <div className={styles.ARC_STAT_SUB}>Access permanently closed cases, former officials, and finalized records.</div>
           </div>
           <div className={styles.ARC_TOTAL_COL}>
              <div className={styles.ARC_BIG_NUMBER}>{filteredData.length}</div>
              <div className={styles.ARC_STAT_TITLE}>TOTAL {activeTab.toUpperCase()}</div>
           </div>
        </div>

        <div className={styles.ARC_TABS_CONTAINER}>
          {(['Documents', 'Blotter', 'Residents', 'Officials', 'Households', 'Announcements'] as ArchiveTab[]).map((tab) => (
            <button key={tab} className={`${styles.ARC_TAB_BTN} ${activeTab === tab ? styles.ACTIVE : ''}`} onClick={() => setActiveTab(tab)}>
              {tab}
            </button>
          ))}
        </div>

        <div className={styles.ARC_SEARCH_ROW}>
           <div className={styles.ARC_SEARCH_WRAPPER}>
             <i className={`fas fa-search ${styles.ARC_SEARCH_ICON}`}></i>
             <input className={styles.ARC_SEARCH_INPUT} placeholder={`Search ${activeTab.toLowerCase()} archive...`} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
           </div>
           <div className={styles.ARC_FILTER_WRAPPER}>
             <label className={styles.ARC_FILTER_LABEL}>Status:</label>
             <select className={styles.ARC_FILTER_SELECT} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
               {getFilterOptions().map(opt => <option key={opt} value={opt}>{opt}</option>)}
             </select>
           </div>
           <button className={styles.ARC_REFRESH_BTN} onClick={() => { loadedTabs.current.delete(activeTab); fetchSpecificArchive(activeTab); }} title="Reload Current Tab">
              <i className={`fas fa-sync-alt ${loading ? 'fa-spin' : ''}`}></i>
           </button>
        </div>

        <div className={styles.ARC_TABLE_CARD}>
           <div className={styles.ARC_TABLE_WRAP}>
               {loading ? (
                  <div className={styles.ARC_LOADING_STATE}><i className="fas fa-circle-notch fa-spin"></i><p>Loading {activeTab}...</p></div>
               ) : (
                 <table className={styles.ARC_TABLE_MAIN}>
                   <thead>
                     <tr>
                       {activeTab === 'Documents' && (<><th>REF NO.</th><th>RESIDENT</th><th>TYPE</th><th>FINALIZED</th></>)}
                       {activeTab === 'Blotter' && (<><th>CASE NO.</th><th>COMPLAINANT</th><th>RESPONDENT</th><th>FILED</th></>)}
                       {activeTab === 'Residents' && (<><th>ID</th><th>FULL NAME</th><th>SEX</th><th>DOB</th></>)}
                       {activeTab === 'Officials' && (<><th>NAME</th><th>POSITION</th><th>TERM START</th><th>TERM END</th></>)}
                       {activeTab === 'Households' && (<><th>HH NO.</th><th>HEAD</th><th>ZONE</th><th>STATUS</th></>)}
                       {activeTab === 'Announcements' && (<><th>TITLE</th><th>CATEGORY</th><th>PRIORITY</th><th>EXPIRED ON</th></>)}
                       <th className={styles.ARC_ALIGN_RIGHT}>FINAL STATUS</th>
                     </tr>
                   </thead>
                   <tbody>
                     {paginatedData.length === 0 ? (
                        <tr><td colSpan={6} className={styles.ARC_EMPTY_STATE}><i className="fas fa-box-open"></i><br/>No archived records found.</td></tr>
                     ) : paginatedData.map((item, index) => {
                       // Force uniform "Archived" status logic for officials whose term is done
                       let currentStatus = (item.status || item.activity_status || 'Archived').toUpperCase();
                       if (activeTab === 'Announcements') currentStatus = 'ARCHIVED';
                       if (activeTab === 'Officials') {
                         const isExpired = item.term_end && !isNaN(new Date(item.term_end).getTime()) && new Date(item.term_end) < new Date();
                         if (isExpired) currentStatus = 'END OF TERM';
                       }
                       
                       const badgeClass = styles[`STATUS_${currentStatus.replace(/\s+/g, '_')}`] || styles.STATUS_DEFAULT;

                       return (
                       <tr key={item.id || index}>
                         {activeTab === 'Documents' && (
                           <><td className={styles.ARC_ID_CELL}>{item.reference_no || 'N/A'}</td><td className={styles.ARC_NAME_CELL}>{item.resident_name}</td><td>{item.type}</td><td>{formatDate(item.created_at)}</td></>
                         )}
                         {activeTab === 'Blotter' && (
                           <><td className={styles.ARC_ID_CELL}>{item.case_number}</td><td className={styles.ARC_NAME_CELL}>{item.complainant_name}</td><td>{item.respondent}</td><td>{formatDate(item.date_filed)}</td></>
                         )}
                         {activeTab === 'Residents' && (
                           <><td className={styles.ARC_ID_CELL}>{item.record_id}</td><td className={styles.ARC_NAME_CELL}>{item.first_name} {item.last_name}</td><td>{item.sex}</td><td>{formatDate(item.dob)}</td></>
                         )}
                         {activeTab === 'Officials' && (
                           <><td className={styles.ARC_NAME_CELL}>{item.full_name}</td><td>{item.position}</td><td>{formatDate(item.term_start)}</td><td>{formatDate(item.term_end)}</td></>
                         )}
                         {activeTab === 'Households' && (
                           <><td className={styles.ARC_ID_CELL}>{item.household_number}</td><td className={styles.ARC_NAME_CELL}>{item.head}</td><td>{item.zone}</td><td>{item.status}</td></>
                         )}
                         {activeTab === 'Announcements' && (
                           <><td className={styles.ARC_NAME_CELL}>{item.title}</td><td>{item.category}</td><td>{item.priority}</td><td>{formatDate(item.expires_at)}</td></>
                         )}
                         <td className={styles.ARC_ALIGN_RIGHT}>
                           <span className={`${styles.ARC_BADGE} ${badgeClass}`}>{currentStatus}</span>
                         </td>
                       </tr>
                     )})}
                   </tbody>
                 </table>
               )}
           </div>

           <div className={styles.ARC_PAGINATION}>
             <span className={styles.ARC_PAGE_INFO}>Page {currentPage} of {totalPages || 1}</span>
             <div className={styles.ARC_NAV_GROUP}>
               <button className={styles.ARC_NAV_BTN} disabled={currentPage === 1 || loading} onClick={() => setCurrentPage(p => p - 1)}><i className="fas fa-chevron-left"></i></button>
               <button className={styles.ARC_NAV_BTN} disabled={currentPage === totalPages || totalPages === 0 || loading} onClick={() => setCurrentPage(p => p + 1)}><i className="fas fa-chevron-right"></i></button>
             </div>
           </div>
        </div>

      </div>
    </div>
  );
}