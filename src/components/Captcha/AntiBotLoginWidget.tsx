/**
 * ============================================================
 * AntiBotLoginWidget.tsx — In-Form Adaptive Anti-Bot Checkbox
 * ============================================================
 * Placed directly in Official & Resident Login forms.
 * Only appears when bot behavior, failed attempts, or connection
 * anomalies are detected.
 *
 * Flow:
 *  1. Normal clean login: Hidden (0 friction).
 *  2. Failed attempts / bot signals: Slides in smoothly.
 *  3. User clicks [ ] I am human:
 *      • Low risk -> Checked [✓] instantly.
 *      • Critical / Locked / Bot -> Step-up Slider Puzzle opens.
 * ============================================================
 */

import React, { useState, useEffect } from 'react';
import { Check, AlertTriangle } from 'lucide-react';
import './AntiBotLoginWidget.css';

interface AntiBotLoginWidgetProps {
  visible: boolean;
  isVerified: boolean;
  onVerified: () => void;
  theme?: 'light' | 'dark';
}

export const AntiBotLoginWidget: React.FC<AntiBotLoginWidgetProps> = ({
  visible,
  isVerified,
  onVerified,
}) => {
  const [evaluating, setEvaluating] = useState(false);
  const [stepUpNeeded, setStepUpNeeded] = useState(false);

  // Listen for global puzzle completion
  useEffect(() => {
    const handleGlobalVerified = () => {
      setEvaluating(false);
      setStepUpNeeded(false);
      onVerified();
    };

    window.addEventListener('captcha-verified', handleGlobalVerified);
    return () => window.removeEventListener('captcha-verified', handleGlobalVerified);
  }, [onVerified]);

  if (!visible) return null;

  const handleClick = async () => {
    if (isVerified || evaluating) return;

    setEvaluating(true);

    try {
      const res = await fetch('/api/captcha/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          platform: navigator.platform,
          userAgent: navigator.userAgent
        })
      });

      const data = await res.json();

      if (data.requiresPuzzle) {
        // High risk or firewall lock: Open the step-up puzzle modal
        setStepUpNeeded(true);
        setEvaluating(false);
        window.dispatchEvent(new CustomEvent('trigger-captcha', { detail: { forcePuzzle: true } }));
      } else {
        // Normal human: Instant verification
        setEvaluating(false);
        setStepUpNeeded(false);
        onVerified();
      }
    } catch {
      // Fallback to step-up challenge on network failure
      setStepUpNeeded(true);
      setEvaluating(false);
      window.dispatchEvent(new CustomEvent('trigger-captcha', { detail: { forcePuzzle: true } }));
    }
  };

  return (
    <div className="cf-turnstile-wrapper">
      <div
        className={`cf-turnstile-box ${isVerified ? 'verified' : ''} ${stepUpNeeded ? 'stepup' : ''}`}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        aria-label="Verify you are human"
      >
        {/* Left: Checkbox & Label */}
        <div className="cf-turnstile-left">
          <div
            className={`cf-turnstile-checkbox ${evaluating ? 'evaluating' : ''} ${isVerified ? 'verified' : ''} ${stepUpNeeded ? 'stepup' : ''}`}
          >
            {isVerified && <Check size={18} strokeWidth={3} color="#22c55e" />}
            {stepUpNeeded && !isVerified && <AlertTriangle size={15} color="#f59e0b" />}
          </div>

          <span className="cf-turnstile-label">
            {evaluating ? 'Verifying...' : 'Verify you are human'}
          </span>
        </div>

        {/* Right: SmartBarangay Logo + Brand + Links */}
        <div className="cf-turnstile-right">
          <div className="cf-turnstile-logo">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2.5L4.5 5.8V11.2C4.5 16.3 7.7 20.3 12 21.5C16.3 20.3 19.5 16.3 19.5 11.2V5.8L12 2.5Z" fill="#F6821F" stroke="#E66A05" strokeWidth="1.2" strokeLinejoin="round"/>
              <path d="M8.8 11.5L11 13.8L15.2 9.5" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>

          <span className="cf-turnstile-brand">SMARTBARANGAY</span>

          <div className="cf-turnstile-links">
            <a href="#privacy" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>Privacy</a>
            <span className="cf-turnstile-bullet">•</span>
            <a href="#help" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>Help</a>
          </div>
        </div>
      </div>
    </div>
  );
};