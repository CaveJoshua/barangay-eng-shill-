// Auditlog.js

/**
 * Clean & Fast Audit Logger
 * Simply records who did what and when.
 */
export const logActivity = async (supabase, actor, action, details) => {
  try {
    const { error: insertError } = await supabase
      .from('audit_logs')
      .insert([{
        actor: actor || 'SYSTEM',
        action: action,
        details: details || 'No additional details provided.',
        timestamp: new Date().toISOString()
      }]);

    if (insertError) {
      console.error("FAILED to write to Audit Log:", insertError.message);
    } else {
      console.log(`[AUDIT] Action Logged: ${action} by ${actor}`);
    }

  } catch (err) {
    console.error("Audit System Error:", err.message);
  }
};

export const AuditlogRouter = (router, supabase, authenticateToken) => {
  
  // 1. GET ALL LOGS (Protected by Auth)
  router.get('/audit', authenticateToken, async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(200); // Added a limit to prevent loading thousands of logs at once

      if (error) throw error;
      res.json(data);
    } catch (err) {
      console.error("Fetch Audit Error:", err.message);
      res.status(500).json({ error: "Failed to retrieve system logs." });
    }
  });

  // 2. MANUAL TEST LOG (Optional)
  router.post('/audit/test', authenticateToken, async (req, res) => {
    try {
      const { actor, action, details } = req.body;
      await logActivity(supabase, actor, action, details);
      res.status(201).json({ message: "Action logged successfully." });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};