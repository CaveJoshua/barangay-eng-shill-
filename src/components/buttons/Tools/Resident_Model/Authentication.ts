// Authentication.ts
import { API_BASE_URL } from '../../../UI/api';

/**
 * P.G.S.U. AUTHENTICATION & SECURITY MODULE
 * ─────────────────────────────────────────────────────────
 * Ensure every function intended for external use has the 'export' keyword.
 */

export const getAuthHeaders = (isFileUpload = false): Record<string, string> => {
    const token = localStorage.getItem('auth_token');
    const role = localStorage.getItem('user_role') || 'admin';
    
    const headers: Record<string, string> = {
        'x-user-role': role.toLowerCase()                
    };

    if (token && token !== 'null' && token !== 'undefined') {
        headers['Authorization'] = `Bearer ${token}`;
    }

    if (!isFileUpload) {
        headers['Content-Type'] = 'application/json';
    }

    return headers;
};

export const verifyActionSecurity = async (): Promise<boolean> => {
    try {
        const response = await fetch(`${API_BASE_URL}/residents?limit=1`, {
            method: 'GET',
            headers: getAuthHeaders(),
            credentials: 'include'
        });

        if (response.status === 401 || response.status === 403) {
            alert("Action blocked: Session expired. Please log in again.");
            return false;
        }

        if (!response.ok) {
            // Fail closed — do not allow actions if security check cannot complete
            alert("Action blocked: Security verification failed.");
            return false;
        }

        return window.confirm("Security Verification Passed. Proceed?");

    } catch (error) {
        console.error("Security Check Failed", error);
        // Fail closed — unreachable server is not a reason to proceed
        alert("Action blocked: Security server is unreachable. Please try again.");
        return false;
    }
};