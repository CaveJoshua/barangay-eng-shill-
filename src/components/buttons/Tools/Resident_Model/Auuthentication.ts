import { API_BASE_URL } from '../../../UI/api';

/**
 * P.G.S.U. AUTHENTICATION & SECURITY MODULE
 * Engineered for SmartBarangay System Infrastructure
 */

/**
 * Retrieves the current authentication headers required for API handshakes.
 */
export const getAuthHeaders = (): Record<string, string> => {
    const token = localStorage.getItem('auth_token');
    let role = localStorage.getItem('user_role');
    
    if (!role || role === 'undefined' || role === 'null') {
        role = 'admin'; 
        localStorage.setItem('user_role', 'admin'); 
    }
    
    return {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : '', 
        'x-user-role': role.toLowerCase()                
    };
};

/**
 * HIGH-LEVEL GUARD RAIL: Action Verification
 * Purpose: Requires user to re-enter password before sensitive operations (Backups/Imports).
 */
export const verifyActionSecurity = async (): Promise<boolean> => {
    const password = window.prompt("SECURITY ALERT: This action requires high-level clearance. Please re-enter your password to proceed:");
    
    if (!password) return false;

    try {
        const response = await fetch(`${API_BASE_URL}/auth/verify-action`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ password })
        });

        if (response.ok) {
            return true;
        } else {
            alert("Verification Failed: Incorrect password or session expired.");
            return false;
        }
    } catch (err) {
        console.error("[SECURITY_ERROR]", err);
        alert("Security Handshake Error. Check connection.");
        return false;
    }
};

/**
 * Validates if a session token exists.
 */
export const isAuthenticated = (): boolean => {
    const token = localStorage.getItem('auth_token');
    return !!token && token !== 'null' && token !== 'undefined';
};

/**
 * Retrieves the current user role.
 */
export const getUserRole = (): string => {
    const role = localStorage.getItem('user_role');
    return (role || 'resident').toLowerCase();
};

/**
 * Terminate Session.
 */
export const logoutUser = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user_role');
    localStorage.removeItem('user_id');
    window.location.href = '/login';
};

/**
 * Permission Guard.
 */
export const hasAccess = (allowedRoles: string[]): boolean => {
    const currentRole = getUserRole();
    return allowedRoles.includes(currentRole);
};