/**
 * ============================================================
 *  CaptchaModal.tsx — Security Verification Modal  [HARDENED v2.0]
 * ============================================================
 *  AUDIT FIXES APPLIED:
 *  [CRITICAL] Client-side CAPTCHA generation REMOVED.
 *             Old system: code generated in browser → trivially bypassable
 *             by reading React state in DevTools or patching the JS.
 *             New system: challenge token fetched from server on mount;
 *             server validates the answer server-side.
 *  [CRITICAL] Hardcoded 'human-verified-token' removed.
 *             The backend no longer accepts a static string.
 *             It now validates a server-issued challenge ID + answer.
 *  [HIGH]     console.log "TRIPWIRE" statements removed.
 *             In production these leak internal security state to anyone
 *             with DevTools open and create noise in log pipelines.
 *  [MEDIUM]   window.location.reload() replaced with custom event dispatch
 *             so the calling page can handle retry cleanly without losing state.
 *  [MEDIUM]   autoFocus + disabled states improved for accessibility.
 *  [INFO]     Component now shows a server-rendered CAPTCHA image/text.
 * ============================================================
 *
 *  REQUIRED BACKEND ENDPOINT (captcha.js):
 *  ─────────────────────────────────────────────────────────
 *  GET  /api/captcha/challenge
 *       Response: { challenge_id: string, image_base64: string }
 *       - Generates a random 6-char code
 *       - Stores hash in DB or signed token with 5min TTL
 *       - Returns a base64 PNG of the code (use 'canvas' or 'svg-captcha' npm)
 *
 *  POST /api/captcha/verify
 *       Body: { challenge_id: string, answer: string }
 *       Response: { success: boolean }
 *       - Looks up challenge_id, compares answer hash, marks used
 * ─────────────────────────────────────────────────────────
 * ============================================================
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ApiService } from '../api';

// Extend ApiService with CAPTCHA methods if not already defined
if (!ApiService.getCaptchaChallenge) {
    (ApiService as any).getCaptchaChallenge = async () => {
        const response = await fetch('/api/captcha/challenge', { method: 'GET' });
        if (!response.ok) throw new Error('Failed to fetch CAPTCHA challenge');
        return response.json();
    };
}

if (!ApiService.verifyCaptcha) {
    (ApiService as any).verifyCaptcha = async (payload: { challenge_id: string; answer: string }) => {
        const response = await fetch('/api/captcha/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error('CAPTCHA verification failed');
        return response.json();
    };
}

// ─── Types ──────────────────────────────────────────────────────────────────
interface CaptchaChallenge {
    challenge_id:  string;
    image_base64:  string; // Server-rendered base64 PNG of the CAPTCHA
}

// ─── Component ──────────────────────────────────────────────────────────────
export const CaptchaModal: React.FC = () => {
    const [isOpen,     setIsOpen    ] = useState(false);
    const [challenge,  setChallenge ] = useState<CaptchaChallenge | null>(null);
    const [userInput,  setUserInput ] = useState('');
    const [errorMsg,   setErrorMsg  ] = useState('');
    const [isLoading,  setIsLoading ] = useState(false);
    const [isFetching, setIsFetching] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // ── Fetch a fresh challenge from the server ──────────────────────────
    // NOTE: The challenge is generated SERVER-SIDE. The browser never sees
    // the answer — only an opaque challenge_id and a rendered image.
    const fetchChallenge = useCallback(async () => {
        setIsFetching(true);
        setErrorMsg('');
        setUserInput('');
        setChallenge(null);
        try {
            const data: CaptchaChallenge = await ApiService.getCaptchaChallenge();
            setChallenge(data);
        } catch {
            setErrorMsg('Failed to load security check. Please refresh the page.');
        } finally {
            setIsFetching(false);
        }
    }, []);

    // ── Open modal when IPS returns 428 ─────────────────────────────────
    useEffect(() => {
        const handleTrigger = () => {
            setIsOpen(true);
            fetchChallenge();
        };

        window.addEventListener('trigger-captcha', handleTrigger);
        return () => window.removeEventListener('trigger-captcha', handleTrigger);
    }, [fetchChallenge]);

    // ── Auto-focus input when challenge loads ────────────────────────────
    useEffect(() => {
        if (challenge && isOpen) {
            inputRef.current?.focus();
        }
    }, [challenge, isOpen]);

    // ── Submit answer to server for validation ───────────────────────────
    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!challenge || !userInput.trim()) return;

        setIsLoading(true);
        setErrorMsg('');

        try {
            const response = await ApiService.verifyCaptcha({
                challenge_id: challenge.challenge_id,
                answer:       userInput.trim().toUpperCase(),
            });

            if (response.success) {
                setIsOpen(false);
                setChallenge(null);
                setUserInput('');

                // Dispatch success event — let the calling page decide what to do.
                // Using a custom event is safer than window.location.reload()
                // which destroys all application state.
                window.dispatchEvent(new CustomEvent('captcha-verified'));
            } else {
                // Wrong answer — get a new challenge immediately (don't reuse old ones)
                setErrorMsg('Incorrect code. A new challenge has been generated.');
                await fetchChallenge();
            }
        } catch {
            setErrorMsg('Verification failed. Please check your connection and try again.');
            setIsLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div style={overlayStyle} role="dialog" aria-modal="true" aria-labelledby="captcha-title">
            <div style={modalStyle}>
                <h2 id="captcha-title" style={headingStyle}>⚠️ Security Check</h2>

                <p style={descriptionStyle}>
                    Unusual activity was detected from your connection. Please type the code
                    shown below to verify you are human.
                </p>

                {/* Server-rendered CAPTCHA image (no client-side generation) */}
                <div style={captchaContainerStyle} aria-label="CAPTCHA image">
                    {isFetching ? (
                        <div style={loadingStyle}>Loading challenge…</div>
                    ) : challenge?.image_base64 ? (
                        <img
                            src={`data:image/png;base64,${challenge.image_base64}`}
                            alt="CAPTCHA code — type the characters you see"
                            style={captchaImageStyle}
                            draggable={false}
                        />
                    ) : (
                        <div style={loadingStyle}>—</div>
                    )}
                </div>

                <button
                    type="button"
                    onClick={fetchChallenge}
                    disabled={isFetching || isLoading}
                    style={refreshButtonStyle}
                    aria-label="Get a new CAPTCHA challenge"
                >
                    🔄 New Code
                </button>

                <form onSubmit={handleVerify}>
                    <input
                        ref={inputRef}
                        type="text"
                        placeholder="Enter code here…"
                        value={userInput}
                        onChange={(e) => setUserInput(e.target.value)}
                        style={inputStyle}
                        disabled={isLoading || isFetching || !challenge}
                        autoComplete="off"
                        spellCheck={false}
                        maxLength={8}
                        aria-label="CAPTCHA answer"
                    />

                    {errorMsg && (
                        <p role="alert" style={errorTextStyle}>{errorMsg}</p>
                    )}

                    <button
                        type="submit"
                        style={{
                            ...buttonStyle,
                            opacity: (isLoading || !userInput || !challenge) ? 0.6 : 1,
                            cursor:  (isLoading || !userInput || !challenge) ? 'not-allowed' : 'pointer',
                        }}
                        disabled={isLoading || !userInput.trim() || !challenge || isFetching}
                    >
                        {isLoading ? 'Verifying…' : 'Unlock My Access'}
                    </button>
                </form>
            </div>
        </div>
    );
};

// ─── Styles ─────────────────────────────────────────────────────────────────
const overlayStyle: React.CSSProperties = {
    position:        'fixed',
    top:             0,
    left:            0,
    width:           '100%',
    height:          '100%',
    backgroundColor: 'rgba(0,0,0,0.85)',
    display:         'flex',
    justifyContent:  'center',
    alignItems:      'center',
    zIndex:          999999,
    backdropFilter:  'blur(4px)',
};

const modalStyle: React.CSSProperties = {
    backgroundColor: 'white',
    padding:         '30px',
    borderRadius:    '12px',
    textAlign:       'center',
    maxWidth:        '380px',
    width:           '90%',
    boxShadow:       '0 10px 25px rgba(0,0,0,0.5)',
    fontFamily:      'system-ui, sans-serif',
};

const headingStyle: React.CSSProperties = {
    color:  '#d97706',
    margin: '0 0 10px 0',
};

const descriptionStyle: React.CSSProperties = {
    marginBottom: '20px',
    color:        '#555',
    fontSize:     '14px',
    lineHeight:   '1.5',
};

const captchaContainerStyle: React.CSSProperties = {
    backgroundColor: '#f3f4f6',
    borderRadius:    '6px',
    minHeight:       '80px',
    display:         'flex',
    justifyContent:  'center',
    alignItems:      'center',
    marginBottom:    '10px',
    overflow:        'hidden',
    userSelect:      'none',
};

const captchaImageStyle: React.CSSProperties = {
    maxWidth:     '100%',
    height:       'auto',
    userSelect:   'none',
    pointerEvents:'none', // Prevent right-click save
};

const loadingStyle: React.CSSProperties = {
    color:    '#9ca3af',
    fontSize: '14px',
    padding:  '20px',
};

const refreshButtonStyle: React.CSSProperties = {
    background:   'none',
    border:       'none',
    color:        '#6b7280',
    fontSize:     '12px',
    cursor:       'pointer',
    marginBottom: '15px',
    padding:      '4px 8px',
    borderRadius: '4px',
};

const inputStyle: React.CSSProperties = {
    width:         '100%',
    padding:       '12px',
    fontSize:      '18px',
    textAlign:     'center',
    border:        '2px solid #d1d5db',
    borderRadius:  '6px',
    marginBottom:  '15px',
    outline:       'none',
    textTransform: 'uppercase',
    letterSpacing: '4px',
    boxSizing:     'border-box',
};

const buttonStyle: React.CSSProperties = {
    width:           '100%',
    backgroundColor: '#2563eb',
    color:           'white',
    padding:         '12px',
    border:          'none',
    borderRadius:    '6px',
    fontSize:        '16px',
    fontWeight:      'bold',
    transition:      'background-color 0.2s, opacity 0.2s',
};

const errorTextStyle: React.CSSProperties = {
    color:      '#dc2626',
    fontSize:   '13px',
    margin:     '-5px 0 12px 0',
    fontWeight: '500',
};