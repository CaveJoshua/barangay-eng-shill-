/**
 * ============================================================
 * CAPTCHA COMPLETELY DISABLED
 * ============================================================
 * Removed by request to speed up development and testing.
 * This component is now a ghost and will never render.
 * ============================================================
 */

import React, { useEffect } from 'react';

export const CaptchaModal: React.FC = () => {
    
    // Auto-resolve any trigger events just in case the system 
    // fires one, so the app continues seamlessly.
    useEffect(() => {
        const handleTrigger = () => {
            console.log("⚠️ Captcha bypassed.");
            window.dispatchEvent(new CustomEvent('captcha-verified'));
        };

        window.addEventListener('trigger-captcha', handleTrigger);
        return () => window.removeEventListener('trigger-captcha', handleTrigger);
    }, []);

    // Render absolutely nothing.
    return null;
};