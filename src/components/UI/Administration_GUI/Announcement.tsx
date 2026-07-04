import { useState, useEffect, useMemo, useCallback } from 'react';
import Announcement_modal from '../../buttons/Announcement_modal';
import './styles/Announcement.css';
import './styles/AnnouncementDrafts.css';
import { ApiService } from '../api';

export interface IAnnouncement {
  id: string;
  title: string;
  content: string;
  category: string;
  priority: 'Low' | 'Medium' | 'High';
  status: 'Active' | 'Archived' | 'Draft' | 'Discarded';
  created_at: string;
  expires_at: string;
  views: number;
  image_url?: string;
}

type AnnView = 'Published' | 'Drafts';

export default function AnnouncementPage() {
  const [announcements, setAnnouncements] = useState<IAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [activeView, setActiveView] = useState<AnnView>('Published');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<IAnnouncement | null>(null);

  const fetchAnnouncements = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const data = await ApiService.getAnnouncements(signal);
      if (data === null) return;

      const now = new Date();

      // Process data: mark as Archived if the expiration date has passed.
      // Drafts and Discarded drafts are exempt — neither was ever published,
      // so an unpublished item never auto-archives on its leftover expiry date.
      const processedData = data.map((item: IAnnouncement) => {
        const isExpired = new Date(item.expires_at) < now;
        const neverPublished = item.status === 'Draft' || item.status === 'Discarded';
        return {
          ...item,
          status: (isExpired && !neverPublished) ? 'Archived' : item.status
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

  // 🗑️ A discarded DRAFT never went live — it must NEVER be mistaken for a real
  // "was published, now archived" notice. Using a distinct status (not
  // 'Archived') is what lets the resident-facing feed tell the two apart,
  // since a never-published draft has no historical significance to residents.
  const handleDiscardDraft = async (item: IAnnouncement) => {
    if (!window.confirm("Discard this draft? It was never published and will be removed from the queue.")) return;

    try {
      const payload = { ...item, status: 'Discarded' };
      const result = await ApiService.saveAnnouncement(item.id, payload);

      if (result.success) {
        fetchAnnouncements();
      } else {
        alert(`Discard failed: ${result.error}`);
      }
    } catch (err) {
      alert("System error while discarding.");
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingItem(null);
  };

  // --- FILTER LOGIC ---
  const draftCount = useMemo(
    () => announcements.filter(a => a.status === 'Draft').length,
    [announcements]
  );

  const matchesSearch = useCallback((a: IAnnouncement) => {
    return (a.title?.toLowerCase() || "").includes(searchTerm.toLowerCase()) ||
           (a.content?.toLowerCase() || "").includes(searchTerm.toLowerCase());
  }, [searchTerm]);

  const publishedList = useMemo(() => {
    return announcements.filter(a => {
      if (a.status === 'Archived' || a.status === 'Draft' || a.status === 'Discarded') return false;
      const matchesPriority = priorityFilter === 'All' || a.priority === priorityFilter;
      return matchesSearch(a) && matchesPriority;
    });
  }, [announcements, matchesSearch, priorityFilter]);

  const draftsList = useMemo(
    () => announcements.filter(a => a.status === 'Draft' && matchesSearch(a)),
    [announcements, matchesSearch]
  );

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

          {/* Published vs Drafts — one page, switched by a button tab (not a
              dropdown), each carrying its own live count. */}
          <div className="ANN_TABS">
            <button
              className={`ANN_TAB ${activeView === 'Published' ? 'ACTIVE' : ''}`}
              onClick={() => setActiveView('Published')}
            >
              <i className="fas fa-bullhorn"></i> Published
              <span className="ANN_TAB_COUNT">{publishedList.length}</span>
            </button>
            <button
              className={`ANN_TAB ${activeView === 'Drafts' ? 'ACTIVE' : ''}`}
              onClick={() => setActiveView('Drafts')}
            >
              <i className="fas fa-file-pen"></i> Drafts
              {draftCount > 0 && <span className="ANN_TAB_COUNT">{draftCount > 99 ? '99+' : draftCount}</span>}
            </button>
          </div>

          <div className="ANN_FILTER_BAR">
            <div className="ANN_SEARCH_BOX">
              <i className="fas fa-search"></i>
              <input
                placeholder={`Search ${activeView.toLowerCase()} by keyword...`}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            {activeView === 'Published' && (
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
            )}
          </div>

          {activeView === 'Published' ? (
            <div className="ANN_LIST_WRAP">
              {loading ? (
                <div className="ANN_EMPTY_STATE">
                  <div className="ANN_SPINNER"></div>
                  Syncing bulletin...
                </div>
              ) : publishedList.length === 0 ? (
                <div className="ANN_EMPTY_STATE">No active announcements found.</div>
              ) : (
                publishedList.map(item => (
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
                        <span className={`PRIO_BADGE ${item.priority?.toLowerCase() || 'low'}`}>
                          {item.priority}
                        </span>
                      </div>

                      <div className="ANN_CAT_TAG">{item.category}</div>
                      <p className="ANN_SNIPPET">{item.content}</p>

                      <div className="ANN_FOOT_LINE">
                        <span><i className="fas fa-calendar-alt"></i> {new Date(item.created_at).toLocaleDateString()}</span>
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
          ) : (
            <div className="ADQ_TABLE_WRAP">
              <table className="ADQ_TABLE">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Category</th>
                    <th>Priority</th>
                    <th>Last Saved</th>
                    <th className="ADQ_ALIGN_RIGHT">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={5} className="ANN_EMPTY_STATE">Syncing draft queue...</td></tr>
                  ) : draftsList.length === 0 ? (
                    <tr><td colSpan={5} className="ANN_EMPTY_STATE">No drafts in the queue. New work-in-progress posts will appear here.</td></tr>
                  ) : (
                    draftsList.map(item => (
                      <tr key={item.id} className="ADQ_ROW">
                        <td className="ADQ_TITLE_CELL">
                          <div className="ADQ_TITLE_FLEX">
                            <div className="ADQ_THUMB">
                              {item.image_url ? <img src={item.image_url} alt="" /> : (item.title || '?').charAt(0)}
                            </div>
                            <span>{item.title || '(Untitled draft)'}</span>
                          </div>
                        </td>
                        <td>{item.category}</td>
                        <td><span className={`PRIO_BADGE ${item.priority?.toLowerCase() || 'low'}`}>{item.priority}</span></td>
                        <td>{new Date(item.created_at).toLocaleDateString()}</td>
                        <td className="ADQ_ALIGN_RIGHT">
                          <button className="ANN_ICON_BTN" onClick={() => { setEditingItem(item); setIsModalOpen(true); }} title="Resume editing">
                            <i className="fas fa-pen"></i>
                          </button>
                          <button className="ANN_ICON_BTN ARC" onClick={() => handleDiscardDraft(item)} title="Discard draft">
                            <i className="fas fa-trash"></i>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
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
