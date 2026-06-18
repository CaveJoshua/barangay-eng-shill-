import { useState, useEffect, useMemo, useCallback } from 'react';
import Announcement_modal from '../../buttons/Announcement_modal';
import './styles/Announcement.css';
import { ApiService } from '../api';

export interface IAnnouncement {
  id: string;
  title: string;
  content: string;
  category: string;
  priority: 'Low' | 'Medium' | 'High';
  status: 'Active' | 'Archived';
  created_at: string;
  expires_at: string;
  views: number;
  image_url?: string;
}

export default function AnnouncementPage() {
  const [announcements, setAnnouncements] = useState<IAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('All');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<IAnnouncement | null>(null);

  const fetchAnnouncements = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const data = await ApiService.getAnnouncements(signal);
      if (data === null) return;

      const now = new Date();

      // Process data: mark as Archived if the expiration date has passed
      const processedData = data.map((item: IAnnouncement) => {
        const isExpired = new Date(item.expires_at) < now;
        return {
          ...item,
          status: isExpired ? 'Archived' : item.status
        };
      });

      setAnnouncements(processedData);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error("Bulletin Sync Error:", err);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const valve = new AbortController();
    fetchAnnouncements(valve.signal);
    return () => valve.abort();
  }, [fetchAnnouncements]);

  // 🛡️ THE FIX: Replaced handleDelete with handleArchive. Archived announcements
  // are managed on the dedicated Archive page — this page only lists active ones.
  const handleArchive = async (item: IAnnouncement) => {
    if (!window.confirm("Move this announcement to archives? It will no longer be visible to residents.")) return;

    try {
      // We pass the existing item data but force the status to 'Archived'
      const payload = { ...item, status: 'Archived' };
      const result = await ApiService.saveAnnouncement(item.id, payload);

      if (result.success) {
        fetchAnnouncements();
      } else {
        alert(`Archive failed: ${result.error}`);
      }
    } catch (err) {
      alert("System error during archiving.");
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingItem(null);
  };

  // --- FILTER LOGIC ---
  const filteredList = useMemo(() => {
    return announcements.filter(a => {
      // EXCLUDE ARCHIVED/EXPIRED ANNOUNCEMENTS FROM THIS VIEW (they live on the Archive page)
      if (a.status === 'Archived') return false;

      const matchesSearch = (a.title?.toLowerCase() || "").includes(searchTerm.toLowerCase()) ||
                            (a.content?.toLowerCase() || "").includes(searchTerm.toLowerCase());
      const matchesPriority = priorityFilter === 'All' || a.priority === priorityFilter;

      return matchesSearch && matchesPriority;
    });
  }, [announcements, searchTerm, priorityFilter]);

  return (
    <div className="ANN_PAGE_WRAP">
      <div className="ANN_MAIN_CONTAINER">

        <header className="ANN_HEADER">
          <div className="ANN_TITLE_GROUP">
            <h1 className="ANN_TITLE">Bulletin Board</h1>
            <p className="ANN_SUB">Manage and broadcast community updates.</p>
          </div>
          <button className="BTN_ADD_NEW" onClick={() => { setEditingItem(null); setIsModalOpen(true); }}>
            <i className="fas fa-plus"></i> New Announcement
          </button>
        </header>

        <div className="ANN_CONTENT_CARD">

          <div className="ANN_FILTER_BAR">
            <div className="ANN_SEARCH_BOX">
              <i className="fas fa-search"></i>
              <input
                placeholder="Search by keyword..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <div className="ANN_FILTER_GROUP">
              <label>Priority:</label>
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
              >
                <option value="All">All Records</option>
                <option value="High">High Only</option>
                <option value="Medium">Medium Only</option>
                <option value="Low">Low Only</option>
              </select>
            </div>
          </div>

          <div className="ANN_LIST_WRAP">
            {loading ? (
              <div className="ANN_EMPTY_STATE">
                <div className="ANN_SPINNER"></div>
                Syncing bulletin...
              </div>
            ) : filteredList.length === 0 ? (
              <div className="ANN_EMPTY_STATE">No active announcements found.</div>
            ) : (
              filteredList.map(item => (
                <div key={item.id} className="ANN_ITEM_ROW">
                  <div className="ANN_THUMBNAIL_BOX">
                    {item.image_url ? (
                      <img src={item.image_url} alt="post" />
                    ) : (
                      <div className="ANN_INITIAL">{(item.title || "?").charAt(0)}</div>
                    )}
                  </div>

                  <div className="ANN_INFO_BOX">
                    <div className="ANN_TOP_LINE">
                      <h4>{item.title}</h4>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span className={`PRIO_BADGE ${item.priority?.toLowerCase() || 'low'}`}>
                          {item.priority}
                        </span>
                      </div>
                    </div>

                    <div className="ANN_CAT_TAG">{item.category}</div>
                    <p className="ANN_SNIPPET">{item.content}</p>

                    <div className="ANN_FOOT_LINE">
                      <span><i className="fas fa-calendar-alt"></i> {new Date(item.created_at).toLocaleDateString()}</span>
                      <span className="ANN_EXPIRY">
                        <i className="fas fa-clock"></i> Expires: {new Date(item.expires_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  <div className="ANN_ACTIONS_BOX">
                    <button className="ANN_ICON_BTN" onClick={() => { setEditingItem(item); setIsModalOpen(true); }} title="Edit">
                      <i className="fas fa-pen"></i>
                    </button>
                    {/* 🛡️ Archive action — moves the item to the dedicated Archive page */}
                    <button className="ANN_ICON_BTN ARC" onClick={() => handleArchive(item)} title="Archive">
                      <i className="fas fa-archive"></i>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <Announcement_modal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onSuccess={() => fetchAnnouncements()}
        editingItem={editingItem}
      />
    </div>
  );
}
