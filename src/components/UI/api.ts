/**
 * api.ts - THE MASTERMIND (V6.2 - SIGNATURE BUG FIXED)
 * ────────────────────────────────────────────────────────
 * Features:
 * - Bearer Token Header Injection (Bypasses 3rd-Party Cookie Blocks)
 * - Safe JSON Parsing (Prevents HTML 404 crashes)
 * - Direct-Link Handshake for Notifications (/alerts/live)
 * - Silent Token Rotation & Anti-CSRF Injection
 * - Automatic 401 Session Cleanup
 */

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

/**
 * ==========================================
 * 1. ENDPOINT REGISTRY
 * ==========================================
 */

// --- Authentication & Identity ---
export const LOGIN_API = `${API_BASE_URL}/admin/login`;
export const REFRESH_API = `${API_BASE_URL}/auth/refresh`; 
export const ACCOUNTS_API = `${API_BASE_URL}/rbac/accounts`;
export const PROFILE_API = `${API_BASE_URL}/officials/profile`;

// --- Core Barangay Modules ---
export const RESIDENTS_API = `${API_BASE_URL}/residents`;
export const HOUSEHOLDS_API = `${API_BASE_URL}/households`;
export const OFFICIALS_API = `${API_BASE_URL}/officials`;
export const ANNOUNCEMENT_API = `${API_BASE_URL}/announcements`;
export const DOCUMENTS_API = `${API_BASE_URL}/documents`;
export const BLOTTER_API = `${API_BASE_URL}/blotter`;

// --- Intelligence & Audit ---
export const ANALYTICS_API = `${API_BASE_URL}/analytics/raw`;
export const AUDIT_API = `${API_BASE_URL}/audit`;
export const STATS_API = `${API_BASE_URL}/stats`;

// --- 🔔 RECTO NOTIFICATIONS (Synced with backend) ---
export const NOTIFICATION_API   = `${API_BASE_URL}/notifications`;
export const NOTIF_LIVE_API     = `${API_BASE_URL}/alerts/live`;
export const NOTIF_MARKER_API   = `${API_BASE_URL}/alerts/latest-marker`;
export const NOTIF_COUNT_API    = `${API_BASE_URL}/alerts/count`;

// --- Authentication & OTP ---
export const AUTH_REQUEST_OTP = `${API_BASE_URL}/accounts/request-otp`;
export const AUTH_VERIFY_OTP = `${API_BASE_URL}/accounts/verify-otp`;

// (RESTORED) Original route for Community Authentication
export const AUTH_PASSWORD_UPDATE = `${API_BASE_URL}/auth/reset-password`;

// (NEW) Route for Public OTP Password Reset
export const AUTH_PUBLIC_RESET = `${API_BASE_URL}/accounts/public-reset`;


/**
 * ==========================================
 * 2. ZERO TRUST HEADERS & CSRF PROTECTION
 * ==========================================
 */

const getCsrfToken = () => {
    const match = document.cookie.match(new RegExp('(^| )XSRF-TOKEN=([^;]+)'));
    return match ? match[2] : null;
};

export const getAuthHeaders = (isFormData = false, method = 'GET') => {
    const headers: Record<string, string> = {};

    if (!isFormData) headers['Content-Type'] = 'application/json';

    // 🛡️ THE BULLETPROOF FIX: Attach Token directly to Headers
    const token = localStorage.getItem('access_token');
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) {
        const csrfToken = getCsrfToken();
        if (csrfToken) headers['X-XSRF-TOKEN'] = csrfToken; 
    }

    return headers;
};


/**
 * ==========================================
 * 3. THE HANDSHAKE GUARDIANS (Interceptors)
 * ==========================================
 */

const handleAuthFailure = () => {
    if (window.location.pathname === '/login') return; 

    console.error("[AUTH] 401 Unauthorized. Session expired. Cleaning up...");
    
    localStorage.removeItem('access_token');
    localStorage.removeItem('account_id');
    localStorage.removeItem('profile_id');
    localStorage.removeItem('admin_session'); 
    localStorage.removeItem('resident_session'); 
    localStorage.removeItem('user_role');
    
    window.location.href = '/login'; 
};

let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

const attemptSilentRefresh = async (): Promise<boolean> => {
    if (isRefreshing && refreshPromise) return refreshPromise;

    isRefreshing = true;
    refreshPromise = fetch(REFRESH_API, {
        method: 'POST',
        credentials: 'include', 
        headers: { 'Content-Type': 'application/json' }
    }).then(async (res) => {
        isRefreshing = false;
        if (res.ok) {
            const contentType = res.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
                const data = await res.json();
                if (data.token) localStorage.setItem('access_token', data.token);
            }
        }
        return res.ok;
    }).catch(() => {
        isRefreshing = false;
        return false;
    });

    return refreshPromise;
};


/**
 * ==========================================
 * 4. THE FETCH WRAPPERS (VALVE & TRIGGER)
 * ==========================================
 */

const valveFetch = async (url: string, signal?: AbortSignal, isRetry = false): Promise<any> => {
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: getAuthHeaders(false, 'GET'),
            credentials: 'include', 
            signal: signal
        });

        if (response.status === 401 && !isRetry) {
            const refreshed = await attemptSilentRefresh();
            if (refreshed) return valveFetch(url, signal, true);
            handleAuthFailure();
            return null;
        }

        if (response.status === 401 && isRetry) {
            handleAuthFailure(); 
            return null;
        }

        if (response.status === 403) return null; 
        if (!response.ok) return null;
        
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
            return await response.json();
        }
        return null;
    } catch (err: any) {
        if (err.name === 'AbortError') return null;
        return null; 
    }
};

const triggerAction = async (url: string, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', body?: any, isRetry = false): Promise<any> => {
    try {
        const isFormData = body instanceof FormData;

        const response = await fetch(url, {
            method: method,
            headers: getAuthHeaders(isFormData, method),
            credentials: 'include',
            body: isFormData ? body : (body ? JSON.stringify(body) : undefined)
        });

        if (response.status === 401 && !isRetry) {
            const refreshed = await attemptSilentRefresh();
            if (refreshed) return triggerAction(url, method, body, true);
            handleAuthFailure();
            return { success: false, error: "Session securely terminated." };
        }

        if (response.status === 401 && isRetry) {
            handleAuthFailure();
            return { success: false, error: "Session securely terminated." };
        }

        if (response.status === 403) {
            return { success: false, error: "Security Policy Violation: No permission." };
        }

        const contentType = response.headers.get("content-type");
        let data;
        if (contentType && contentType.includes("application/json")) {
            data = await response.json();
        } else {
            return { success: false, error: `System Error (${response.status}).` };
        }

        if (!response.ok) return { success: false, error: data.error || `Action failed: ${response.status}` };
        
        return { success: true, data };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
};


/**
 * ==========================================
 * 5. THE MASTERMIND SERVICE MAP
 * ==========================================
 */
export const ApiService = {
    // --- GMAIL OTP AUTHENTICATION METHODS ---
    requestPasswordResetOTP: (email: string) => triggerAction(AUTH_REQUEST_OTP, 'POST', { email }),
    verifyOTP: (email: string, otp: string) => triggerAction(AUTH_VERIFY_OTP, 'POST', { email, otp }),
    
    // 🛡️ RESTORED FIX: 2 arguments so Community_Authentication.tsx stops crashing!
    updatePassword: (residentId: string, newPassword: string) => 
        triggerAction(AUTH_PASSWORD_UPDATE, 'PUT', { residentId, newPassword }),
        
    // 🛡️ NEW FIX: The 3 argument version specifically for the public OTP page
    publicResetPassword: (email: string, otp: string, newPassword: string) => 
        triggerAction(AUTH_PUBLIC_RESET, 'POST', { email, otp, newPassword }),

    // --- Identity & Profiles ---
    getProfile: (id: string, signal?: AbortSignal) => valveFetch(`${PROFILE_API}/${id}`, signal),
    updateProfile: (id: string, payload: any) => triggerAction(`${PROFILE_API}/${id}`, 'PUT', payload),
    updateTheme: (theme: string) => triggerAction(`${API_BASE_URL}/accounts/theme`, 'PATCH', { theme }),

    // --- Account Management (RBAC) ---
    getAccounts: (signal?: AbortSignal) => valveFetch(ACCOUNTS_API, signal),
    resetPassword: (id: string, payload: any) => triggerAction(`${API_BASE_URL}/accounts/reset/${id}`, 'PATCH', payload),
    updateAccountRole: (id: string, payload: any) => triggerAction(`${ACCOUNTS_API}/${id}/role`, 'PATCH', payload),

    // --- Residents Module ---
    getResidents: (signal?: AbortSignal) => valveFetch(RESIDENTS_API, signal),
    saveResident: (id: string | undefined, payload: any) => {
        const url = id ? `${RESIDENTS_API}/${id}` : RESIDENTS_API;
        return triggerAction(url, id ? 'PUT' : 'POST', payload);
    },
    deleteResident: (id: string) => triggerAction(`${RESIDENTS_API}/${id}`, 'DELETE'),

    // --- Households Module ---
    getHouseholds: (signal?: AbortSignal) => valveFetch(HOUSEHOLDS_API, signal),
    saveHousehold: (id: string | undefined, payload: any) => {
        const url = id ? `${HOUSEHOLDS_API}/${id}` : HOUSEHOLDS_API;
        return triggerAction(url, id ? 'PUT' : 'POST', payload);
    },
    deleteHousehold: (id: string) => triggerAction(`${HOUSEHOLDS_API}/${id}`, 'DELETE'),

    // --- Officials Module ---
    getOfficials: (signal?: AbortSignal) => valveFetch(OFFICIALS_API, signal),
    saveOfficial: (id: string | undefined, payload: any) => {
        const url = id ? `${OFFICIALS_API}/${id}` : OFFICIALS_API;
        return triggerAction(url, id ? 'PUT' : 'POST', payload);
    },
    deleteOfficial: (id: string) => triggerAction(`${OFFICIALS_API}/${id}`, 'DELETE'),

    // --- Announcements Module ---
    getAnnouncements: (signal?: AbortSignal) => valveFetch(ANNOUNCEMENT_API, signal),
    saveAnnouncement: (id: string | null, payload: any) => {
        const url = id ? `${ANNOUNCEMENT_API}/${id}` : ANNOUNCEMENT_API;
        return triggerAction(url, id ? 'PUT' : 'POST', payload);
    },
    deleteAnnouncement: (id: string) => triggerAction(`${ANNOUNCEMENT_API}/${id}`, 'DELETE'),

    // --- Documents Module ---
    getDocuments: (signal?: AbortSignal) => valveFetch(DOCUMENTS_API, signal),
    getDocumentTypes: (signal?: AbortSignal) => valveFetch(`${DOCUMENTS_API}/types`, signal),
    updateDocumentStatus: (id: string, status: string) => triggerAction(`${DOCUMENTS_API}/${id}/status`, 'PATCH', { status }),
    saveDocumentRecord: (payload: any) => {
        const url = payload.id ? `${DOCUMENTS_API}/${payload.id}` : `${DOCUMENTS_API}/save`;
        return triggerAction(url, payload.id ? 'PUT' : 'POST', payload);
    },
    deleteDocument: (id: string) => triggerAction(`${DOCUMENTS_API}/${id}`, 'DELETE'),

    // --- Blotter Module ---
    getBlotters: (signal?: AbortSignal) => valveFetch(BLOTTER_API, signal),
    saveBlotter: (id: string | null, payload: any) => {
        const url = id ? `${BLOTTER_API}/${id}` : BLOTTER_API;
        return triggerAction(url, id ? 'PUT' : 'POST', payload);
    },
    deleteBlotter: (id: string) => triggerAction(`${BLOTTER_API}/${id}`, 'DELETE'),

    // --- Intelligence & Systems ---
    getStats: (signal?: AbortSignal) => valveFetch(STATS_API, signal),
    getAuditLogs: (signal?: AbortSignal) => valveFetch(AUDIT_API, signal),
    getAnalytics: (signal?: AbortSignal) => valveFetch(ANALYTICS_API, signal),

    // --- 🔔 RECTO NOTIFICATIONS MODULE ---
    getNotifications: (signal?: AbortSignal) => valveFetch(NOTIF_LIVE_API, signal),
    markNotificationRead: (id: string) => triggerAction(`${NOTIFICATION_API}/${id}/read`, 'PUT'),
    markAllNotificationsRead: () => triggerAction(`${NOTIFICATION_API}/read-all`, 'PUT'),
    getNotificationMarker: () => valveFetch(NOTIF_MARKER_API),
    getNotificationCount: () => valveFetch(NOTIF_COUNT_API),
};