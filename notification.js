/**
 * Notification.js - DEDICATED TABLE ENGINE (FULL CRUD)
 * ────────────────────────────────────────────────────────
 */

export const NotificationRouter = (router, supabase, authenticateToken) => {

    // Helper to get the correct ID from the token
    const getAuthId = (user) => user?.record_id || user?.resident_id || user?.account_id || user?.sub;

    // =========================================================
    // 1. GET ALL NOTIFICATIONS (LIVE FEED)
    // =========================================================
    router.get('/alerts/live', authenticateToken, async (req, res) => {
        try {
            const userRole = (req.user?.user_role || req.user?.role || 'resident').toLowerCase().trim();
            const authId = getAuthId(req.user);
            const fetchLimit = parseInt(req.query.limit) || 50;

            let query = supabase.from('notifications').select('*');

            if (userRole === 'resident') {
                // Residents ONLY see notifications addressed to them or 'system'
                query = query.or(`user_id.eq.${authId},user_id.eq.system,user_id.is.null`);
            } else {
                // 📡 THE ONLINE SENSOR: Admins/Staff only see ONLINE requests.
                // This automatically hides any message tagged with "(Walk-in)" so 
                // staff aren't notified about documents they just created themselves.
                query = query.not('message', 'ilike', '%(Walk-in)%');
            }

            const { data, error } = await query
                .order('created_at', { ascending: false })
                .limit(fetchLimit);

            if (error) throw error;
            res.status(200).json(data);

        } catch (err) {
            console.error("[NOTIF_FETCH_ERROR]:", err.message);
            res.status(500).json({ error: "Failed to fetch notifications." });
        }
    });

    // =========================================================
    // 2. GET UNREAD COUNT (FOR BADGES)
    // =========================================================
    router.get('/alerts/count', authenticateToken, async (req, res) => {
        try {
            const authId = getAuthId(req.user);
            const userRole = (req.user?.user_role || req.user?.role || 'resident').toLowerCase().trim();

            let query = supabase
                .from('notifications')
                .select('*', { count: 'exact', head: true })
                .eq('is_read', false);

            if (userRole === 'resident') {
                query = query.or(`user_id.eq.${authId},user_id.eq.system`);
            } else {
                // 📡 THE ONLINE SENSOR: Prevent Walk-ins from triggering the Red Badge counter
                query = query.not('message', 'ilike', '%(Walk-in)%');
            }

            const { count, error } = await query;

            if (error) throw error;
            res.status(200).json({ total: count || 0 });
        } catch (err) {
            console.error("[NOTIF_COUNT_ERROR]:", err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // =========================================================
    // 3. CREATE NEW NOTIFICATION
    // =========================================================
    router.post('/alerts/create', authenticateToken, async (req, res) => {
        try {
            const { user_id, title, message, type } = req.body;
            
            if (!title || !message) {
                return res.status(400).json({ error: "Title and message are required" });
            }

            const finalUserId = user_id ? String(user_id) : 'system';

            const { data, error } = await supabase
                .from('notifications')
                .insert([{ 
                    user_id: finalUserId, 
                    title, 
                    message, 
                    type: type || 'system', 
                    is_read: false,
                    created_at: new Date().toISOString()
                }])
                .select();

            if (error) throw error;
            res.status(201).json({ success: true, data });
        } catch (err) {
            console.error("[NOTIF_CREATE_ERROR]:", err.message);
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
            console.error("[NOTIF_UPDATE_ERROR]:", err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // =========================================================
    // 5. MARK ALL AS READ (USER-SPECIFIC)
    // =========================================================
    router.put('/alerts/read-all', authenticateToken, async (req, res) => {
        try {
            const authId = getAuthId(req.user);
            const userRole = (req.user?.user_role || req.user?.role || 'resident').toLowerCase().trim();

            let query = supabase.from('notifications').update({ is_read: true }).eq('is_read', false);

            if (userRole === 'resident') {
                query = query.eq('user_id', String(authId)); // Residents only mark their own
            } else {
                query = query.not('message', 'ilike', '%(Walk-in)%'); // Admins mark all online as read
            }

            const { error } = await query;

            if (error) throw error;
            res.status(200).json({ success: true, message: "All marked as read" });
        } catch (err) {
            console.error("[NOTIF_READ_ALL_ERROR]:", err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // =========================================================
    // 6. PERMANENT CLEAR SINGLE (DELETE - FOR TRASH CAN ICON)
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
            console.error("[NOTIF_DELETE_SINGLE_ERROR]:", err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // =========================================================
    // 7. PERMANENT CLEAR ALL (WIPE HISTORY)
    // =========================================================
    router.delete('/alerts/clear-all', authenticateToken, async (req, res) => {
        try {
            const authId = getAuthId(req.user);
            const userRole = (req.user?.user_role || req.user?.role || 'resident').toLowerCase().trim();

            let query = supabase.from('notifications').delete();

            if (userRole === 'resident') {
                query = query.eq('user_id', String(authId));
            } else {
                query = query.neq('id', 0); // Admins wipe the entire board
            }

            const { error } = await query;

            if (error) throw error;
            res.status(200).json({ success: true, message: "Notification history wiped" });
        } catch (err) {
            console.error("[NOTIF_CLEAR_ALL_ERROR]:", err.message);
            res.status(500).json({ error: err.message });
        }
    });
};