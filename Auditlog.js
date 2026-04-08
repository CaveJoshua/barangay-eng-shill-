// Auditlog.js

/**
 * 🛡️ Enterprise Audit Logger
 * Designed to be imported and used anywhere in the backend to record system events.
 */
export const logActivity = async (supabase, actor, action, details) => {
  try {
    // Safely format details: If it's a JSON object (like our login metadata), stringify it.
    let formattedDetails = details;
    if (typeof details === 'object' && details !== null) {
      formattedDetails = JSON.stringify(details);
    } else if (!details) {
      formattedDetails = 'No additional details provided.';
    }

    const { error: insertError } = await supabase
      .from('audit_logs')
      .insert([{
        actor: actor || 'SYSTEM',
        action: action,
        details: formattedDetails
        // Note: Removed manual timestamp. Let PostgreSQL's 'default now()' handle it for absolute accuracy.
      }]);

    if (insertError) {
      console.error("❌ [AUDIT FAILED]:", insertError.message);
    } else {
      console.log(`✅ [AUDIT LOGGED]: ${action} by ${actor || 'SYSTEM'}`);
    }

  } catch (err) {
    console.error("❌ [AUDIT SYSTEM ERROR]:", err.message);
  }
};

export const AuditlogRouter = (router, supabase, authenticateToken) => {
  
  // 1. GET ALL LOGS (Protected by Auth & Upgraded with Query Filters)
  router.get('/audit', authenticateToken, async (req, res) => {
    try {
      // Allow the frontend dashboard to paginate and search
      const limit = parseInt(req.query.limit) || 100;
      const actionFilter = req.query.action;
      const actorFilter = req.query.actor;

      // Build the Supabase query dynamically
      let query = supabase
        .from('audit_logs')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(limit);

      // Apply optional filters if the frontend sent them
      if (actionFilter) query = query.eq('action', actionFilter);
      if (actorFilter) query = query.eq('actor', actorFilter);

      const { data, error } = await query;

      if (error) throw error;
      res.json(data);

    } catch (err) {
      console.error("Fetch Audit Error:", err.message);
      res.status(500).json({ error: "Failed to retrieve system logs." });
    }
  });

  // 2. MANUAL TEST LOG (Kept for testing, but requires Auth)
  router.post('/audit/test', authenticateToken, async (req, res) => {
    try {
      const { actor, action, details } = req.body;
      
      if (!action) {
        return res.status(400).json({ error: "Action is required to log an event." });
      }

      await logActivity(supabase, actor, action, details);
      res.status(201).json({ message: "Action logged successfully." });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};