/**
 * Notification.js - THE RECTO ENGINE (V5.4 - HISTORY & ADBLOCK FIX)
 * ────────────────────────────────────────────────────────
 * Logic: Pulls live data directly from 'document_requests' 
 * and 'blotter_cases'. This bypasses the need for a separate 
 * notifications table, guaranteeing 100% reliability.
 */

export const NotificationRouter = (router, supabase, authenticateToken) => {
    
    // =========================================================
    // 1. THE HANDSHAKE MARKER
    // =========================================================
    // CHANGED to /alerts/ to bypass Brave Browser/AdBlockers
    router.get('/alerts/latest-marker', authenticateToken, async (req, res) => {
        try {
            // Get the single most recent Document ID
            const { data: doc } = await supabase
                .from('document_requests')
                .select('id')
                .order('id', { ascending: false })
                .limit(1)
                .single();

            // Get the single most recent Blotter ID
            const { data: blt } = await supabase
                .from('blotter_cases')
                .select('id')
                .order('id', { ascending: false })
                .limit(1)
                .single();

            res.status(200).json({
                latestDocId: doc?.id || 0,
                latestBltId: blt?.id || 0,
                serverTime: new Date().toISOString()
            });
        } catch (err) {
            res.status(200).json({ latestDocId: 0, latestBltId: 0 });
        }
    });

    // =========================================================
    // 2. THE LIVE FEED (UNIFIED & HISTORY ENABLED)
    // =========================================================
    // CHANGED to /alerts/live
    router.get('/alerts/live', authenticateToken, async (req, res) => {
        try {
            // A. Fetch Documents (REMOVED 'Pending' filter, INCREASED limit to 30 for History tab)
            const { data: docs, error: e1 } = await supabase
                .from('document_requests')
                .select('id, resident_name, type, date_requested, status')
                .order('date_requested', { ascending: false })
                .limit(30);

            if (e1) throw e1;

            // B. Fetch Blotters (REMOVED 'Pending' filter, INCREASED limit to 30 for History tab)
            const { data: blts, error: e2 } = await supabase
                .from('blotter_cases')
                .select('id, complainant_name, incident_type, created_at, status')
                .order('created_at', { ascending: false })
                .limit(30);

            // C. Format and Merge into a single array
            const feed = [
                // Map Document Requests
                ...(docs || []).map(d => ({
                    id: `doc-${d.id}`, 
                    originalId: d.id,
                    title: 'New Document Request',
                    message: `${d.resident_name} filed for ${d.type}`,
                    timestamp: d.date_requested,
                    type: 'document',
                    status: d.status // Added status so frontend can style it
                })),
                
                // Map Blotter Cases
                ...(blts || []).map(b => ({
                    id: `blt-${b.id}`, 
                    originalId: b.id,
                    title: 'New Blotter Report',
                    message: `Incident: ${b.incident_type} reported by ${b.complainant_name}`,
                    timestamp: b.created_at,
                    type: 'blotter',
                    status: b.status // Added status so frontend can style it
                }))
            ];

            // D. Sort combined feed by timestamp (Newest on top)
            const sortedFeed = feed.sort((a, b) => 
                new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
            );

            res.status(200).json(sortedFeed);
        } catch (err) {
            console.error("[RECTO ENGINE ERROR]", err.message);
            res.status(500).json({ error: "Failed to fetch unified feed." });
        }
    });

    // =========================================================
    // 3. THE BADGE COUNT
    // =========================================================
    // CHANGED to /alerts/count
    router.get('/alerts/count', authenticateToken, async (req, res) => {
        try {
            // Count ONLY pending documents for the red badge
            const { count: c1 } = await supabase
                .from('document_requests')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'Pending');

            // Count ONLY pending blotter cases for the red badge
            const { count: c2 } = await supabase
                .from('blotter_cases')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'Pending');

            // Return the sum
            res.status(200).json({ 
                total: (c1 || 0) + (c2 || 0) 
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
};