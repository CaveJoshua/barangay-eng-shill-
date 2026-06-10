// Auditlog.js

// =========================================================
// 🖥️ DEVICE / CLIENT FINGERPRINT (J-CVE-101203)
// Derives a human-readable device label from the User-Agent so the
// audit trail can show "what device was used" — no DB column needed.
// =========================================================
const parseDevice = (ua = '') => {
  const s = String(ua).toLowerCase();
  if (!s || s === 'unknown') return null;

  let os = 'Unknown OS';
  if (s.includes('windows')) os = 'Windows';
  else if (s.includes('android')) os = 'Android';
  else if (s.includes('iphone') || s.includes('ipad') || s.includes('ios ')) os = 'iOS';
  else if (s.includes('mac os') || s.includes('macintosh')) os = 'macOS';
  else if (s.includes('linux')) os = 'Linux';

  let browser = 'Unknown Browser';
  if (s.includes('edg/') || s.includes('edge')) browser = 'Edge';
  else if (s.includes('opr/') || s.includes('opera')) browser = 'Opera';
  else if (s.includes('chrome')) browser = 'Chrome';
  else if (s.includes('firefox')) browser = 'Firefox';
  else if (s.includes('safari')) browser = 'Safari';

  const type = /mobile|android|iphone|ipad/.test(s) ? 'Mobile' : 'Desktop';
  return `${browser} · ${os} · ${type}`;
};

// Pulls IP + device from an Express request (when one is supplied).
const extractClientMeta = (req) => {
  if (!req) return { ip: null, device: null, user_agent: null };
  const fwd = req.headers?.['x-forwarded-for'];
  const ip = (typeof fwd === 'string' ? fwd.split(',')[0].trim() : null)
    || req.socket?.remoteAddress || req.ip || 'unknown';
  const ua = req.headers?.['user-agent'] || 'unknown';
  return { ip, device: parseDevice(ua), user_agent: ua };
};

/**
 * 🛡️ Enterprise Audit Logger
 * @param req  Optional Express request — pass it to capture device/IP.
 *
 * The `details` column now stores a structured JSON envelope:
 *   { message, ip, device, user_agent }
 * Older plain-string rows remain readable; the UI handles both.
 */
export const logActivity = async (supabase, actor, action, details, req = null) => {
  try {
    // Original human-readable detail (objects get stringified, like login metadata).
    let message = details;
    if (typeof details === 'object' && details !== null) {
      message = JSON.stringify(details);
    } else if (!details) {
      message = 'No additional details provided.';
    }

    const { ip, device, user_agent } = extractClientMeta(req);

    // Structured envelope stored in the existing text column — zero schema change.
    const envelope = JSON.stringify({ message, ip, device, user_agent });

    const { error: insertError } = await supabase
      .from('audit_logs')
      .insert([{
        actor: actor || 'SYSTEM',
        action: action,
        details: envelope
        // Timestamp left to PostgreSQL's default now() for absolute accuracy.
      }]);

    if (insertError) {
      console.error("❌ [AUDIT FAILED]:", insertError.message);
    } else {
      console.log(`✅ [AUDIT LOGGED]: ${action} by ${actor || 'SYSTEM'} [${device || 'no-device'}]`);
    }

  } catch (err) {
    console.error("❌ [AUDIT SYSTEM ERROR]:", err.message);
  }
};

export const AuditlogRouter = (router, supabase, authenticateToken) => {
  
  const authorizeAdminOnly = (req, res, next) => {
    const role = (req.user?.user_role || req.user?.role || '').toLowerCase().trim();
    if (!['admin', 'superadmin'].includes(role)) {
      return res.status(403).json({ error: 'Forbidden', message: 'Audit logs are restricted to administrators.' });
    }
    next();
  };

  // 1. GET ALL LOGS (Restricted: admin and superadmin only)
  router.get('/audit', authenticateToken, authorizeAdminOnly, async (req, res) => {
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

  // 2. MANUAL TEST LOG (Restricted: superadmin only)
  router.post('/audit/test', authenticateToken, authorizeAdminOnly, async (req, res) => {
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