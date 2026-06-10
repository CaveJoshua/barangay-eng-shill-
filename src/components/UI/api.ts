// ── ENVIRONMENT ────────────────────────────────────────────────────────────────
export const PRIMARY_API_URL  = (import.meta.env.VITE_API_BASE_URL       ?? '').replace(/\/$/, '');
export const CLOUD_API_URL    = (import.meta.env.VITE_API_BASE_URL_CLOUD ?? '').replace(/\/$/, '');
export const API_BASE_URL     = PRIMARY_API_URL;

// ── TIMING CONSTANTS ───────────────────────────────────────────────────────────
const REQUEST_TIMEOUT_MS   = 15_000;
const REFRESH_TIMEOUT_MS   = 10_000;
const FAILOVER_RECOVERY_MS = 60_000;
const UPLOAD_TIMEOUT_MS    = 60_000;  // Cloudinary / heavy payloads

// ── SESSION STORE ──────────────────────────────────────────────────────────────
// Unified storage abstraction that solves the localStorage→sessionStorage
// migration without requiring every write-site to be updated first.
//
//   get()    → checks sessionStorage; if missing, auto-migrates from localStorage
//              (handles already-logged-in users transparently on first load)
//   set()    → writes to sessionStorage and erases any stale localStorage shadow
//   remove() → wipes both storages for the key
//   clear()  → bulk remove for logout
//
// Net effect: new sessions are tab-scoped (clear on close); no one gets surprise-
// logged-out because their login code still wrote to localStorage.
export const SessionStore = {
  get(key: string): string | null {
    // Fast path: already in sessionStorage
    const ss = sessionStorage.getItem(key);
    if (ss !== null) return ss;

    // Migration path: first time after deploy, token lives in localStorage
    const ls = localStorage.getItem(key);
    if (ls !== null) {
      try {
        sessionStorage.setItem(key, ls); // promote to session-scoped
        localStorage.removeItem(key);    // remove stale copy
      } catch {
        // sessionStorage quota exceeded (rare) — leave in localStorage for now
      }
      return ls;
    }

    return null;
  },

  set(key: string, value: string): void {
    sessionStorage.setItem(key, value);
    localStorage.removeItem(key); // prevent stale shadow copies
  },

  remove(key: string): void {
    sessionStorage.removeItem(key);
    localStorage.removeItem(key);
  },

  clear(keys: readonly string[]): void {
    keys.forEach(k => this.remove(k));
  },
};

// ── FAILOVER ───────────────────────────────────────────────────────────────────
const failover = {
  active:        false,
  recoveryTimer: null as ReturnType<typeof setTimeout> | null,

  activate(): void {
    if (this.active) return;
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
    return this.active && CLOUD_API_URL
      ? url.replace(PRIMARY_API_URL, CLOUD_API_URL)
      : url;
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

// NOTE (J-CVE-101203): legacy REST recovery endpoints retired in favour of GraphQL.
export const CAPTCHA_CHALLENGE_API = `${API_BASE_URL}/captcha/challenge`;
export const CAPTCHA_VERIFY_API    = `${API_BASE_URL}/captcha/verify`;

export const AUTH_GRAPHQL_API    = `${API_BASE_URL}/graphql/auth`;
export const PROFILE_GRAPHQL_API = `${API_BASE_URL}/graphql/profile`;

// ── CSRF HELPER ────────────────────────────────────────────────────────────────
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const getCsrfToken = (): string | null => {
  const match = document.cookie.match(/(?:^| )XSRF-TOKEN=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
};

export const getAuthHeaders = (isFormData = false, method = 'GET'): Record<string, string> => {
  const headers: Record<string, string> = {};
  if (!isFormData) headers['Content-Type'] = 'application/json';

  // SessionStore.get() auto-migrates any localStorage token on first call,
  // so this works immediately even if the login page hasn't been updated yet.
  const token = SessionStore.get('access_token');
  if (token) headers['Authorization'] = `Bearer ${token}`;

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
  SessionStore.clear(SESSION_KEYS);
  window.location.href = '/login';
};

// ── REFRESH MUTEX ──────────────────────────────────────────────────────────────
let refreshMutex: Promise<boolean> | null = null;
const RESIDENT_REFRESH_API = `${API_BASE_URL}/auth/refresh`;

const attemptSilentRefresh = (): Promise<boolean> => {
  if (refreshMutex) return refreshMutex; // deduplicate concurrent refresh calls

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
  const isResident = !!SessionStore.get('resident_session');
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
        const body = await res.json().catch(() => ({}));
        if (body.access_token) SessionStore.set('access_token', body.access_token);
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

// ── NETWORK ERROR CLASSIFIER ───────────────────────────────────────────────────
const isNetworkFailure = (err: any): boolean =>
  err instanceof TypeError || err?.message === 'Failed to fetch';

// ── CORE REQUEST ENGINE ────────────────────────────────────────────────────────
// Single fetch implementation shared by all three transport wrappers below.
// Handles: timeouts, auth headers, 401 refresh+retry, 403, 428 captcha,
//          failover routing, GraphQL error normalisation.
//
// Return shape:  { ok: true, data }  |  { ok: false, error }

interface CoreOptions {
  method?:  'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?:    any;
  signal?:  AbortSignal;
  timeout?: number;
  isGql?:   boolean;
}

type CoreResult<T = any> =
  | { ok: true;  data: T      }
  | { ok: false; error: string };

const coreRequest = async <T = any>(
  url:    string,
  opts:   CoreOptions = {},
  _retry  = false,
): Promise<CoreResult<T>> => {
  const {
    method  = 'GET',
    body,
    signal,
    timeout = REQUEST_TIMEOUT_MS,
    isGql   = false,
  } = opts;

  const isFormData = body instanceof FormData;
  const controller = new AbortController();
  const tid        = setTimeout(() => controller.abort(), timeout);
  signal?.addEventListener('abort', () => controller.abort(), { once: true });

  try {
    const res = await fetch(failover.resolve(url), {
      method,
      credentials: 'include',
      headers:     getAuthHeaders(isFormData, method),
      signal:      controller.signal,
      body:
        isFormData         ? body :
        body !== undefined ? JSON.stringify(body) :
        undefined,
    });
    clearTimeout(tid);

    // ── Auth gates ────────────────────────────────────────────────────────────
    if (res.status === 401) {
      if (_retry) {
        handleAuthFailure();
        return { ok: false, error: 'Session expired. Please log in again.' };
      }
      const refreshed = await attemptSilentRefresh();
      if (refreshed) return coreRequest(url, opts, true);
      handleAuthFailure();
      return { ok: false, error: 'Session expired. Please log in again.' };
    }

    if (res.status === 403) {
      return { ok: false, error: 'Access denied. You do not have permission for this action.' };
    }

    if (res.status === 428) {
      window.dispatchEvent(new CustomEvent('trigger-captcha'));
      return { ok: false, error: 'HUMAN_VERIFICATION_REQUIRED' };
    }

    // ── Parse body ────────────────────────────────────────────────────────────
    const ct   = res.headers.get('content-type') ?? '';
    const json = ct.includes('application/json')
      ? await res.json().catch(() => null)
      : null;

    if (!ct.includes('application/json') && !res.ok) {
      return { ok: false, error: `Server error (${res.status}): unexpected response format.` };
    }

    // GraphQL resolver-level failures (HTTP 200 + { errors: [...] })
    if (isGql && json?.errors?.length) {
      return { ok: false, error: json.errors[0]?.message ?? `GraphQL error (${res.status}).` };
    }

    if (!res.ok) {
      return { ok: false, error: json?.error ?? `Request failed with status ${res.status}` };
    }

    return { ok: true, data: (isGql ? json?.data : json) as T };

  } catch (err: any) {
    clearTimeout(tid);

    if (err?.name === 'AbortError') return { ok: false, error: 'Request was cancelled.' };

    if (!_retry && isNetworkFailure(err) && CLOUD_API_URL) {
      failover.activate();
      return coreRequest(url, opts, _retry); // retry via cloud
    }

    console.error(`[API ${method}] ${url}:`, err.message);
    return { ok: false, error: err.message ?? 'Network error.' };
  }
};

// ── TRANSPORT LAYER ────────────────────────────────────────────────────────────
// Three thin wrappers that adapt the CoreResult shape to the contracts
// expected by existing callers — no duplication of retry/auth/failover logic.

// GET: returns parsed data or null
const valveFetch = async (url: string, signal?: AbortSignal): Promise<any> => {
  const r = await coreRequest(url, { method: 'GET', signal });
  if (!r.ok && r.error !== 'Request was cancelled.') {
    console.error(`[GET] ${url}:`, r.error);
  }
  return r.ok ? r.data : null;
};

// MUTATION: returns { success, data?, error? } envelope
const triggerAction = async (
  url:      string,
  method:   'POST' | 'PATCH' | 'PUT' | 'DELETE',
  body?:    any,
  signal?:  AbortSignal,
  timeout?: number,
): Promise<{ success: boolean; data?: any; error?: string }> => {
  const r = await coreRequest(url, { method, body, signal, timeout });
  return r.ok
    ? { success: true,  data:  r.data  }
    : { success: false, error: r.error };
};

// GRAPHQL: returns { success, data?, error? } envelope
const gqlFetch = async (
  url:       string,
  query:     string,
  variables: Record<string, any> = {},
  signal?:   AbortSignal,
): Promise<{ success: boolean; data?: any; error?: string }> => {
  const r = await coreRequest(url, {
    method: 'POST',
    body:   { query, variables },
    signal,
    isGql:  true,
  });
  return r.ok
    ? { success: true,  data:  r.data  }
    : { success: false, error: r.error };
};

// ── FAST-BOOT PROFILE DEDUPLICATION ───────────────────────────────────────────
let profileFetchMutex: Promise<any> | null = null;
let lastProfileId: string | null = null;

// ── MASTERMIND SERVICE MAP ─────────────────────────────────────────────────────
export const ApiService = {

  // ── AUTH ─────────────────────────────────────────────────────────────────────
  adminLogin: (
    payload: { username: string; password?: string; otp?: string; trace_id?: string },
    signal?: AbortSignal,
  ) => triggerAction(LOGIN_API, 'POST', payload, signal),

  rootHandshake: (signal?: AbortSignal) =>
    triggerAction(`${API_BASE_URL}/auth/root-request`, 'POST', { username: 'SYSTEM_ROOT_ADMIN' }, signal),

  // ── OTP / PASSWORD RESET ─────────────────────────────────────────────────────
  requestPasswordResetOTP: async (email: string, useFallback = false) => {
    const r = await triggerAction(`${API_BASE_URL}/accounts/request-otp`, 'POST', { identifier: email, useFallback });
    return r.success ? { success: true, message: r.data?.message } : { success: false, error: r.error };
  },

  verifyOTP: async (email: string, otp: string) => {
    const r = await triggerAction(`${API_BASE_URL}/accounts/verify-otp`, 'POST', { identifier: email, otp });
    return r.success ? { success: true, message: r.data?.message } : { success: false, error: r.error };
  },

  updatePassword: async (email: string, otp: string, newPassword: string) => {
    const r = await triggerAction(`${API_BASE_URL}/accounts/public-reset`, 'POST', { identifier: email, otp, newPassword });
    return r.success ? { success: true, message: r.data?.message } : { success: false, error: r.error };
  },

  // ── IDENTITY & PROFILE (GraphQL — /graphql/profile) ──────────────────────────
  getProfile: (id: string, signal?: AbortSignal, forceSync = false) => {
    if (!forceSync && profileFetchMutex && lastProfileId === id) return profileFetchMutex;

    lastProfileId     = id;
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
      ? { success: true,  data:  r.data?.updateProfile }
      : { success: false, error: r.error };
  },

  updateTheme: async (theme: string) => {
    const r = await gqlFetch(
      PROFILE_GRAPHQL_API,
      `mutation UpdTheme($t: String!) { updateTheme(theme: $t) { success message } }`,
      { t: theme },
    );
    return r.success
      ? { success: true,  data:  r.data?.updateTheme }
      : { success: false, error: r.error };
  },

  // ── ACCOUNT MANAGEMENT (RBAC) ─────────────────────────────────────────────────
  getAccounts:       (signal?: AbortSignal) => valveFetch(ACCOUNTS_API, signal),
  resetPassword:     (id: string, payload: any) => triggerAction(`${API_BASE_URL}/accounts/reset/${id}`, 'PATCH', payload),
  updateAccountRole: (id: string, payload: any) => triggerAction(`${ACCOUNTS_API}/${id}/role`, 'PATCH', payload),

  // ── RESIDENTS ─────────────────────────────────────────────────────────────────
  getResidents:          (signal?: AbortSignal) => valveFetch(RESIDENTS_API, signal),
  triggerLedgerBackfill: ()                     => triggerAction(`${RESIDENTS_API}/ledger/rebuild`, 'POST'),
  getLedgerVerification: (signal?: AbortSignal) => valveFetch(`${RESIDENTS_API}/ledger/verify`, signal),
  rebuildLedger:         ()                     => triggerAction(`${RESIDENTS_API}/ledger/rebuild`, 'POST'),

  saveResident: (id: string | undefined, payload: any) =>
    triggerAction(id ? `${RESIDENTS_API}/${id}` : RESIDENTS_API, id ? 'PUT' : 'POST', payload),

  deleteResident: (id: string) => triggerAction(`${RESIDENTS_API}/${id}`, 'DELETE'),

  // ── HOUSEHOLDS ────────────────────────────────────────────────────────────────
  getHouseholds: (signal?: AbortSignal) => valveFetch(HOUSEHOLDS_API, signal),

  saveHousehold: (id: string | undefined, payload: any) =>
    triggerAction(id ? `${HOUSEHOLDS_API}/${id}` : HOUSEHOLDS_API, id ? 'PUT' : 'POST', payload),

  deleteHousehold: (id: string) => triggerAction(`${HOUSEHOLDS_API}/${id}`, 'DELETE'),

  // ── OFFICIALS ─────────────────────────────────────────────────────────────────
  getOfficials: (signal?: AbortSignal) => valveFetch(OFFICIALS_API, signal),

  saveOfficial: (id: string | undefined, payload: any) =>
    triggerAction(id ? `${OFFICIALS_API}/${id}` : OFFICIALS_API, id ? 'PUT' : 'POST', payload),

  deleteOfficial: (id: string) => triggerAction(`${OFFICIALS_API}/${id}`, 'DELETE'),

  // ── ANNOUNCEMENTS ─────────────────────────────────────────────────────────────
  getAnnouncements: (signal?: AbortSignal) => valveFetch(ANNOUNCEMENT_API, signal),

  // Passes UPLOAD_TIMEOUT_MS (60 s) through the standard engine — no more
  // bespoke fetch block; retry/auth/failover all work correctly here too.
  saveAnnouncement: (id: string | null, payload: any) =>
    triggerAction(
      id ? `${ANNOUNCEMENT_API}/${id}` : ANNOUNCEMENT_API,
      id ? 'PUT' : 'POST',
      payload,
      undefined,
      UPLOAD_TIMEOUT_MS,
    ),

  deleteAnnouncement: (id: string) => triggerAction(`${ANNOUNCEMENT_API}/${id}`, 'DELETE'),

  // ── DOCUMENTS ─────────────────────────────────────────────────────────────────
  getDocuments:         (signal?: AbortSignal) => valveFetch(DOCUMENTS_API, signal),
  getResidentDocuments: (residentId: string, signal?: AbortSignal) =>
    valveFetch(`${DOCUMENTS_API}/resident/${residentId}`, signal),
  getDocumentTypes:     (signal?: AbortSignal) => valveFetch(`${DOCUMENTS_API}/types`, signal),

  updateDocumentStatus: (id: string, status: string) =>
    triggerAction(`${DOCUMENTS_API}/${id}/status`, 'PATCH', { status }),

  saveDocumentRecord: (payload: any) =>
    triggerAction(
      payload.id ? `${DOCUMENTS_API}/${payload.id}` : `${DOCUMENTS_API}/save`,
      payload.id ? 'PUT' : 'POST',
      payload,
    ),

  deleteDocument: (id: string) => triggerAction(`${DOCUMENTS_API}/${id}`, 'DELETE'),

  // ── BLOTTER ───────────────────────────────────────────────────────────────────
  getBlotters:         (signal?: AbortSignal) => valveFetch(BLOTTER_API, signal),
  getResidentBlotters: (residentId: string, signal?: AbortSignal) =>
    valveFetch(`${BLOTTER_API}/resident/${residentId}`, signal),

  saveBlotter: (id: string | null, payload: any) =>
    triggerAction(id ? `${BLOTTER_API}/${id}` : BLOTTER_API, id ? 'PUT' : 'POST', payload),

  deleteBlotter: (id: string) => triggerAction(`${BLOTTER_API}/${id}`, 'DELETE'),

  // ── INTELLIGENCE & SYSTEMS ────────────────────────────────────────────────────
  getStats:     (signal?: AbortSignal) => valveFetch(STATS_API, signal),
  getAuditLogs: (signal?: AbortSignal) => valveFetch(AUDIT_API, signal),
  getAnalytics: (signal?: AbortSignal) => valveFetch(ANALYTICS_API, signal),

  // ── CAPTCHA ───────────────────────────────────────────────────────────────────
  getCaptchaChallenge: (signal?: AbortSignal) => valveFetch(CAPTCHA_CHALLENGE_API, signal),
  verifyCaptcha: (payload: { challenge_id: string; answer: string }) =>
    triggerAction(CAPTCHA_VERIFY_API, 'POST', payload),

  // ── NOTIFICATIONS ─────────────────────────────────────────────────────────────
  getNotifications:        (signal?: AbortSignal) => valveFetch(NOTIF_LIVE_API, signal),
  markNotificationRead:    (id: string) => triggerAction(`${API_BASE_URL}/alerts/read/${id}`, 'PUT'),
  markAllNotificationsRead:()           => triggerAction(`${API_BASE_URL}/alerts/read-all`, 'PUT'),
  deleteNotification:      (id: string) => triggerAction(`${API_BASE_URL}/alerts/clear/${id}`, 'DELETE'),
  clearAllNotifications:   ()           => triggerAction(`${API_BASE_URL}/alerts/clear-all`, 'DELETE'),
  getNotificationMarker:   (signal?: AbortSignal) => valveFetch(NOTIF_MARKER_API, signal),
  getNotificationCount:    (signal?: AbortSignal) => valveFetch(NOTIF_COUNT_API, signal),
};
