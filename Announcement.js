/**
 * ANNOUNCEMENT ROUTER MODULE
 * Updated: Features a Backend Image Compression Engine to lower resolution,
 * maintain high quality, and drastically reduce file size before Cloudinary upload.
 */

import { uploadImage } from './cloud.js'; 
import sharp from 'sharp';

// ==========================================
// 🛡️ BACKEND IMAGE COMPRESSION ENGINE
// Resizes to max 1280px and applies 80% JPEG compression
// ==========================================
const optimizeBase64Image = async (base64Str) => {
    try {
        // Extract the raw base64 payload from the Data URL
        const matches = base64Str.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) return base64Str; 

        const buffer = Buffer.from(matches[2], 'base64');

        // Process with Sharp: Resize and compress
        const compressedBuffer = await sharp(buffer)
            .resize({ 
                width: 1280, 
                height: 1280, 
                fit: 'inside', // Keeps aspect ratio, scales down if larger
                withoutEnlargement: true // Never scales up small images
            })
            .jpeg({ quality: 80, progressive: true }) // 80% quality is visually lossless but tiny file size
            .toBuffer();

        // Reconstruct the Base64 string for Cloudinary
        return `data:image/jpeg;base64,${compressedBuffer.toString('base64')}`;
    } catch (error) {
        console.error("[IMAGE_OPTIMIZATION_ERROR]", error.message);
        return base64Str; // Fallback to original payload if compression fails
    }
};

export const AnnouncementRouter = (router, supabase) => {

    // ==========================================
    // 1. GET ALL ANNOUNCEMENTS
    // ==========================================
    router.get('/announcements', async (req, res) => {
        try {
            const today = new Date().toISOString();
            const isAdmin = req.query.admin === 'true';

            let query = supabase
                .from('announcements')
                .select('*')
                .order('priority', { ascending: false }) 
                .order('created_at', { ascending: false });

            // Filter out expired and inactive for regular users
            if (!isAdmin) {
                query = query
                    .eq('status', 'Active')    
                    .gte('expires_at', today); 
            }

            const { data, error } = await query;

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
            
            // 🛡️ COMPRESSION INTERCEPT
            if (image_url && image_url.startsWith('data:image')) {
                console.log("Compressing and uploading new image to Cloudinary...");
                try {
                    const optimizedImage = await optimizeBase64Image(image_url);
                    secureImageUrl = await uploadImage(optimizedImage, 'barangay_announcements');
                } catch (uploadErr) {
                    console.error("Cloudinary Upload Failed:", uploadErr.message);
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
                    image_url: secureImageUrl,
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

            // 🛡️ COMPRESSION INTERCEPT FOR EDITS
            if (updates.image_url && updates.image_url.startsWith('data:image')) {
                console.log("Compressing and updating image on Cloudinary...");
                try {
                    const optimizedImage = await optimizeBase64Image(updates.image_url);
                    updates.image_url = await uploadImage(optimizedImage, 'barangay_announcements');
                } catch (uploadErr) {
                    console.error("Cloudinary Update Failed:", uploadErr.message);
                    delete updates.image_url; // Prevent saving a broken base64 string if upload fails
                }
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