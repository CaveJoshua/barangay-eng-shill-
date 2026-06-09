// ── THEME MANAGER ─────────────────────────────────────────────────────────────
// Single source of truth for all theme operations.
// Admin portal  → data-theme           + sb_theme_${userId}
// Resident portal → data-resident-theme + theme_${recordId}

export type ThemeValue = 'light' | 'dark';

const adminKey    = (uid: string) => `sb_theme_${uid}`;
const residentKey = (rid: string) => `theme_${rid}`;

export const ThemeManager = {

  applyAdmin(theme: ThemeValue): void {
    document.documentElement.setAttribute('data-theme', theme);
  },

  applyResident(theme: ThemeValue): void {
    document.documentElement.setAttribute('data-resident-theme', theme);
  },

  // Resets both attributes to light — called on logout.
  resetAll(): void {
    document.documentElement.setAttribute('data-theme', 'light');
    document.documentElement.setAttribute('data-resident-theme', 'light');
  },

  loadAdmin(userId: string): ThemeValue {
    return (localStorage.getItem(adminKey(userId)) as ThemeValue) || 'light';
  },

  loadResident(recordId: string): ThemeValue {
    return (localStorage.getItem(residentKey(recordId)) as ThemeValue) || 'light';
  },

  saveAdmin(userId: string, theme: ThemeValue): void {
    localStorage.setItem(adminKey(userId), theme);
    this.applyAdmin(theme);
  },

  saveResident(recordId: string, theme: ThemeValue): void {
    localStorage.setItem(residentKey(recordId), theme);
    this.applyResident(theme);
  },

  // Called on app start and on session restore.
  // Reads the correct per-user key and applies it immediately.
  restoreFromSession(): void {
    // Ensure both attributes always exist in the DOM.
    if (!document.documentElement.hasAttribute('data-theme')) {
      document.documentElement.setAttribute('data-theme', 'light');
    }
    if (!document.documentElement.hasAttribute('data-resident-theme')) {
      document.documentElement.setAttribute('data-resident-theme', 'light');
    }

    const adminRaw = localStorage.getItem('admin_session');
    if (adminRaw) {
      try {
        const s = JSON.parse(adminRaw);
        const uid = s.account_id || s.id;
        if (uid) { this.applyAdmin(this.loadAdmin(String(uid))); return; }
      } catch {}
    }

    const residentRaw = localStorage.getItem('resident_session');
    if (residentRaw) {
      try {
        const s = JSON.parse(residentRaw);
        const rid = s.profile?.record_id || s.record_id;
        if (rid) { this.applyResident(this.loadResident(String(rid))); }
      } catch {}
    }
  },
};
