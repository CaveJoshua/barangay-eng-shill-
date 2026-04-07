import { authenticateToken } from './data.js';
import { logActivity } from './Auditlog.js'; // <-- NEW: Required for Zero Trust Tracking

/**
 * RBAC MIDDLEWARE (UPGRADED)
 * Smart role checking that handles capitalization and variations
 */
export const checkRole = (allowedRoles) => {
  return async (req, res, next) => {
    try {
      const actualRole = req.user?.user_role || req.user?.role;

      if (!req.user || !actualRole) {
        return res.status(401).json({ 
          error: 'Unauthorized', 
          message: 'Access denied. Role information missing from security token.' 
        });
      }

      const rawRole = actualRole.toLowerCase().trim();
      
      let normalizedRole = rawRole;
      if (rawRole.includes('super')) normalizedRole = 'superadmin';
      else if (rawRole.includes('admin')) normalizedRole = 'admin';
      else if (rawRole.includes('staff')) normalizedRole = 'staff';
      else normalizedRole = 'resident';

      if (!allowedRoles.includes(normalizedRole)) {
        return res.status(403).json({ 
          error: 'Forbidden', 
          message: `Your role (${actualRole}) does not have permission to perform this action.` 
        });
      }

      next();
    } catch (error) {
      res.status(500).json({ error: 'Internal server error during role validation.' });
    }
  };
};

/**
 * RBAC ROUTER MODULE
 */
export const RbacRouter = (router, supabase) => {
  
  // ==========================================
  // 1. GET ALL ACCOUNTS (Zero Trust / Memory Safe View)
  // ==========================================
  router.get('/rbac/accounts', authenticateToken, checkRole(['admin', 'superadmin']), async (req, res) => {
    try {
      // THE FIX: We use Supabase Joins to let the Database do the heavy lifting.
      // This prevents the server from downloading thousands of unneeded records.
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

      // Map them smoothly without massive Memory Maps
      const combinedAccounts = [
        ...resAcc.data.map(acc => {
            // Safely extract name, handling arrays or single objects depending on your Supabase relationship setup
            const rec = Array.isArray(acc.residents_records) ? acc.residents_records[0] : acc.residents_records;
            return { 
                id: acc.account_id,
                username: acc.username,
                role: acc.role,
                status: acc.status || 'Active', 
                created_at: acc.created_at,
                source: 'resident', 
                profileName: rec ? `${rec.last_name}, ${rec.first_name}` : 'Unknown Resident'
            };
        }),
        ...offAcc.data.map(acc => {
            const rec = Array.isArray(acc.officials) ? acc.officials[0] : acc.officials;
            return { 
                id: acc.account_id,
                username: acc.username,
                role: acc.role,
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
  // 2. UPDATE ACCOUNT ROLE (DYNAMIC + AUDITED)
  // ==========================================
  router.patch('/rbac/accounts/:id/role', authenticateToken, checkRole(['superadmin']), async (req, res) => {
    try {
      const { id } = req.params; 
      const { newRole, source } = req.body; 

      const validRoles = ['resident', 'staff', 'admin', 'superadmin'];
      if (!validRoles.includes(newRole)) {
        return res.status(400).json({ error: 'Invalid role assignment.' });
      }

      if (!source || !['resident', 'official'].includes(source)) {
        return res.status(400).json({ error: 'Account source (resident/official) is required.' });
      }

      const targetTable = source === 'official' ? 'officials_accounts' : 'residents_account';

      // 1. Update the Role
      const { data, error } = await supabase
        .from(targetTable)
        .update({ role: newRole })
        .eq('account_id', id)
        .select();

      if (error) throw error;
      
      if (!data || data.length === 0) {
        return res.status(404).json({ error: `Account not found in ${source} records.` });
      }

      // 2. ZERO TRUST: Log the Privilege Escalation
      const adminName = req.user?.username || 'System';
      logActivity(
          supabase, 
          adminName, 
          'PRIVILEGE_MODIFIED', 
          `Changed role of account [${data[0].username}] to ${newRole.toUpperCase()}.`
      ).catch(err => console.error("Audit Log Failed:", err.message));

      res.status(200).json({ 
        message: 'Role updated successfully.', 
        account: data[0]
      });

    } catch (err) {
      console.error("RBAC Update Error:", err.message);
      res.status(400).json({ error: err.message });
    }
  });

  // ==========================================
  // 3. ACCOUNT SEARCH
  // ==========================================
  router.get('/rbac/accounts/search', authenticateToken, checkRole(['admin', 'superadmin']), async (req, res) => {
    const { query } = req.query;
    if (!query) return res.status(400).json({ error: 'Search query required.' });

    try {
      const searchStr = `%${query}%`;

      // Parallel search across both account types
      const [{ data: residents, error: resErr }, { data: officials, error: offErr }] = await Promise.all([
        supabase
          .from('residents_account')
          .select('account_id, username, role, status, residents_records!inner(first_name, last_name)')
          .or(`first_name.ilike.${searchStr},last_name.ilike.${searchStr}`, { foreignTable: 'residents_records' }),
        supabase
          .from('officials_accounts')
          .select('account_id, username, role, status, officials!inner(full_name)')
          .ilike('officials.full_name', searchStr)
      ]);

      if (resErr || offErr) throw (resErr || offErr);

      res.status(200).json({
        residents: residents.map(r => ({ ...r, id: r.account_id, source: 'resident' })),
        officials: officials.map(o => ({ ...o, id: o.account_id, source: 'official' }))
      });
    } catch (err) {
      console.error("RBAC Search Error:", err.message);
      res.status(500).json({ error: "Failed to process search query." });
    }
  });
};