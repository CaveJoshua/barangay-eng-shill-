import React, { useState, useEffect, useRef } from 'react';
import './styles/Announcement_modal.css'; 
import { type IAnnouncement } from '../UI/Administration_GUI/Announcement'; 
import { ApiService } from '../UI/api'; 

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
};

const Announcement_modal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
  editingItem?: IAnnouncement | null;
}> = ({ isOpen, onClose, onSuccess, editingItem }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>('');

  // 🛡️ THE FIX: Use a dedicated ref instead of document.getElementById
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    title: '',
    content: '',
    category: 'Public Advisory',
    priority: 'Low',
    status: 'Active',
    expires_at: '',
    image_url: ''
  });

  useEffect(() => {
    if (isOpen) {
      setImageFile(null); 
      if (editingItem) {
        setFormData({
          title: editingItem.title || '',
          content: editingItem.content || '',
          category: editingItem.category || 'Public Advisory',
          priority: editingItem.priority || 'Low',
          status: editingItem.status || 'Active',
          expires_at: editingItem.expires_at ? new Date(editingItem.expires_at).toISOString().split('T')[0] : '',
          image_url: editingItem.image_url || ''
        });
        setImagePreview(editingItem.image_url || '');
      } else {
        setFormData({ title: '', content: '', category: 'Public Advisory', priority: 'Low', status: 'Active', expires_at: '', image_url: '' });
        setImagePreview('');
      }
    }
  }, [isOpen, editingItem]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      let finalImagePayload = formData.image_url;
      if (imageFile) {
        finalImagePayload = await fileToBase64(imageFile);
      }

      const payload = { ...formData, image_url: finalImagePayload };
      const result = await ApiService.saveAnnouncement(editingItem?.id || null, payload);

      if (result.success) {
        onSuccess(); 
        onClose(); 
      } else {
        alert(`Broadcast Error: ${result.error}`);
      }

    } catch (error: any) { 
        console.error("[MODAL ERROR]", error.message);
        alert('Handshake failed. Check if Backend is active.'); 
    } finally { 
        setIsSubmitting(false); 
    }
  };

  return (
    <div className="AM_OVERLAY" onClick={onClose}>
      <div className="AM_CONTENT" onClick={(e) => e.stopPropagation()}>
        
        <div className="AM_HEADER">
          <h3>{editingItem ? 'Edit Announcement' : 'New Announcement'}</h3>
          <p>Broadcast a message to the community.</p>
        </div>

        <form onSubmit={handleSubmit} className="AM_SCROLL_WRAPPER">
          <div className="AM_FORM_BODY">
            <div className="AM_GROUP">
              
              <label>Title</label>
              <input type="text" className="AM_INPUT" placeholder="*Required" required value={formData.title} onChange={(e) => setFormData({...formData, title: e.target.value})} />
            </div>

            <div className="AM_GROUP">
              <label>Content</label>
              <textarea className="AM_TEXTAREA" placeholder="Provide complete details here..." required value={formData.content} onChange={(e) => setFormData({...formData, content: e.target.value})} />
            </div>

            <div className="AM_ROW">
              <div className="AM_GROUP">
                <label>Category</label>
                <select className="AM_SELECT" value={formData.category} onChange={(e) => setFormData({...formData, category: e.target.value})}>
                  <option value="Public Advisory">Public Advisory</option>
                  <option value="Senior Citizen">Senior Citizen</option>
                  <option value="Health & Safety">Health & Safety</option>
                  <option value="Youth & Sports">Youth & Sports</option>
                  <option value="Community Project">Community Project</option>
                </select>
              </div>
              <div className="AM_GROUP">
                <label>Priority Level</label>
                <select className="AM_SELECT" value={formData.priority} onChange={(e) => setFormData({...formData, priority: e.target.value})}>
                  <option value="Low">Low Priority</option>
                  <option value="Medium">Medium Priority</option>
                  <option value="High">High Priority (Urgent)</option>
                </select>
              </div>
            </div>

            <div className="AM_ROW">
              {editingItem && (
                <div className="AM_GROUP">
                  <label>Status</label>
                  <select className="AM_SELECT" value={formData.status} onChange={(e) => setFormData({...formData, status: e.target.value})}>
                    <option value="Active">Active</option>
                    <option value="Archived">Archived</option>
                  </select>
                </div>
              )}
              
              <div className="AM_GROUP">
                <label>Lapse / Expiration Date</label>
                <input type="date" className="AM_INPUT" required value={formData.expires_at} onChange={(e) => setFormData({...formData, expires_at: e.target.value})} />
                <small style={{color: '#64748b', fontSize: '11px', marginTop: '4px'}}>When should this be due it's date</small>
              </div>
            </div>

            <div className="AM_GROUP">
              <label>Cover Image (Recommended)</label>
              {/* 🛡️ THE FIX: Trigger the specific ref instead of an ID search */}
              <div className="AM_UPLOAD_ZONE" onClick={() => fileInputRef.current?.click()}>
                {!imagePreview ? (
                  <div className="AM_UPLOAD_PLACEHOLDER">
                    <i className="fas fa-cloud-upload-alt"></i>
                    <p>Click to upload image</p>
                  </div>
                ) : (
                  <div className="AM_IMAGE_PREVIEW">
                    <img src={imagePreview} alt="Preview" />
                  </div>
                )}
                {/* 🛡️ THE FIX: Attach the ref to the input */}
                <input 
                  ref={fileInputRef} 
                  type="file" 
                  accept="image/*" 
                  hidden 
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      setImageFile(e.target.files[0]);
                      setImagePreview(URL.createObjectURL(e.target.files[0]));
                    }
                  }} 
                />
              </div>
            </div>
          </div>

          <div className="AM_FOOTER">
            <button type="button" className="AM_BTN_SEC" onClick={onClose}>Discard</button>
            <button type="submit" className="AM_BTN_PRI" disabled={isSubmitting}>
              {isSubmitting ? <i className="fas fa-spinner fa-spin"></i> : (editingItem ? 'Update Broadcast' : 'Post Announcement')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Announcement_modal;
