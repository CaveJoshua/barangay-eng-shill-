/**
 * ANNOUNCEMENT ROUTER MODULE
 * Updated: Handles image processing via backend to avoid frontend CORS/Preset errors.
 */

import { uploadImage } from './cloud.js'; 

export const AnnouncementRouter = (router, supabase) => {

    // ==========================================
    // 1. GET ALL ANNOUNCEMENTS
    // ==========================================
    router.get('/announcements', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('announcements')
                .select('*')
                .order('priority', { ascending: false }) 
                .order('created_at', { ascending: false });

            if (error) throw error;
            res.status(200).json(data);
        } catch (err) {
            console.error("Fetch Error:", err.message);
            res.status(500).json({ error: "Failed to sync bulletin board." });
        }
    });

    // ==========================================
    // 2. CREATE NEW ANNOUNCEMENT
    // ==========================================
    router.post('/announcements', async (req, res) => {
        try {
            const { title, content, category, priority, expires_at, image_url } = req.body;

            if (!title || !content || !expires_at) {
                return res.status(400).json({ error: "Headline, details, and expiry date are required." });
            }

            let secureImageUrl = null;
            
            // Kung may pinadalang image_url (Base64 string mula sa frontend)
            if (image_url && image_url.startsWith('data:image')) {
                console.log("Uploading new image to Cloudinary...");
                try {
                    secureImageUrl = await uploadImage(image_url, 'barangay_announcements');
                } catch (uploadErr) {
                    console.error("Cloudinary Upload Failed:", uploadErr.message);
                    // Opsyonal: Ituloy pa rin ang save kahit walang image, o mag-error
                }
            }

            const { data, error } = await supabase
                .from('announcements')
                .insert([{
                    title,
                    content,
                    category: category || 'Public Advisory',
                    priority: priority || 'Low',
                    expires_at,
                    image_url: secureImageUrl, // Eto yung binalik ni Cloudinary
                    status: 'Active'
                }])
                .select()
                .single();

            if (error) throw error;
            res.status(201).json(data);
        } catch (err) {
            console.error("Post Error:", err.message);
            res.status(400).json({ error: err.message });
        }
    });

    // ==========================================
    // 3. UPDATE ANNOUNCEMENT
    // ==========================================
    router.put('/announcements/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const updates = { ...req.body };

            delete updates.id; 
            delete updates.created_at;

            // Check kung ang image_url ay bago (Base64) o dati na (URL)
            if (updates.image_url && updates.image_url.startsWith('data:image')) {
                console.log("Updating image on Cloudinary...");
                updates.image_url = await uploadImage(updates.image_url, 'barangay_announcements');
            }

            const { data, error } = await supabase
                .from('announcements')
                .update(updates)
                .eq('id', id)
                .select();

            if (error) throw error;
            if (!data || data.length === 0) return res.status(404).json({ error: "Post not found." });

            res.status(200).json(data[0]);
        } catch (err) {
            console.error("Update Error:", err.message);
            res.status(400).json({ error: err.message });
        }
    });

    // ==========================================
    // 4. DELETE ANNOUNCEMENT
    // ==========================================
    router.delete('/announcements/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const { error } = await supabase
                .from('announcements')
                .delete()
                .eq('id', id);

            if (error) throw error;
            res.status(200).json({ message: "Announcement removed." });
        } catch (err) {
            console.error("Delete Error:", err.message);
            res.status(400).json({ error: err.message });
        }
    });
};