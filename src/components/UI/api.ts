// ── ENVIRONMENT ────────────────────────────────────────────────────────────────
const resolveDefaultApiUrl = (): string => {
  const envUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/$/, '');
  if (envUrl) return envUrl;
  if (typeof window !== 'undefined' && window.location.hostname.endsWith('.pages.dev')) {
    return 'https://barangay-eng-shill.onrender.com/api';
  }
  return '/api';
};

export const PRIMARY_API_URL  = resolveDefaultApiUrl();
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
export const REFRESH_API          = `${API_BASE_URL}/auth/admin/refresh`;
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

// NOTE (J-CVE-101203): the legacy REST recovery endpoints (/accounts/request-otp,
// /accounts/verify-otp, /accounts/public-reset) were retired in favour of the public
// GraphQL endpoint AUTH_GRAPHQL_API (declared below).

// 🛡️ CAPTCHA ENDPOINTS
export const CAPTCHA_EVALUATE_API  = `${API_BASE_URL}/captcha/evaluate`;
export const CAPTCHA_CHALLENGE_API = `${API_BASE_URL}/captcha/challenge`;
export const CAPTCHA_VERIFY_API    = `${API_BASE_URL}/captcha/verify`;

// 🕸️ GRAPHQL ENDPOINTS (J-CVE-101203 — native fetch flows migrated to GraphQL)
export const AUTH_GRAPHQL_API    = `${API_BASE_URL}/graphql/auth`;     // public: OTP / password reset
export const PROFILE_GRAPHQL_API = `${API_BASE_URL}/graphql/profile`;  // authed: profile / theme

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

  // Admin auth: httpOnly cookie (credentials: 'include') — cookie is set server-side.
  // Resident auth: short-lived access_token JWT stored in localStorage, sent as Bearer.
  const accessToken = localStorage.getItem('access_token');
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  if (MUTATION_METHODS.has(method.toUpperCase())) {
    const csrf = getCsrfToken();
    if (csrf) headers['X-XSRF-TOKEN'] = csrf;
  }

  return headers;
};

// ── SESSION CLEANUP ────────────────────────────────────────────────────────────
const SESSION_KEYS = [
  'account_id',
  'profile_id',
  'admin_session',
  'resident_session',
  'selectedPortal',
  'access_token',
] as const;

const handleAuthFailure = (): void => {
  if (window.location.pathname === '/login') return;

  console.error('[AUTH] Session invalid — clearing state and redirecting.');
  SESSION_KEYS.forEach(key => localStorage.removeItem(key));
  window.location.href = '/login';
};

// ── REFRESH MUTEX ──────────────────────────────────────────────────────────────
let refreshMutex: Promise<boolean> | null = null;

const RESIDENT_REFRESH_API = `${API_BASE_URL}/auth/refresh`;

const attemptSilentRefresh = (): Promise<boolean> => {
  if (refreshMutex) return refreshMutex;

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);

  // Residents use /auth/refresh (refresh_token httpOnly cookie → new access_token in body).
  // Admins use /auth/admin/refresh (auth_token httpOnly cookie rotated server-side).
  const isResident = !!localStorage.getItem('resident_session');
  const refreshUrl = isResident ? RESIDENT_REFRESH_API : REFRESH_API;

  refreshMutex = fetch(failover.resolve(refreshUrl), {
    method:      'POST',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json' },
    signal:      controller.signal,
  })
    .then(async (res): Promise<boolean> => {
      if (!res.ok) return false;
      if (isResident) {
        const data = await res.json().catch(() => ({}));
        if (data.access_token) localStorage.setItem('access_token', data.access_token);
      }
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

// ── GRAPHQL TRANSPORT ─────────────────────────────────────────────────────────
// Single POST transport for GraphQL endpoints. Returns the SAME envelope shape as
// triggerAction ({ success, data?, error? }) so callers stay uniform. Resolver-level
// failures arrive as HTTP 200 + { errors: [...] }, which we normalise to success:false.
const gqlFetch = async (
  url:        string,
  query:      string,
  variables:  Record<string, any> = {},
  signal?:    AbortSignal,
  isRetry     = false,
): Promise<{ success: boolean; data?: any; error?: string }> => {
  const [combinedSignal, cancelTimeout] = withTimeout(signal);

  try {
    const response = await fetch(failover.resolve(url), {
      method:      'POST',
      headers:     getAuthHeaders(false, 'POST'),
      credentials: 'include',
      signal:      combinedSignal,
      body:        JSON.stringify({ query, variables }),
    });

    cancelTimeout();

    // Authed GraphQL endpoints (e.g. /graphql/profile) can expire mid-session.
    if (response.status === 401) {
      if (isRetry) { handleAuthFailure(); return { success: false, error: 'Session expired. Please log in again.' }; }
      const refreshed = await attemptSilentRefresh();
      if (refreshed) return gqlFetch(url, query, variables, signal, true);
      handleAuthFailure();
      return { success: false, error: 'Session expired. Please log in again.' };
    }

    if (response.status === 428) {
      window.dispatchEvent(new CustomEvent('trigger-captcha'));
      return { success: false, error: 'HUMAN_VERIFICATION_REQUIRED' };
    }

    const json = await response.json().catch(() => ({}));

    if (json?.errors?.length) {
      return { success: false, error: json.errors[0]?.message || `Request failed (${response.status}).` };
    }
    return { success: true, data: json?.data };

  } catch (err: any) {
    cancelTimeout();

    if (err?.name === 'AbortError') return { success: false, error: 'Request was cancelled.' };

    if (!isRetry && isNetworkFailure(err) && CLOUD_API_URL) {
      failover.activate();
      return gqlFetch(url, query, variables, signal, isRetry);
    }

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

  // ── OTP / PASSWORD RESET (RESTORED TO PURE REST) ────────────────────────────
  requestPasswordResetOTP: async (email: string, useFallback: boolean = false, viaPhone: boolean = false) => {
    const r = await triggerAction(`${API_BASE_URL}/accounts/request-otp`, 'POST', {
      identifier: email,
      useFallback: useFallback,
      viaPhone: viaPhone
    });
    return r.success
      ? { success: true, message: r.data?.message }
      : { success: false, error: r.error };
  },

  verifyOTP: async (email: string, otp: string) => {
    const r = await triggerAction(`${API_BASE_URL}/accounts/verify-otp`, 'POST', {
      identifier: email,
      otp: otp
    });
    return r.success
      ? { success: true, message: r.data?.message }
      : { success: false, error: r.error };
  },

  updatePassword: async (email: string, otp: string, newPassword: string) => {
    const r = await triggerAction(`${API_BASE_URL}/accounts/public-reset`, 'POST', {
      identifier: email,
      otp: otp,
      newPassword: newPassword
    });
    return r.success
      ? { success: true, message: r.data?.message }
      : { success: false, error: r.error };
  },

  // ── IDENTITY & PROFILE (GraphQL — authed /graphql/profile) ───────────────────
  // The resolver identifies the user from the session token; `id` is kept only for
  // the boot-time dedup mutex. Resolves to the profile object (or null) to preserve
  // the previous REST contract used by navbar/sidebar consumers.
  getProfile: (id: string, signal?: AbortSignal, forceSync = false) => {
    if (!forceSync && profileFetchMutex && lastProfileId === id) {
      return profileFetchMutex;
    }

    lastProfileId = id;
    profileFetchMutex = gqlFetch(
      PROFILE_GRAPHQL_API,
      `query { getProfile { id full_name username email contact_number role theme_preference avatar_url } }`,
      {},
      signal,
    )
      .then(r => (r.success ? r.data?.getProfile ?? null : null))
      .finally(() => { setTimeout(() => { profileFetchMutex = null; }, 1500); });

    return profileFetchMutex;
  },

  updateProfile: async (_id: string, payload: any) => {
    const r = await gqlFetch(
      PROFILE_GRAPHQL_API,
      `mutation Upd($fn: String, $em: String, $ph: String, $avatar: String) {
         updateProfile(full_name: $fn, email: $em, contact_number: $ph, phone: $ph, avatar_url: $avatar) {
           id full_name email contact_number avatar_url
         }
       }`,
      { fn: payload?.full_name, em: payload?.email, ph: payload?.contact_number ?? payload?.phone, avatar: payload?.avatar_url },
    );
    return r.success
      ? { success: true, data: r.data?.updateProfile }
      : { success: false, error: r.error };
  },

  updateTheme: async (theme: string) => {
    const r = await gqlFetch(
      PROFILE_GRAPHQL_API,
      `mutation UpdTheme($t: String!) { updateTheme(theme: $t) { success message } }`,
      { t: theme },
    );
    return r.success
      ? { success: true, data: r.data?.updateTheme }
      : { success: false, error: r.error };
  },

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
    triggerAction(`${RESIDENTS_API}/ledger/rebuild`, 'POST'),

  // 🔗 Linked hash-chain (J-CVE-101203): recompute + compare head vs anchor.
  getLedgerVerification: (signal?: AbortSignal) =>
    valveFetch(`${RESIDENTS_API}/ledger/verify`, signal),

  rebuildLedger: () =>
    triggerAction(`${RESIDENTS_API}/ledger/rebuild`, 'POST'),

  saveResident: (id: string | undefined, payload: any) =>
    triggerAction(
      id ? `${RESIDENTS_API}/${id}` : RESIDENTS_API,
      id ? 'PUT' : 'POST',
      payload,
    ),

  requestResidentRegistrationCode: (payload: any) =>
    triggerAction(`${RESIDENTS_API}/register/request-code`, 'POST', payload),

  confirmResidentRegistrationCode: (sessionId: string, code: string) =>
    triggerAction(`${RESIDENTS_API}/register/confirm-code`, 'POST', { sessionId, code }),

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

  // Punong Barangay / superadmin reassigns an official's status; the backend
  // syncs their login account so access is revoked/restored on next refresh.
  updateOfficialStatus: (id: string, status: string) =>
    triggerAction(`${OFFICIALS_API}/${id}/status`, 'PATCH', { status }),

  // ── ANNOUNCEMENTS ───────────────────────────────────────────────────────────
  getAnnouncements: (signal?: AbortSignal) =>
    valveFetch(ANNOUNCEMENT_API, signal),

  // 🛡️ THE FIX: Custom Fetch for saveAnnouncement to bypass the 15s timeout
  saveAnnouncement: async (id: string | null, payload: any) => {
    try {
      const url = id ? `${ANNOUNCEMENT_API}/${id}` : ANNOUNCEMENT_API;
      const method = id ? 'PUT' : 'POST';

      // We create a specific AbortController just for this heavy request
      // and give it a generous 60-second breathing room for Cloudinary uploads.
      const uploadController = new AbortController();
      const uploadTimeout = setTimeout(() => uploadController.abort(), 60_000);

      const response = await fetch(failover.resolve(url), {
        method,
        headers: getAuthHeaders(false, method),
        credentials: 'include',
        body: JSON.stringify(payload),
        signal: uploadController.signal
      });

      clearTimeout(uploadTimeout);

      // Security fallback to handle unauthorized/captcha states properly
      if (response.status === 401 || response.status === 403 || response.status === 428) {
          return triggerAction(url, method, payload); 
      }

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data?.error || `Request failed with status ${response.status}` };
      }

      return { success: true, data };

    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return { success: false, error: 'Upload timed out. Please try a smaller image.' };
      }
      return { success: false, error: err.message };
    }
  },

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