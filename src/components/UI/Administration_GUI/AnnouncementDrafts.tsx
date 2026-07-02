import { useState, useEffect, useMemo, useCallback } from 'react';
import Announcement_modal from '../../buttons/Announcement_modal';
import type { IAnnouncement } from './Announcement';
import './styles/Announcement.css';
import './styles/AnnouncementDrafts.css';
import { ApiService } from '../api';

// Dedicated page for unpublished work — kept entirely separate from the
// Bulletin Board so an in-progress draft never mixes into the resident-visible
// stream. This is the "queue" the sidebar badge count points to.
export default function AnnouncementDraftsPage() {
  const [drafts, setDrafts] = useState<IAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<IAnnouncement | null>(null);

  const fetchDrafts = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const data = await ApiService.getAnnouncements(signal);
      if (data === null) return;
      setDrafts((data as IAnnouncement[]).filter(a => a.status === 'Draft'));
    } catch (err: any) {
      if (err.name !== 'AbortError') console.error("Draft Queue Sync Error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const valve = new AbortController();
    fetchDrafts(valve.signal);
    return () => valve.abort();
  }, [fetchDrafts]);

  const handleDiscard = async (item: IAnnouncement) => {
    if (!window.confirm(`Discard "${item.title}"?\n\nThe draft is moved to the Archive and removed from the queue.`)) return;

    try {
      const result = await ApiService.saveAnnouncement(item.id, { ...item, status: 'Archived' });
      if (result.success) {
        fetchDrafts();
      } else {
        alert(`Discard failed: ${result.error}`);
      }
    } catch (err) {
      alert("System error while discarding draft.");
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingItem(null);
  };

  const filteredDrafts = useMemo(() => {
    const q = searchTerm.toLowerCase();
    return drafts.filter(d =>
      (d.title?.toLowerCase() || '').includes(q) || (d.content?.toLowerCase() || '').includes(q)
    );
  }, [drafts, searchTerm]);

  return (
    <div className="ANN_PAGE_WRAP">
      <div className="ANN_MAIN_CONTAINER">

        <header className="ANN_HEADER">
          <div className="ANN_TITLE_GROUP">
            <h1 className="ANN_TITLE">
              Draft Announcements
              {drafts.length > 0 && (
                <span className="ADQ_HEADER_COUNT" title={`${drafts.length} draft${drafts.length === 1 ? '' : 's'} queued`}>
                  {drafts.length > 99 ? '99+' : drafts.length}
                </span>
              )}
            </h1>
            <p className="ANN_SUB">Unpublished work-in-progress, held here until completed or discarded.</p>
          </div>
        </header>

        <div className="ANN_CONTENT_CARD">
          <div className="ANN_FILTER_BAR">
            <div className="ANN_SEARCH_BOX">
              <i className="fas fa-search"></i>
              <input
                placeholder="Search drafts by keyword..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

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
                ) : filteredDrafts.length === 0 ? (
                  <tr><td colSpan={5} className="ANN_EMPTY_STATE">No drafts in the queue. New work-in-progress posts will appear here.</td></tr>
                ) : (
                  filteredDrafts.map(item => (
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
                        <button className="ANN_ICON_BTN ARC" onClick={() => handleDiscard(item)} title="Discard draft">
                          <i className="fas fa-trash"></i>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Announcement_modal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onSuccess={() => fetchDrafts()}
        editingItem={editingItem}
      />
    </div>
  );
}
