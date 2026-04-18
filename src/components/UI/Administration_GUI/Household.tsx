import React, { useState, useEffect, useMemo } from 'react';
import { HOUSEHOLDS_API } from '../api'; 
import HouseHold_modal from '../../buttons/HouseHold_modal';
import Household_view from '../../forms/Household_view';
import './styles/HouseHold.css'; 

interface HouseholdRecord {
  id: string;
  household_number: string;
  head: string;
  zone: string;
  address: string;
  membersCount: number;
  is4Ps: boolean;
}

const ITEMS_PER_PAGE = 10;

const Household: React.FC = () => {
  const [households, setHouseholds] = useState<HouseholdRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  
  // UI logic & Filtering
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState<'All' | '4Ps'>('All');
  const [currentPage, setCurrentPage] = useState(1);
  
  // Modal & View States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editData, setEditData] = useState<any>(null);
  const [viewId, setViewId] = useState<string | null>(null);

  // ── 1. DATA SYNCHRONIZATION ──
  const fetchHouseholds = async () => {
    setLoading(true);
    try {
      const response = await fetch(HOUSEHOLDS_API, { 
        method: 'GET', 
        credentials: 'include' 
      });
      if (!response.ok) throw new Error('Ledger synchronization failed.');
      const data = await response.json();
      setHouseholds(data);
    } catch (err) {
      console.error("[HH_SYNC_ERROR]", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHouseholds();
  }, []);

  // ── 2. GLOBAL EVENT LISTENERS (Outside Click closure) ──
  useEffect(() => {
    const handleGlobalClick = () => setActiveMenuId(null);
    document.addEventListener('click', handleGlobalClick);
    return () => document.removeEventListener('click', handleGlobalClick);
  }, []);

  // ── 3. DATA PROCESSING ENGINE ──
  const filteredData = useMemo(() => {
    return households.filter(hh => {
      if (activeFilter === '4Ps' && !hh.is4Ps) return false;
      const q = searchTerm.toLowerCase().trim();
      return (
        (hh.head || '').toLowerCase().includes(q) || 
        (hh.household_number || '').toLowerCase().includes(q)
      );
    });
  }, [households, searchTerm, activeFilter]);

  const totalPages = Math.ceil(filteredData.length / ITEMS_PER_PAGE);

  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredData.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredData, currentPage]);

  // ── 4. FIXED HEIGHT / GHOST ROW LOGIC ──
  const ghostRowsCount = Math.max(0, ITEMS_PER_PAGE - paginatedData.length);
  const ghostRows = Array.from({ length: ghostRowsCount });

  // ── 5. INTERACTION HANDLERS ──
  const handleToggleMenu = (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); // Prevents row click (View mode)
    setActiveMenuId(activeMenuId === id ? null : id);
  };

  const handleDelete = async (id: string, hhNum: string) => {
    if (!window.confirm(`Dissolve Household Block ${hhNum}? Identity records will be uncoupled.`)) return;
    try {
      const res = await fetch(`${HOUSEHOLDS_API}/${id}`, { 
        method: 'DELETE', 
        credentials: 'include' 
      });
      if (res.ok) {
        setHouseholds(prev => prev.filter(h => h.id !== id));
        setActiveMenuId(null);
      }
    } catch (err) {
      alert("Handshake error during block dissolution.");
    }
  };

  return (
    <div className="HH_PAGE_WRAP">
      <div className="HH_CONTAINER">
        
        {/* ── HEADER ── */}
        <header className="HH_HEADER">
          <div className="HH_TITLE_GROUP">
            <h1 className="HH_PRIMARY_TITLE">Household Profiling</h1>
            <p className="HH_SUBTITLE">System: <span className="DESIGNATION_BADGE">SEC-TYPE-RBIM</span></p>
          </div>
          <button className="HH_BTN HH_BTN_PRIMARY" onClick={() => { setEditData(null); setIsModalOpen(true); }}>
            <i className="fas fa-plus"></i> <span>New Household</span>
          </button>
        </header>

        {/* ── TOOLBAR ── */}
        <div className="HH_TOOLBAR">
          <div className="HH_NAV_TABS">
            <button 
              className={`HH_TAB_ITEM ${activeFilter === 'All' ? 'is-active' : ''}`} 
              onClick={() => { setActiveFilter('All'); setCurrentPage(1); }}
            >
              All Identities <span className="TAB_COUNT">{households.length}</span>
            </button>
            <button 
              className={`HH_TAB_ITEM ${activeFilter === '4Ps' ? 'is-active' : ''}`} 
              onClick={() => { setActiveFilter('4Ps'); setCurrentPage(1); }}
            >
              4Ps Records
            </button>
          </div>

          <div className="HH_SEARCH_ENGINE">
            <i className="fas fa-search"></i>
            <input 
              className="HH_SEARCH_INPUT"
              type="text" 
              placeholder="Search by ID or head of family..." 
              value={searchTerm} 
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }} 
            />
          </div>
        </div>

        {/* ── DATA TABLE (IDENTITY LEDGER STYLE) ── */}
        <div className="HH_DATA_GRID_WRAP">
          <div className="HH_SCROLL_LAYER">
            <table className="HH_GRID">
              <thead>
                <tr>
                  <th>Identity Block</th>
                  <th>Members</th>
                  <th>Zone / Purok</th>
                  <th>Status</th>
                  <th className="u-text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {/* 1. ACTUAL SECURED RECORDS */}
                {!loading && paginatedData.map((hh) => (
                  <tr 
                    key={hh.id} 
                    className="HH_GRID_ROW" 
                    onClick={() => setViewId(hh.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td className="HH_IDENTITY_CLUSTER">
                      <div className="HH_AVATAR_CIRCLE">{hh.head[0]}</div>
                      <div className="HH_ID_INFO_STACK">
                        <span className="HH_FULLNAME">{hh.head}</span>
                        <span className="HH_ID_TAG">{hh.household_number}</span>
                      </div>
                    </td>
                    <td>{hh.membersCount}</td>
                    <td>{hh.zone}</td>
                    <td>
                      <span className={`HH_STATUS_PILL ${hh.is4Ps ? "is-active" : "is-inactive"}`}>
                        {hh.is4Ps ? "ACTIVE_4PS" : "ACTIVE"}
                      </span>
                    </td>
                    <td className="HH_ACTIONS_CONTAINER">
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button 
                          className="HH_MANAGE_TRIGGER"
                          onClick={(e) => handleToggleMenu(e, hh.id)}
                        >
                          Manage
                        </button>
                        
                        {activeMenuId === hh.id && (
                          <div className="HH_DROPDOWN_MENU" onClick={(e) => e.stopPropagation()}>
                            <button className="HH_MENU_ITEM" onClick={() => setViewId(hh.id)}>
                              <i className="fas fa-fingerprint"></i> View Digital ID
                            </button>
                            <button className="HH_MENU_ITEM" onClick={() => { setEditData(hh); setIsModalOpen(true); setActiveMenuId(null); }}>
                              <i className="fas fa-pen-nib"></i> Modify Block
                            </button>
                            <div className="HH_MENU_DIVIDER" />
                            <button className="HH_MENU_ITEM is-danger" onClick={() => handleDelete(hh.id, hh.household_number)}>
                              <i className="fas fa-trash-alt"></i> Dissolve
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}

                {/* 2. GHOST ROWS (Maintains Fixed Height) */}
                {!loading && ghostRows.map((_, idx) => (
                  <tr key={`ghost-${idx}`} className="HH_SKELETON_ROW">
                    <td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>
                  </tr>
                ))}

                {/* 3. LOADING STATE */}
                {loading && (
                  <tr>
                    <td colSpan={5} className="u-text-center u-mt-20">
                      <i className="fas fa-sync fa-spin"></i> Synchronizing Encrypted Ledger...
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ── PAGINATION ── */}
          <footer className="HH_PAGINATION_FOOTER">
            <div className="HH_PAG_SUMMARY">
              Showing {paginatedData.length} of {filteredData.length} secured records
            </div>
            <div className="HH_PAG_NAV">
              <button 
                className="HH_PAG_BTN"
                disabled={currentPage === 1} 
                onClick={() => setCurrentPage(p => Math.max(p - 1, 1))}
              >
                <i className="fas fa-chevron-left"></i> Previous
              </button>
              <span className="HH_PAG_CURRENT">Page {currentPage} of {totalPages || 1}</span>
              <button 
                className="HH_PAG_BTN"
                disabled={currentPage >= totalPages} 
                onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))}
              >
                Next <i className="fas fa-chevron-right"></i>
              </button>
            </div>
          </footer>
        </div>
      </div>

      {/* ── COMPONENT INTEGRATION ── */}
      {isModalOpen && (
        <HouseHold_modal 
          onClose={() => setIsModalOpen(false)} 
          onSaveSuccess={fetchHouseholds} 
          initialData={editData} 
        />
      )}

      {viewId && (
        <Household_view 
          householdId={viewId} 
          onClose={() => setViewId(null)} 
        />
      )}

    </div>
  );
};

export default Household;