// ── ENVIRONMENT ────────────────────────────────────────────────────────────────
export const PRIMARY_API_URL  = (import.meta.env.VITE_API_BASE_URL       ?? '').replace(/\/$/, '');
export const CLOUD_API_URL    = (import.meta.env.VITE_API_BASE_URL_CLOUD ?? '').replace(/\/$/, '');
export const API_BASE_URL     = PRIMARY_API_URL;

// ── TIMING CONSTANTS ───────────────────────────────────────────────────────────
const REQUEST_TIMEOUT_MS   = 15_000;  // Hard limit per fetch call
const REFRESH_TIMEOUT_MS   = 10_000;  // Refresh endpoint must respond within this
const FAILOVER_RECOVERY_MS = 60_000;  // Try primary again after this interval

const failover = {
  active:        false,
  recoveryTimer: null as ReturnType<typeof setTimeout> | null,

  activate(): void {
    if (this.active) return; // Already active — don't restart the timer
    this.active = true;
    console.warn('[FAIL-SAFE] Primary server unreachable — routing to cloud.');

    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = setTimeout(() => {
      console.info('[FAIL-SAFE] Recovery window elapsed — reinstating primary.');
      this.active        = false;
      this.recoveryTimer = null;
    }, FAILOVER_RECOVERY_MS);
  },

  resolve(url: string): string {
    if (this.active && CLOUD_API_URL) {
      return url.replace(PRIMARY_API_URL, CLOUD_API_URL);
    }
    return url;
  },
};

// ── ENDPOINT REGISTRY ──────────────────────────────────────────────────────────
export const LOGIN_API            = `${API_BASE_URL}/admin/login`;
export const REFRESH_API          = `${API_BASE_URL}/auth/refresh`;
export const ACCOUNTS_API         = `${API_BASE_URL}/rbac/accounts`;
export const PROFILE_API          = `${API_BASE_URL}/officials/profile`;

export const RESIDENTS_API        = `${API_BASE_URL}/residents`;
export const HOUSEHOLDS_API       = `${API_BASE_URL}/households`;
export const OFFICIALS_API        = `${API_BASE_URL}/officials`;
export const ANNOUNCEMENT_API     = `${API_BASE_URL}/announcements`;
export const DOCUMENTS_API        = `${API_BASE_URL}/documents`;
export const BLOTTER_API          = `${API_BASE_URL}/blotter`;

export const ANALYTICS_API        = `${API_BASE_URL}/analytics/raw`;
export const AUDIT_API            = `${API_BASE_URL}/audit`;
export const STATS_API            = `${API_BASE_URL}/stats`;

export const NOTIFICATION_API     = `${API_BASE_URL}/notifications`;
export const NOTIF_LIVE_API       = `${API_BASE_URL}/alerts/live`;
export const NOTIF_MARKER_API     = `${API_BASE_URL}/alerts/latest-marker`;
export const NOTIF_COUNT_API      = `${API_BASE_URL}/alerts/count`;

export const AUTH_REQUEST_OTP     = `${API_BASE_URL}/accounts/request-otp`;
export const AUTH_VERIFY_OTP      = `${API_BASE_URL}/accounts/verify-otp`;
export const AUTH_PASSWORD_UPDATE = `${API_BASE_URL}/accounts/public-reset`;

// 🛡️ CAPTCHA ENDPOINTS
export const CAPTCHA_CHALLENGE_API = `${API_BASE_URL}/captcha/challenge`;
export const CAPTCHA_VERIFY_API    = `${API_BASE_URL}/captcha/verify`;

// ── CSRF HELPER ────────────────────────────────────────────────────────────────
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const getCsrfToken = (): string | null => {
  const match = document.cookie.match(/(?:^| )XSRF-TOKEN=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
};

export const getAuthHeaders = (isFormData = false, method = 'GET'): Record<string, string> => {
  const headers: Record<string, string> = {};

  if (!isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  const token = localStorage.getItem('access_token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (MUTATION_METHODS.has(method.toUpperCase())) {
    const csrf = getCsrfToken();
    if (csrf) headers['X-XSRF-TOKEN'] = csrf;
  }

  return headers;
};

// ── SESSION CLEANUP ────────────────────────────────────────────────────────────
const SESSION_KEYS = [
  'access_token',
  'account_id',
  'profile_id',
  'admin_session',
  'resident_session',
  'user_role',
] as const;

const handleAuthFailure = (): void => {
  if (window.location.pathname === '/login') return;

  console.error('[AUTH] Session invalid — clearing state and redirecting.');
  SESSION_KEYS.forEach(key => localStorage.removeItem(key));
  window.location.href = '/login';
};

// ── REFRESH MUTEX ──────────────────────────────────────────────────────────────
let refreshMutex: Promise<boolean> | null = null;

const attemptSilentRefresh = (): Promise<boolean> => {
  if (refreshMutex) return refreshMutex;

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);

  refreshMutex = fetch(failover.resolve(REFRESH_API), {
    method:      'POST',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json' },
    signal:      controller.signal,
  })
    .then(async (res): Promise<boolean> => {
      if (!res.ok) return false;
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('application/json')) return false;
      const data = await res.json();
      if (data?.token) localStorage.setItem('access_token', data.token);
      return true;
    })
    .catch((err: any) => {
      console.warn('[REFRESH] Silent refresh failed:', err.message);
      return false;
    })
    .finally(() => {
      clearTimeout(timeoutId);
      refreshMutex = null; 
    });

  return refreshMutex;
};

// ── TIMEOUT HELPER ─────────────────────────────────────────────────────────────
const withTimeout = (callerSignal?: AbortSignal): [AbortSignal, () => void] => {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const cancel = (): void => clearTimeout(timeoutId);

  callerSignal?.addEventListener('abort', () => controller.abort(), { once: true });

  return [controller.signal, cancel];
};

// ── NETWORK ERROR CLASSIFIER ───────────────────────────────────────────────────
const isNetworkFailure = (err: any): boolean =>
  err instanceof TypeError || err?.message === 'Failed to fetch';

// ── VALVE — GET REQUESTS ───────────────────────────────────────────────────────
const valveFetch = async (url: string, signal?: AbortSignal, isRetry = false): Promise<any> => {
  const [combinedSignal, cancelTimeout] = withTimeout(signal);

  try {
    const response = await fetch(failover.resolve(url), {
      method:      'GET',
      headers:     getAuthHeaders(false, 'GET'),
      credentials: 'include',
      signal:      combinedSignal,
    });

    cancelTimeout();

    if (response.status === 401) {
      if (isRetry) { handleAuthFailure(); return null; }
      const refreshed = await attemptSilentRefresh();
      if (refreshed) return valveFetch(url, signal, true);
      handleAuthFailure();
      return null;
    }

    if (response.status === 403) {
      console.warn(`[RBAC] Access forbidden: ${url}`);
      return null;
    }

    if (response.status === 428) {
      console.warn(`[SECURITY] Bot behavior detected on ${url}. Triggering CAPTCHA...`);
      window.dispatchEvent(new CustomEvent('trigger-captcha'));
      return null;
    }

    if (!response.ok) {
      console.error(`[VALVE] HTTP ${response.status} at ${url}`);
      return null;
    }

    const ct = response.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) {
      console.error(`[VALVE] Expected JSON, received "${ct}" from ${url}`);
      return null;
    }

    return await response.json();

  } catch (err: any) {
    cancelTimeout();

    if (err?.name === 'AbortError') return null;

    if (!isRetry && isNetworkFailure(err) && CLOUD_API_URL) {
      failover.activate();
      return valveFetch(url, signal, isRetry);
    }

    console.error('[VALVE ERROR]', err.message);
    return null;
  }
};

// ── TRIGGER — MUTATIONS (POST / PUT / PATCH / DELETE) ─────────────────────────
const triggerAction = async (
  url:     string,
  method:  'POST' | 'PATCH' | 'PUT' | 'DELETE',
  body?:   any,
  signal?: AbortSignal,
  isRetry  = false,
): Promise<any> => {
  const isFormData                      = body instanceof FormData;
  const [combinedSignal, cancelTimeout] = withTimeout(signal);

  try {
    const response = await fetch(failover.resolve(url), {
      method,
      headers:     getAuthHeaders(isFormData, method),
      credentials: 'include',
      signal:      combinedSignal,
      body:
        isFormData         ? body :
        body !== undefined ? JSON.stringify(body) :
        undefined,
    });

    cancelTimeout();

    if (response.status === 401) {
      if (isRetry) {
        handleAuthFailure();
        return { success: false, error: 'Session expired. Please log in again.' };
      }
      const refreshed = await attemptSilentRefresh();
      if (refreshed) return triggerAction(url, method, body, signal, true);
      handleAuthFailure();
      return { success: false, error: 'Session expired. Please log in again.' };
    }

    if (response.status === 403) {
      return { success: false, error: 'Access denied. You do not have permission for this action.' };
    }

    if (response.status === 428) {
      console.warn(`[SECURITY] Bot behavior detected on ${url}. Triggering CAPTCHA...`);
      window.dispatchEvent(new CustomEvent('trigger-captcha'));
      return { success: false, error: 'HUMAN_VERIFICATION_REQUIRED' };
    }

    const ct = response.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) {
      return { success: false, error: `Server error (${response.status}): Unexpected response format.` };
    }

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data?.error || `Request failed with status ${response.status}` };
    }

    return { success: true, data };

  } catch (err: any) {
    cancelTimeout();

    if (err?.name === 'AbortError') {
      return { success: false, error: 'Request was cancelled.' };
    }

    if (!isRetry && isNetworkFailure(err) && CLOUD_API_URL) {
      failover.activate();
      return triggerAction(url, method, body, signal, isRetry);
    }

    console.error(`[TRIGGER ERROR — ${method}] ${url}:`, err.message);
    return { success: false, error: err.message };
  }
};

// ── FAST-BOOT PROFILE DEDUPLICATION (MUTEX) ──────────────────────────────────
// This forces multiple components loading on boot to share ONE network request.
let profileFetchMutex: Promise<any> | null = null;
let lastProfileId: string | null = null;

// ── MASTERMIND SERVICE MAP ─────────────────────────────────────────────────────
export const ApiService = {

  // ── AUTH LOGIN (RESTORED) ───────────────────────────────────────────────────
  adminLogin: (
    payload: { username: string; password?: string; otp?: string; trace_id?: string },
    signal?: AbortSignal,
  ) => triggerAction(LOGIN_API, 'POST', payload, signal),

  rootHandshake: (signal?: AbortSignal) =>
    triggerAction(`${API_BASE_URL}/auth/root-request`, 'POST', { username: 'SYSTEM_ROOT_ADMIN' }, signal),

  // ── OTP / PASSWORD RESET ────────────────────────────────────────────────────
  requestPasswordResetOTP: (email: string) =>
    triggerAction(AUTH_REQUEST_OTP, 'POST', { email }),

  verifyOTP: (email: string, otp: string) =>
    triggerAction(AUTH_VERIFY_OTP, 'POST', { email, otp }),

  updatePassword: (email: string, otp: string, newPassword: string) =>
    triggerAction(AUTH_PASSWORD_UPDATE, 'POST', { email, otp, newPassword }),

  // ── IDENTITY & PROFILE (OPTIMIZED) ──────────────────────────────────────────
  getProfile: (id: string, signal?: AbortSignal, forceSync = false) => {
    // If a fetch is already running for this user, hijack it instead of creating a new one
    if (!forceSync && profileFetchMutex && lastProfileId === id) {
      return profileFetchMutex;
    }
    
    lastProfileId = id;
    profileFetchMutex = valveFetch(`${PROFILE_API}/${id}`, signal).finally(() => {
      // Clear the mutex lock after 1.5 seconds so manual refreshes work normally later
      setTimeout(() => { profileFetchMutex = null; }, 1500);
    });
    
    return profileFetchMutex;
  },

  updateProfile: (id: string, payload: any) =>
    triggerAction(`${PROFILE_API}/${id}`, 'PUT', payload),

  updateTheme: (theme: string) =>
    triggerAction(`${API_BASE_URL}/accounts/theme`, 'PATCH', { theme }),

  // ── ACCOUNT MANAGEMENT (RBAC) ───────────────────────────────────────────────
  getAccounts: (signal?: AbortSignal) =>
    valveFetch(ACCOUNTS_API, signal),

  resetPassword: (id: string, payload: any) =>
    triggerAction(`${API_BASE_URL}/accounts/reset/${id}`, 'PATCH', payload),

  updateAccountRole: (id: string, payload: any) =>
    triggerAction(`${ACCOUNTS_API}/${id}/role`, 'PATCH', payload),

  // ── RESIDENTS ───────────────────────────────────────────────────────────────
  getResidents: (signal?: AbortSignal) =>
    valveFetch(RESIDENTS_API, signal),

  triggerLedgerBackfill: () =>
    triggerAction(`${RESIDENTS_API}/ledger/backfill`, 'POST'),

  saveResident: (id: string | undefined, payload: any) =>
    triggerAction(
      id ? `${RESIDENTS_API}/${id}` : RESIDENTS_API,
      id ? 'PUT' : 'POST',
      payload,
    ),

  deleteResident: (id: string) =>
    triggerAction(`${RESIDENTS_API}/${id}`, 'DELETE'),

  // ── HOUSEHOLDS ──────────────────────────────────────────────────────────────
  getHouseholds: (signal?: AbortSignal) =>
    valveFetch(HOUSEHOLDS_API, signal),

  saveHousehold: (id: string | undefined, payload: any) =>
    triggerAction(
      id ? `${HOUSEHOLDS_API}/${id}` : HOUSEHOLDS_API,
      id ? 'PUT' : 'POST',
      payload,
    ),

  deleteHousehold: (id: string) =>
    triggerAction(`${HOUSEHOLDS_API}/${id}`, 'DELETE'),

  // ── OFFICIALS ───────────────────────────────────────────────────────────────
  getOfficials: (signal?: AbortSignal) =>
    valveFetch(OFFICIALS_API, signal),

  saveOfficial: (id: string | undefined, payload: any) =>
    triggerAction(
      id ? `${OFFICIALS_API}/${id}` : OFFICIALS_API,
      id ? 'PUT' : 'POST',
      payload,
    ),

  deleteOfficial: (id: string) =>
    triggerAction(`${OFFICIALS_API}/${id}`, 'DELETE'),

  // ── ANNOUNCEMENTS ───────────────────────────────────────────────────────────
  getAnnouncements: (signal?: AbortSignal) =>
    valveFetch(ANNOUNCEMENT_API, signal),

  saveAnnouncement: (id: string | null, payload: any) =>
    triggerAction(
      id ? `${ANNOUNCEMENT_API}/${id}` : ANNOUNCEMENT_API,
      id ? 'PUT' : 'POST',
      payload,
    ),

  deleteAnnouncement: (id: string) =>
    triggerAction(`${ANNOUNCEMENT_API}/${id}`, 'DELETE'),

  // ── DOCUMENTS ───────────────────────────────────────────────────────────────
  getDocuments: (signal?: AbortSignal) =>
    valveFetch(DOCUMENTS_API, signal),

  getResidentDocuments: (residentId: string, signal?: AbortSignal) =>
    valveFetch(`${DOCUMENTS_API}/resident/${residentId}`, signal),

  getDocumentTypes: (signal?: AbortSignal) =>
    valveFetch(`${DOCUMENTS_API}/types`, signal),

  updateDocumentStatus: (id: string, status: string) =>
    triggerAction(`${DOCUMENTS_API}/${id}/status`, 'PATCH', { status }),

  saveDocumentRecord: (payload: any) => {
    const url    = payload.id ? `${DOCUMENTS_API}/${payload.id}` : `${DOCUMENTS_API}/save`;
    const method = (payload.id ? 'PUT' : 'POST') as 'PUT' | 'POST';
    return triggerAction(url, method, payload);
  },

  deleteDocument: (id: string) =>
    triggerAction(`${DOCUMENTS_API}/${id}`, 'DELETE'),

  // ── BLOTTER ─────────────────────────────────────────────────────────────────
  getBlotters: (signal?: AbortSignal) =>
    valveFetch(BLOTTER_API, signal),

  getResidentBlotters: (residentId: string, signal?: AbortSignal) =>
    valveFetch(`${BLOTTER_API}/resident/${residentId}`, signal),

  saveBlotter: (id: string | null, payload: any) =>
    triggerAction(
      id ? `${BLOTTER_API}/${id}` : BLOTTER_API,
      id ? 'PUT' : 'POST',
      payload,
    ),

  deleteBlotter: (id: string) =>
    triggerAction(`${BLOTTER_API}/${id}`, 'DELETE'),

  // ── INTELLIGENCE & SYSTEMS ──────────────────────────────────────────────────
  getStats: (signal?: AbortSignal) =>
    valveFetch(STATS_API, signal),

  getAuditLogs: (signal?: AbortSignal) =>
    valveFetch(AUDIT_API, signal),

  getAnalytics: (signal?: AbortSignal) =>
    valveFetch(ANALYTICS_API, signal),

  // ── CAPTCHA ─────────────────────────────────────────────────────────────────
  getCaptchaChallenge: (signal?: AbortSignal) =>
    valveFetch(CAPTCHA_CHALLENGE_API, signal),

  verifyCaptcha: (payload: { challenge_id: string; answer: string }) =>
    triggerAction(CAPTCHA_VERIFY_API, 'POST', payload),

  // ── NOTIFICATIONS ───────────────────────────────────────────────────────────
  getNotifications: (signal?: AbortSignal) =>
    valveFetch(NOTIF_LIVE_API, signal),

  markNotificationRead: (id: string) =>
    triggerAction(`${API_BASE_URL}/alerts/read/${id}`, 'PUT'),

  markAllNotificationsRead: () =>
    triggerAction(`${API_BASE_URL}/alerts/read-all`, 'PUT'),

  deleteNotification: (id: string) =>
    triggerAction(`${API_BASE_URL}/alerts/clear/${id}`, 'DELETE'),

  clearAllNotifications: () =>
    triggerAction(`${API_BASE_URL}/alerts/clear-all`, 'DELETE'),

  getNotificationMarker: (signal?: AbortSignal) =>
    valveFetch(NOTIF_MARKER_API, signal),

  getNotificationCount: (signal?: AbortSignal) =>
    valveFetch(NOTIF_COUNT_API, signal),
};