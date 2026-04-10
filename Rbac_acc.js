import { logActivity } from './Auditlog.js';

/**
 * RBAC MIDDLEWARE (GOD-MODE READY)
 * Absolute role validation that prioritizes Superadmin clearance.
 */
export const checkRole = (allowedRoles) => {
  return async (req, res, next) => {
    try {
      // 🛡️ Look for the role in all possible JWT payload locations
      const actualRole = req.user?.user_role || req.user?.role || req.user?.profile?.role;

      if (!req.user || !actualRole) {
        return res.status(401).json({ 
          error: 'Unauthorized', 
          message: 'Security token is valid, but your role identity is missing.' 
        });
      }

      // 🛡️ Normalization: Lowercase and strip all whitespace
      const rawRole = String(actualRole).toLowerCase().trim();
      
      let normalizedRole = 'resident'; // Default to lowest privilege
      if (rawRole === 'superadmin' || rawRole.includes('super')) {
        normalizedRole = 'superadmin';
      } else if (rawRole === 'admin' || rawRole === 'staff') {
        normalizedRole = rawRole; 
      }

      // 🛡️ The Gatekeeper: Check if normalized role exists in the allowed list
      if (!allowedRoles.includes(normalizedRole)) {
        console.warn(`[RBAC BLOCK] User ${req.user.username} (Role: ${rawRole}) attempted to access restricted route.`);
        return res.status(403).json({ 
          error: 'Forbidden', 
          message: `Access Denied. Required roles: [${allowedRoles.join(', ')}]. Your detected role: ${normalizedRole}` 
        });
      }

      // Pass the normalized role down to the route
      req.validatedRole = normalizedRole;
      next();
    } catch (error) {
      console.error("[RBAC CRITICAL ERROR]:", error.message);
      res.status(500).json({ error: 'Internal security engine failure.' });
    }
  };
};

/**
 * RBAC ROUTER MODULE
 */
export const RbacRouter = (router, supabase, authenticateToken) => {
  
  // ==========================================
  // 1. GET ALL ACCOUNTS (Audited View)
  // ==========================================
  router.get('/rbac/accounts', authenticateToken, checkRole(['admin', 'superadmin']), async (req, res) => {
    try {
      const [resAcc, offAcc] = await Promise.all([
        supabase
            .from('residents_account')
            .select(`
                account_id, username, role, status, created_at,
                residents_records (first_name, last_name)
            `)
            .order('created_at', { ascending: false }),
        supabase
            .from('officials_accounts')
            .select(`
                account_id, username, role, status, created_at,
                officials (full_name)
            `)
            .order('created_at', { ascending: false })
      ]);

      if (resAcc.error) throw resAcc.error;
      if (offAcc.error) throw offAcc.error;

      // Safe fallbacks to prevent .map() from crashing if a table is empty
      const safeResData = resAcc.data || [];
      const safeOffData = offAcc.data || [];

      const combinedAccounts = [
        ...safeResData.map(acc => {
            const rec = Array.isArray(acc.residents_records) ? acc.residents_records[0] : acc.residents_records;
            return { 
                id: acc.account_id,
                username: acc.username,
                role: acc.role || 'resident',
                status: acc.status || 'Active', 
                created_at: acc.created_at,
                source: 'resident', 
                profileName: rec ? `${rec.last_name}, ${rec.first_name}` : 'Unknown Resident'
            };
        }),
        ...safeOffData.map(acc => {
            const rec = Array.isArray(acc.officials) ? acc.officials[0] : acc.officials;
            return { 
                id: acc.account_id,
                username: acc.username,
                role: acc.role || 'staff',
                status: acc.status || 'Active',
                created_at: acc.created_at,
                source: 'official',
                profileName: rec?.full_name || 'System Administrator'
            };
        })
      ];

      res.status(200).json(combinedAccounts);
    } catch (err) {
      console.error("RBAC Fetch Error:", err.message);
      res.status(500).json({ error: "Failed to securely fetch accounts." });
    }
  });

  // ==========================================
  // 2. UPDATE ACCOUNT ROLE (Superadmin ONLY)
  // ==========================================
  router.patch('/rbac/accounts/:id/role', authenticateToken, checkRole(['superadmin']), async (req, res) => {
    try {
      const { id } = req.params; 
      const { newRole, source } = req.body; 

      // 🛡️ ROOT PROTECTION: Prevent anyone from trying to demote the ghost root account
      if (id === 'SYSTEM-ROOT-0000') {
          return res.status(403).json({ error: 'The Root System Administrator account cannot be modified.' });
      }

      const validRoles = ['resident', 'staff', 'admin', 'superadmin'];
      if (!validRoles.includes(newRole)) {
        return res.status(400).json({ error: 'Invalid role assignment.' });
      }

      const targetTable = source === 'official' ? 'officials_accounts' : 'residents_account';

      const { data, error } = await supabase
        .from(targetTable)
        .update({ role: newRole })
        .eq('account_id', id)
        .select();

      if (error) throw error;
      
      if (!data || data.length === 0) {
        return res.status(404).json({ error: `Account not found.` });
      }

      // Log the escalation
      logActivity(
          supabase, 
          req.user?.username || 'System', 
          'PRIVILEGE_MODIFIED', 
          `Changed role of ${data[0].username} to ${newRole.toUpperCase()}.`
      ).catch(err => console.error("Audit Failure:", err.message));

      res.status(200).json({ message: 'Role updated successfully.', account: data[0] });

    } catch (err) {
        console.error("Role Update Error:", err.message);
        res.status(500).json({ error: 'Failed to update account role.' });
    }
  });
};