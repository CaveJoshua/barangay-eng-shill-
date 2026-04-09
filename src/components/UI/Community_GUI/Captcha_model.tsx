import React, { useState, useEffect } from 'react';
import { ApiService } from '../api'; // Ensure this points to where you configure Axios

// Helper to generate a random 6-character string
const generateCaptchaText = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed O, 0, 1, I for readability
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

export const CaptchaModal = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [captchaCode, setCaptchaCode] = useState('');
    const [userInput, setUserInput] = useState('');
    const [errorMsg, setErrorMsg] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    // 🚨 TRIPWIRE 1: Proves the component is actually loaded by React
    console.log("🛡️ CaptchaModal is currently mounted and active on this page.");

    useEffect(() => {
        // Listen for the 428 error from our Catcher
        const handleTrigger = () => {
            // 🚨 TRIPWIRE 2: Proves the event was successfully heard
            console.log("🔴 EVENT RECEIVED: Opening Captcha Modal!");
            
            setCaptchaCode(generateCaptchaText()); // Generate new code
            setUserInput(''); // Clear old input
            setErrorMsg('');
            setIsOpen(true);
        };
        
        window.addEventListener('trigger-captcha', handleTrigger);
        return () => window.removeEventListener('trigger-captcha', handleTrigger);
    }, []);

    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        
        // 1. Check if they typed it correctly
        if (userInput.toUpperCase() !== captchaCode) {
            setErrorMsg("Incorrect code. Try again.");
            setCaptchaCode(generateCaptchaText()); // Reset code on failure
            setUserInput('');
            return;
        }

        // 2. If correct, send the unlock request to the backend
        setIsLoading(true);
        setErrorMsg('');
        
        try {
            const response = await ApiService.verifyCaptcha('human-verified-token');
            
            if (response.success) {
                // 3. Success! Close modal and reload
                setIsOpen(false);
                window.location.reload(); 
            } else {
                setErrorMsg(response.error || "Verification failed. Please try again.");
                setCaptchaCode(generateCaptchaText());
                setUserInput('');
                setIsLoading(false);
            }
        } catch (error) {
            console.error("Failed to verify:", error);
            setErrorMsg("Server rejected verification. Are you still connected?");
            setIsLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div style={overlayStyle}>
            <div style={modalStyle}>
                <h2 style={{ color: '#d97706', margin: '0 0 10px 0' }}>⚠️ Security Check</h2>
                <p style={{ marginBottom: '20px', color: '#555', fontSize: '14px' }}>
                    Unusual traffic detected. Please type the code below to prove you are human.
                </p>
                
                {/* The Visual CAPTCHA Code */}
                <div style={captchaBoxStyle}>
                    {captchaCode}
                </div>

                <form onSubmit={handleVerify}>
                    <input 
                        type="text" 
                        placeholder="Enter code here..." 
                        value={userInput}
                        onChange={(e) => setUserInput(e.target.value)}
                        style={inputStyle}
                        disabled={isLoading}
                        autoFocus
                    />
                    
                    {errorMsg && <p style={errorTextStyle}>{errorMsg}</p>}

                    <button type="submit" style={buttonStyle} disabled={isLoading || !userInput}>
                        {isLoading ? 'Verifying...' : 'Unlock My Access'}
                    </button>
                </form>
            </div>
        </div>
    );
};

// --- Styles ---
const overlayStyle: React.CSSProperties = {
    // 🚨 INCREASED Z-INDEX EXTREMELY HIGH TO PREVENT HIDING BEHIND UI
    position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
    backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex',
    justifyContent: 'center', alignItems: 'center', zIndex: 999999, backdropFilter: 'blur(4px)'
};

const modalStyle: React.CSSProperties = {
    backgroundColor: 'white', padding: '30px', borderRadius: '12px',
    textAlign: 'center', maxWidth: '350px', width: '90%',
    boxShadow: '0 10px 25px rgba(0,0,0,0.5)', fontFamily: 'system-ui, sans-serif'
};

const captchaBoxStyle: React.CSSProperties = {
    backgroundColor: '#f3f4f6', padding: '15px', borderRadius: '6px',
    fontSize: '28px', fontWeight: 'bold', letterSpacing: '8px',
    color: '#1f2937', marginBottom: '20px', userSelect: 'none',
    backgroundImage: 'linear-gradient(45deg, #e5e7eb 25%, transparent 25%, transparent 75%, #e5e7eb 75%, #e5e7eb), linear-gradient(45deg, #e5e7eb 25%, transparent 25%, transparent 75%, #e5e7eb 75%, #e5e7eb)',
    backgroundSize: '20px 20px', backgroundPosition: '0 0, 10px 10px'
};

const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px', fontSize: '18px', textAlign: 'center',
    border: '2px solid #d1d5db', borderRadius: '6px', marginBottom: '15px',
    outline: 'none', textTransform: 'uppercase'
};

const buttonStyle: React.CSSProperties = {
    width: '100%', backgroundColor: '#2563eb', color: 'white', padding: '12px',
    border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '16px', 
    fontWeight: 'bold', transition: 'background-color 0.2s'
};

const errorTextStyle: React.CSSProperties = {
    color: '#dc2626', fontSize: '14px', margin: '-5px 0 15px 0', fontWeight: '500'
};