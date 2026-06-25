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
            const fetchLimit = Math.min(parseInt(req.query.limit) || 50, 100);

            let query = supabase.from('notifications').select('*');

            if (userRole === 'resident') {
                // Residents ONLY see notifications addressed to them or 'system'
                query = query.or(`user_id.eq.${authId},user_id.eq.system,user_id.is.null`);
            } else {
                // 🛠️ Admins/Staff see notifications addressed to THEM (notifyAllAdmins writes a
                // per-admin copy) plus system/broadcast — NOT residents' personal alerts, which
                // previously surfaced a second, duplicate notification per request.
                // Walk-in messages stay hidden so staff aren't pinged for their own entries.
                query = query
                    .or(`user_id.eq.${authId},user_id.eq.system,user_id.is.null`)
                    .not('message', 'ilike', '%(Walk-in)%');
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
                // Scope to the admin's own + system so the badge doesn't count residents' alerts.
                query = query
                    .or(`user_id.eq.${authId},user_id.eq.system,user_id.is.null`)
                    .not('message', 'ilike', '%(Walk-in)%');
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
    // 2.5 LATEST MARKER (lightweight poll — "is anything new?")
    // Returns only the newest notification's id + timestamp (role-scoped)
    // so the client can detect changes without pulling the whole feed.
    // Wires up ApiService.getNotificationMarker(). (J-CVE-101203)
    // =========================================================
    router.get('/alerts/latest-marker', authenticateToken, async (req, res) => {
        try {
            const userRole = (req.user?.user_role || req.user?.role || 'resident').toLowerCase().trim();
            const authId = getAuthId(req.user);

            let query = supabase
                .from('notifications')
                .select('id, created_at')
                .order('created_at', { ascending: false })
                .limit(1);

            if (userRole === 'resident') {
                query = query.or(`user_id.eq.${authId},user_id.eq.system,user_id.is.null`);
            } else {
                query = query
                    .or(`user_id.eq.${authId},user_id.eq.system,user_id.is.null`)
                    .not('message', 'ilike', '%(Walk-in)%');
            }

            const { data, error } = await query.maybeSingle();
            if (error) throw error;

            res.status(200).json({
                marker: data?.created_at || null,
                latest_id: data?.id || null,
            });
        } catch (err) {
            console.error("[NOTIF_MARKER_ERROR]:", err.message);
            res.status(500).json({ error: "Failed to fetch notification marker." });
        }
    });

    // =========================================================
    // 3. CREATE NEW NOTIFICATION
    // =========================================================
    router.post('/alerts/create', authenticateToken, async (req, res) => {
        try {
            const userRole = (req.user?.user_role || req.user?.role || 'resident').toLowerCase().trim();
            const isAdmin = ['admin', 'superadmin', 'staff', 'barangayhall'].includes(userRole);
            if (!isAdmin) return res.status(403).json({ error: 'Forbidden. Only staff can create notifications.' });

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
    // 4. MARK SINGLE AS READ (ownership enforced)
    // =========================================================
    router.put('/alerts/read/:id', authenticateToken, async (req, res) => {
        try {
            const authId = String(getAuthId(req.user));
            const userRole = (req.user?.user_role || req.user?.role || 'resident').toLowerCase().trim();

            // Fetch the notification first to verify ownership
            const { data: notif, error: fetchErr } = await supabase
                .from('notifications')
                .select('id, user_id')
                .eq('id', req.params.id)
                .maybeSingle();

            if (fetchErr || !notif) return res.status(404).json({ error: 'Notification not found.' });

            const isAdmin = ['admin', 'superadmin', 'staff', 'barangayhall'].includes(userRole);
            const isOwner = String(notif.user_id) === authId || notif.user_id === 'system';

            if (!isAdmin && !isOwner) {
                return res.status(403).json({ error: 'Forbidden. You cannot modify this notification.' });
            }

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
                // Mark only the admin's own + system alerts read — never touch residents' rows.
                query = query
                    .or(`user_id.eq.${authId},user_id.eq.system,user_id.is.null`)
                    .not('message', 'ilike', '%(Walk-in)%');
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
    // 6. PERMANENT CLEAR SINGLE (DELETE - ownership enforced)
    // =========================================================
    router.delete('/alerts/clear/:id', authenticateToken, async (req, res) => {
        try {
            const authId = String(getAuthId(req.user));
            const userRole = (req.user?.user_role || req.user?.role || 'resident').toLowerCase().trim();

            const { data: notif, error: fetchErr } = await supabase
                .from('notifications')
                .select('id, user_id')
                .eq('id', req.params.id)
                .maybeSingle();

            if (fetchErr || !notif) return res.status(404).json({ error: 'Notification not found.' });

            const isAdmin = ['admin', 'superadmin', 'staff', 'barangayhall'].includes(userRole);
            const isOwner = String(notif.user_id) === authId || notif.user_id === 'system';

            if (!isAdmin && !isOwner) {
                return res.status(403).json({ error: 'Forbidden. You cannot delete this notification.' });
            }

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
                // 🛡️ Delete only the admin's own + system alerts. Previously this wiped EVERY
                // non-walk-in notification — including residents' personal ones (data loss).
                query = query
                    .or(`user_id.eq.${authId},user_id.eq.system,user_id.is.null`)
                    .not('message', 'ilike', '%(Walk-in)%');
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
