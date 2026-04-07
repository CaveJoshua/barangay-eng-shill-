import React, { useState, useEffect, useMemo } from 'react';
import { HOUSEHOLDS_API } from '../api'; // 🛡️ Removed getAuthHeaders
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
  const [error, setError] = useState('');
  
  // UI State
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState<'All' | '4Ps'>('All');
  const [currentPage, setCurrentPage] = useState(1);
  
  // Modal States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editData, setEditData] = useState<any>(null);
  const [viewId, setViewId] = useState<string | null>(null);

  // ── 1. FETCH DATA (FIXED WITH ZERO TRUST HANDSHAKE) ──
  const fetchHouseholds = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(HOUSEHOLDS_API, {
        method: 'GET',
        credentials: 'include' // 🛡️ The Magic Key
      });

      if (!response.ok) {
        throw new Error('Failed to fetch household records. Please check your connection.');
      }

      const data = await response.json();
      setHouseholds(data);
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHouseholds();
  }, []);

  // ── 2. FILTER & SEARCH LOGIC ──
  const processedHouseholds = useMemo(() => {
    // Reset to page 1 whenever filters change
    setCurrentPage(1);

    return households.filter(hh => {
      if (activeFilter === '4Ps' && !hh.is4Ps) return false;

      const query = searchTerm.toLowerCase().trim();
      if (query) {
        const matchHead = (hh.head || '').toLowerCase().includes(query);
        const matchNum = (hh.household_number || '').toLowerCase().includes(query);
        if (!matchHead && !matchNum) return false;
      }
      return true;
    });
  }, [households, searchTerm, activeFilter]);

  // ── 3. PAGINATION LOGIC ──
  const totalPages = Math.ceil(processedHouseholds.length / ITEMS_PER_PAGE);
  const paginatedHouseholds = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return processedHouseholds.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [processedHouseholds, currentPage]);

  // ── 4. HANDLERS ──
  const handleOpenCreate = () => {
    setEditData(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (hh: HouseholdRecord) => {
    setEditData(hh);
    setIsModalOpen(true);
  };

  // ── 5. DELETE RECORD (FIXED WITH ZERO TRUST HANDSHAKE) ──
  const handleDelete = async (id: string, hhNum: string) => {
    if (!window.confirm(`Are you sure you want to delete Household ${hhNum}? The residents will not be deleted, but they will be unlinked from this house.`)) {
      return;
    }

    try {
      const response = await fetch(`${HOUSEHOLDS_API}/${id}`, {
        method: 'DELETE',
        credentials: 'include' // 🛡️ The Magic Key applied to deletes as well
      });

      if (!response.ok) throw new Error("Failed to delete household");
      
      setHouseholds(prev => prev.filter(h => h.id !== id));
      alert("Household removed successfully.");
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="PF_WIDE_CONTAINER" style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      
      {/* ── HEADER ── */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '2rem', color: 'var(--c--p--text-primary)' }}>Household Profiling</h1>
          <p style={{ margin: '5px 0 0 0', color: 'var(--c--p--text-secondary)' }}>RBIM-Compliant Family Records System.</p>
        </div>
        <button 
          onClick={handleOpenCreate}
          style={{ background: 'var(--c--p--bg-button, #1e293b)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <i className="fas fa-plus"></i> New Household
        </button>
      </header>

      {error && (
        <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
          <i className="fas fa-exclamation-triangle"></i> {error}
        </div>
      )}

      {/* ── TOOLBAR (TABS & SEARCH) ── */}
      <div style={{ background: 'var(--c--p--bg-card)', borderRadius: '12px', border: '1px solid var(--c--p--border-subtle)', overflow: 'hidden' }}>
        
        <div style={{ display: 'flex', gap: '1rem', padding: '1rem 1.5rem', borderBottom: '1px solid var(--c--p--border-subtle)', background: 'var(--c--p--bg-main)' }}>
          <button 
            onClick={() => setActiveFilter('All')}
            style={{ padding: '6px 16px', borderRadius: '20px', border: 'none', cursor: 'pointer', fontWeight: 600, background: activeFilter === 'All' ? '#e0e7ff' : 'transparent', color: activeFilter === 'All' ? '#4f46e5' : 'var(--c--p--text-secondary)' }}
          >
            All <span style={{ background: activeFilter === 'All' ? '#c7d2fe' : '#e2e8f0', padding: '2px 8px', borderRadius: '10px', fontSize: '0.8rem', marginLeft: '6px' }}>{households.length}</span>
          </button>
          <button 
            onClick={() => setActiveFilter('4Ps')}
            style={{ padding: '6px 16px', borderRadius: '20px', border: 'none', cursor: 'pointer', fontWeight: 600, background: activeFilter === '4Ps' ? '#e0e7ff' : 'transparent', color: activeFilter === '4Ps' ? '#4f46e5' : 'var(--c--p--text-secondary)' }}
          >
            4Ps
          </button>
        </div>

        <div style={{ padding: '1rem 1.5rem' }}>
          <div style={{ position: 'relative', maxWidth: '400px' }}>
            <i className="fas fa-search" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}></i>
            <input 
              type="text" 
              placeholder="Search Head or HH Number..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '100%', padding: '10px 10px 10px 35px', borderRadius: '8px', border: '1px solid var(--c--p--border-subtle)', background: 'var(--c--p--bg-main)', color: 'var(--c--p--text-primary)' }}
            />
          </div>
        </div>

        {/* ── DATA TABLE ── */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'var(--c--p--bg-main)', color: 'var(--c--p--text-secondary)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <th style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--c--p--border-subtle)' }}>HH Number</th>
                <th style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--c--p--border-subtle)' }}>Family Head</th>
                <th style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--c--p--border-subtle)' }}>Zone</th>
                <th style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--c--p--border-subtle)' }}>Members</th>
                <th style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--c--p--border-subtle)' }}>Status</th>
                <th style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--c--p--border-subtle)', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '3rem', color: 'var(--c--p--text-secondary)' }}>
                    <i className="fas fa-spinner fa-spin" style={{ marginRight: '8px' }}></i> Loading households...
                  </td>
                </tr>
              ) : paginatedHouseholds.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '3rem', color: 'var(--c--p--text-secondary)' }}>
                    No household records found.
                  </td>
                </tr>
              ) : (
                paginatedHouseholds.map((hh) => (
                  <tr key={hh.id} style={{ borderBottom: '1px solid var(--c--p--border-subtle)' }}>
                    <td style={{ padding: '1rem 1.5rem', fontWeight: 600, color: 'var(--c--p--brand-blue)' }}>{hh.household_number}</td>
                    <td style={{ padding: '1rem 1.5rem', color: 'var(--c--p--text-primary)', fontWeight: 500 }}>{hh.head}</td>
                    <td style={{ padding: '1rem 1.5rem', color: 'var(--c--p--text-secondary)' }}>{hh.zone}</td>
                    <td style={{ padding: '1rem 1.5rem', color: 'var(--c--p--text-secondary)' }}>{hh.membersCount}</td>
                    <td style={{ padding: '1rem 1.5rem' }}>
                      {hh.is4Ps ? (
                        <span style={{ background: '#dcfce7', color: '#166534', padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 700 }}>4Ps</span>
                      ) : (
                        <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Standard</span>
                      )}
                    </td>
                    <td style={{ padding: '1rem 1.5rem', textAlign: 'right' }}>
                      <button onClick={() => setViewId(hh.id)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', marginRight: '10px' }} title="View Profile">
                        <i className="fas fa-eye"></i>
                      </button>
                      <button onClick={() => handleOpenEdit(hh)} style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', marginRight: '10px' }} title="Edit">
                        <i className="fas fa-edit"></i>
                      </button>
                      <button onClick={() => handleDelete(hh.id, hh.household_number)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }} title="Delete">
                        <i className="fas fa-trash"></i>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        
        {/* ── PAGINATION CONTROLS ── */}
        <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--c--p--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--c--p--text-secondary)', fontSize: '0.9rem' }}>
          <div>
            Showing {paginatedHouseholds.length} of {processedHouseholds.length} records
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button 
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              style={{ padding: '5px 12px', borderRadius: '6px', border: '1px solid var(--c--p--border-subtle)', cursor: currentPage === 1 ? 'not-allowed' : 'pointer', background: 'var(--c--p--bg-main)', opacity: currentPage === 1 ? 0.5 : 1 }}
            >
              Previous
            </button>
            <span style={{ display: 'flex', alignItems: 'center', padding: '0 10px', fontWeight: 600 }}>
              Page {currentPage} of {totalPages || 1}
            </span>
            <button 
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              style={{ padding: '5px 12px', borderRadius: '6px', border: '1px solid var(--c--p--border-subtle)', cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer', background: 'var(--c--p--bg-main)', opacity: currentPage >= totalPages ? 0.5 : 1 }}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* ── MODALS ── */}
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