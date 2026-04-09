/**
 * Notification.js - DEDICATED TABLE ENGINE (FULL CRUD)
 * ────────────────────────────────────────────────────────
 * Connects directly to the public.notifications table.
 * Fully complete with Create, Read-All, and Clear-All capabilities.
 */

export const NotificationRouter = (router, supabase, authenticateToken) => {
    
    // =========================================================
    // 1. GET ALL NOTIFICATIONS (LIVE FEED)
    // =========================================================
    router.get('/alerts/live', authenticateToken, async (req, res) => {
        try {
            const fetchLimit = parseInt(req.query.limit) || 50;

            const { data, error } = await supabase
                .from('notifications')
                .select('*')
                // .eq('user_id', req.user.id) // Optional: filter by user
                .order('created_at', { ascending: false })
                .limit(fetchLimit);

            if (error) throw error;
            res.status(200).json(data);

        } catch (err) {
            console.error("[NOTIF DB ERROR]", err.message);
            res.status(500).json({ error: "Failed to fetch notifications." });
        }
    });

    // =========================================================
    // 2. GET UNREAD COUNT (FOR BADGES)
    // =========================================================
    router.get('/alerts/count', authenticateToken, async (req, res) => {
        try {
            const { count, error } = await supabase
                .from('notifications')
                .select('*', { count: 'exact', head: true })
                .eq('is_read', false);
                // .eq('user_id', req.user.id); 

            if (error) throw error;
            res.status(200).json({ total: count || 0 });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // =========================================================
    // 3. CREATE NEW NOTIFICATION (SYSTEM OR ADMIN)
    // =========================================================
    router.post('/alerts/create', authenticateToken, async (req, res) => {
        try {
            const { user_id, title, message, type } = req.body;
            
            if (!title || !message) {
                return res.status(400).json({ error: "Title and message are required" });
            }

            const { data, error } = await supabase
                .from('notifications')
                .insert([{ 
                    user_id: user_id || 'system', 
                    title, 
                    message, 
                    type: type || 'system', 
                    is_read: false 
                }])
                .select();

            if (error) throw error;
            res.status(201).json({ success: true, data });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // =========================================================
    // 4. MARK SINGLE AS READ
    // =========================================================
    router.put('/alerts/read/:id', authenticateToken, async (req, res) => {
        try {
            const { error } = await supabase
                .from('notifications')
                .update({ is_read: true })
                .eq('id', req.params.id);

            if (error) throw error;
            res.status(200).json({ success: true, message: "Marked as read" });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // =========================================================
    // 5. MARK ALL AS READ (BATCH OPTIMIZATION)
    // =========================================================
    router.put('/alerts/read-all', authenticateToken, async (req, res) => {
        try {
            const { error } = await supabase
                .from('notifications')
                .update({ is_read: true })
                .eq('is_read', false);
                // .eq('user_id', req.user.id); // Secure to specific user

            if (error) throw error;
            res.status(200).json({ success: true, message: "All marked as read" });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // =========================================================
    // 6. PERMANENT CLEAR SINGLE (DELETE)
    // =========================================================
    router.delete('/alerts/clear/:id', authenticateToken, async (req, res) => {
        try {
            const { error } = await supabase
                .from('notifications')
                .delete()
                .eq('id', req.params.id);

            if (error) throw error;
            res.status(200).json({ success: true, message: "Permanently deleted from database" });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // =========================================================
    // 7. PERMANENT CLEAR ALL (WIPE HISTORY)
    // =========================================================
    router.delete('/alerts/clear-all', authenticateToken, async (req, res) => {
        try {
            const { error } = await supabase
                .from('notifications')
                .delete()
                .neq('id', 0); // Failsafe to target all rows
                // .eq('user_id', req.user.id);

            if (error) throw error;
            res.status(200).json({ success: true, message: "Notification history wiped" });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
};