/**
 * ============================================================
 * CaptchaModal.tsx — Adaptive "Are you human?" Security Gateway
 * ============================================================
 * Professional Risk-Adaptive Architecture (Cloudflare Turnstile style):
 *
 * Tier 1: "I am human" Checkbox Challenge
 *  • User clicks the interactive verification box.
 *  • Telemetry & IP risk evaluation against /api/captcha/evaluate.
 *  • If connection is normal / LOW risk:
 *      Instantly verifies with green checkmark [✓] and restores access.
 *
 * Tier 2: Step-Up Jigsaw Slider Puzzle
 *  • ONLY triggers if the connection is flagged as:
 *      LOCKED, CRITICAL, ANOMALOUS, or UNKNOWN bot behavior.
 *  • Accordion smoothly unfolds the 15-image scenic jigsaw puzzle.
 *  • User slides the piece into place to unlock their IP across cluster.
 * ============================================================
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { ShieldCheck, RotateCw, X, ArrowRight, CheckCircle2, AlertTriangle, Check } from 'lucide-react';
import './CaptchaModal.css';

interface ChallengeData {
  challengeId: string;
  imageUrl: string;
  targetX: number;
  targetY: number;
  width: number;
  height: number;
  pieceSize: number;
}

interface PointerCoord {
  x: number;
  y: number;
  t: number;
}

export const CaptchaModal: React.FC = () => {
  // Modal visibility
  const [isOpen, setIsOpen] = useState(false);

  // Checkbox state: 'unchecked' | 'evaluating' | 'verified' | 'stepup'
  const [checkboxState, setCheckboxState] = useState<'unchecked' | 'evaluating' | 'verified' | 'stepup'>('unchecked');

  // Puzzle state: whether Tier 2 accordion is expanded
  const [showPuzzle, setShowPuzzle] = useState(false);
  const [puzzleLoading, setPuzzleLoading] = useState(false);
  const [puzzleVerifying, setPuzzleVerifying] = useState(false);
  const [challenge, setChallenge] = useState<ChallengeData | null>(null);
  const [sliderPos, setSliderPos] = useState(0); // 0 to MAX_SLIDER
  const [isDragging, setIsDragging] = useState(false);
  const [puzzleStatus, setPuzzleStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [puzzleMsg, setPuzzleMsg] = useState('');
  const [shake, setShake] = useState(false);

  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pieceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sliderTrackRef = useRef<HTMLDivElement | null>(null);
  const imageObjRef = useRef<HTMLImageElement | null>(null);
  const dragStartRef = useRef<{ startMouseX: number; startPos: number }>({ startMouseX: 0, startPos: 0 });
  const trailRef = useRef<PointerCoord[]>([]);

  const CANVAS_WIDTH = 320;
  const CANVAS_HEIGHT = 160;
  const PIECE_SIZE = 44;
  const HANDLE_SIZE = 40;
  const MAX_SLIDER = CANVAS_WIDTH - HANDLE_SIZE - 4; // 276px

  // 1. Draw Jigsaw Path
  const drawJigsawPath = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => {
    const tabRadius = size * 0.22;
    ctx.beginPath();
    ctx.moveTo(x, y);

    // Top
    ctx.lineTo(x + size * 0.5 - tabRadius, y);
    ctx.arc(x + size * 0.5, y - tabRadius * 0.6, tabRadius, Math.PI, 0, false);
    ctx.lineTo(x + size, y);

    // Right
    ctx.lineTo(x + size, y + size * 0.5 - tabRadius);
    ctx.arc(x + size + tabRadius * 0.6, y + size * 0.5, tabRadius, 1.5 * Math.PI, 0.5 * Math.PI, false);
    ctx.lineTo(x + size, y + size);

    // Bottom
    ctx.lineTo(x + size * 0.5 + tabRadius, y + size);
    ctx.arc(x + size * 0.5, y + size - tabRadius * 0.6, tabRadius, 0, Math.PI, true);
    ctx.lineTo(x, y + size);

    // Left
    ctx.lineTo(x, y + size * 0.5 + tabRadius);
    ctx.arc(x - tabRadius * 0.6, y + size * 0.5, tabRadius, 0.5 * Math.PI, 1.5 * Math.PI, true);
    ctx.closePath();
  };

  // 2. Render Background with Cutout Hole
  const renderBackground = useCallback((img: HTMLImageElement, ch: ChallengeData) => {
    const canvas = bgCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.drawImage(img, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Dark slot silhouette with cyan neon outline
    ctx.save();
    drawJigsawPath(ctx, ch.targetX, ch.targetY, PIECE_SIZE);
    ctx.fillStyle = 'rgba(8, 14, 28, 0.75)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#38bdf8';
    ctx.shadowColor = '#0284c7';
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.restore();
  }, []);

  // 3. Render Floating Cutout Piece
  const renderPiece = useCallback((img: HTMLImageElement, ch: ChallengeData, currentX: number) => {
    const canvas = pieceCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.save();
    drawJigsawPath(ctx, currentX, ch.targetY, PIECE_SIZE);
    ctx.clip();

    ctx.drawImage(img, currentX - ch.targetX, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#38bdf8';
    ctx.shadowColor = '#38bdf8';
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.restore();
  }, []);

  // 4. Fetch Challenge Image & Target Coordinates from Server
  const fetchPuzzleChallenge = async () => {
    setPuzzleLoading(true);
    setPuzzleStatus('idle');
    setPuzzleMsg('');
    setSliderPos(0);
    trailRef.current = [];

    try {
      const res = await fetch('/api/captcha/challenge', {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        credentials: 'include'
      });

      if (!res.ok) throw new Error('Challenge request rejected');
      const data: ChallengeData = await res.json();
      setChallenge(data);

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = data.imageUrl;
      img.onload = () => {
        imageObjRef.current = img;
        renderBackground(img, data);
        renderPiece(img, data, 0);
        setPuzzleLoading(false);
      };
      img.onerror = () => {
        setPuzzleLoading(false);
      };
    } catch (err) {
      console.error('[CAPTCHA] Failed to fetch puzzle challenge:', err);
      setPuzzleStatus('error');
      setPuzzleMsg('Could not load puzzle image. Try refreshing.');
      setPuzzleLoading(false);
    }
  };

  // 5. Checkbox Click: Evaluate Connection Risk
  const handleCheckboxClick = async () => {
    if (checkboxState === 'evaluating' || checkboxState === 'verified') return;

    setCheckboxState('evaluating');
    setPuzzleStatus('idle');
    setPuzzleMsg('');

    try {
      // Evaluate connection risk with the backend
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
        // Elevated / Critical Risk: Step-up to interactive puzzle!
        setCheckboxState('stepup');
        setShowPuzzle(true);
        fetchPuzzleChallenge();
      } else {
        // Low Risk: Instant verification
        setCheckboxState('verified');
        window.dispatchEvent(new CustomEvent('captcha-verified'));

        setTimeout(() => {
          setIsOpen(false);
          setCheckboxState('unchecked');
          setShowPuzzle(false);
        }, 750);
      }
    } catch (err) {
      // On network failure, default to puzzle verification to be safe
      setCheckboxState('stepup');
      setShowPuzzle(true);
      fetchPuzzleChallenge();
    }
  };

  // 6. Natural Trigger Listener: Fires on HTTP 428 or 'trigger-captcha'
  useEffect(() => {
    const onTrigger = (e: any) => {
      const detail = e?.detail || {};
      setIsOpen(true);
      setCheckboxState('unchecked');

      if (detail.forcePuzzle) {
        // Immediately expand puzzle if requested
        setCheckboxState('stepup');
        setShowPuzzle(true);
        fetchPuzzleChallenge();
      } else {
        // Show clean "I am human" checkbox first
        setShowPuzzle(false);
      }
    };

    window.addEventListener('trigger-captcha', onTrigger);
    window.addEventListener('open-captcha', onTrigger);

    return () => {
      window.removeEventListener('trigger-captcha', onTrigger);
      window.removeEventListener('open-captcha', onTrigger);
    };
  }, []);

  // 7. Update Piece Position during dragging
  useEffect(() => {
    if (!challenge || !imageObjRef.current) return;
    const canvasX = (sliderPos / MAX_SLIDER) * (CANVAS_WIDTH - PIECE_SIZE);
    renderPiece(imageObjRef.current, challenge, canvasX);
  }, [sliderPos, challenge, renderPiece]);

  // 8. Pointer Drag Handlers (Mouse + Touch)
  const handlePointerDown = (e: React.PointerEvent) => {
    if (puzzleLoading || puzzleVerifying || puzzleStatus === 'success') return;
    setIsDragging(true);
    setPuzzleStatus('idle');
    setPuzzleMsg('');
    dragStartRef.current = { startMouseX: e.clientX, startPos: sliderPos };
    trailRef.current = [{ x: e.clientX, y: e.clientY, t: Date.now() }];
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const deltaX = e.clientX - dragStartRef.current.startMouseX;
    const newPos = Math.max(0, Math.min(MAX_SLIDER, dragStartRef.current.startPos + deltaX));
    setSliderPos(newPos);
    trailRef.current.push({ x: e.clientX, y: e.clientY, t: Date.now() });
  };

  const handlePointerUp = async (e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);

    if (!challenge) return;

    const finalPieceX = (sliderPos / MAX_SLIDER) * (CANVAS_WIDTH - PIECE_SIZE);
    setPuzzleVerifying(true);

    try {
      const res = await fetch('/api/captcha/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          userX: Math.round(finalPieceX),
          trail: trailRef.current
        })
      });

      const result = await res.json();

      if (res.ok && result.success) {
        setPuzzleStatus('success');
        setPuzzleMsg('Verified! Connection restored.');
        setCheckboxState('verified');

        // Signal api.ts to retry pending network actions
        window.dispatchEvent(new CustomEvent('captcha-verified'));

        setTimeout(() => {
          setIsOpen(false);
          setCheckboxState('unchecked');
          setShowPuzzle(false);
          setPuzzleVerifying(false);
        }, 850);
      } else {
        triggerError(result.message || 'Puzzle misaligned. Try again.');
      }
    } catch {
      triggerError('Network error verifying puzzle. Retrying...');
    } finally {
      setPuzzleVerifying(false);
    }
  };

  const triggerError = (msg: string) => {
    setPuzzleStatus('error');
    setPuzzleMsg(msg);
    setShake(true);
    setTimeout(() => setShake(false), 500);
    setTimeout(() => {
      setSliderPos(0);
      setPuzzleStatus('idle');
      setPuzzleMsg('');
    }, 1100);
  };

  if (!isOpen) return null;

  return (
    <div className="captcha-modal-overlay" role="dialog" aria-modal="true">
      <div className={`captcha-card ${shake ? 'error-shake' : ''}`}>
        {/* Header */}
        <div className="captcha-header">
          <div>
            <div className="captcha-badge">
              <span className="captcha-badge-dot" />
              {showPuzzle ? 'Step-Up Challenge // Level 2' : 'Security Check // Pagsusuri'}
            </div>
            <h3 className="captcha-title">
              <ShieldCheck size={20} color="#38bdf8" />
              Connection Security
            </h3>
            <p className="captcha-subtitle">
              {showPuzzle
                ? 'High risk or anomaly detected. Slide the puzzle piece to restore access.'
                : 'Unusual network activity detected on your connection. Please verify below.'}
            </p>
          </div>
          <button
            className="captcha-close-btn"
            onClick={() => setIsOpen(false)}
            title="Close"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* 🔘 TIER 1: "ARE YOU HUMAN" CHECKBOX WIDGET */}
        <div
          className={`captcha-checkbox-card ${checkboxState === 'verified' ? 'is-verified' : ''} ${checkboxState === 'stepup' ? 'is-stepup' : ''}`}
          onClick={handleCheckboxClick}
        >
          <div className="captcha-checkbox-left">
            <div className={`captcha-checkbox-box ${checkboxState}`}>
              {checkboxState === 'verified' && <Check size={16} strokeWidth={3} />}
              {checkboxState === 'stepup' && <AlertTriangle size={14} />}
            </div>
            <div className="captcha-checkbox-label">
              <span>I am human // Tao po ako</span>
              <span className="captcha-checkbox-sub">
                {checkboxState === 'evaluating' && 'Evaluating connection signals...'}
                {checkboxState === 'verified' && 'Verification successful. Access granted.'}
                {checkboxState === 'stepup' && 'Critical check required: solve puzzle below'}
                {checkboxState === 'unchecked' && 'Click to verify connection security'}
              </span>
            </div>
          </div>

          <div className="captcha-checkbox-right">
            <span className="captcha-turnstile-logo">
              <ShieldCheck size={12} />
              SmartBarangay
            </span>
            <span className="captcha-turnstile-privacy">Privacy • Terms</span>
          </div>
        </div>

        {/* 🧩 TIER 2: STEP-UP JIGSAW PUZZLE SECTION (ACCORDION) */}
        <div className={`captcha-puzzle-section ${showPuzzle ? 'is-expanded' : ''}`}>
          <div className="captcha-stepup-alert">
            <AlertTriangle size={14} />
            <span>Connection flagged by firewall. Slide puzzle piece into the missing slot:</span>
          </div>

          <div className="captcha-viewport">
            <canvas
              ref={bgCanvasRef}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              className="captcha-bg-canvas"
            />
            <canvas
              ref={pieceCanvasRef}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              className="captcha-piece-canvas"
            />

            <button
              className="captcha-refresh-btn"
              onClick={fetchPuzzleChallenge}
              disabled={puzzleLoading || puzzleVerifying}
              title="Load another image"
            >
              <RotateCw size={14} />
            </button>

            {(puzzleLoading || puzzleVerifying) && (
              <div className="captcha-loading-overlay">
                <div className="captcha-spinner" />
                <span>{puzzleVerifying ? 'Verifying alignment...' : 'Loading safe puzzle image...'}</span>
              </div>
            )}
          </div>

          {/* Slider Control */}
          <div className="captcha-slider-container" ref={sliderTrackRef}>
            <div
              className="captcha-slider-progress"
              style={{ width: `${sliderPos + HANDLE_SIZE * 0.5}px` }}
            />

            <div
              className="captcha-slider-text"
              style={{ opacity: isDragging || sliderPos > 20 ? 0 : 1 }}
            >
              Slide to complete the puzzle →
            </div>

            <div
              className={`captcha-slider-handle ${puzzleStatus}`}
              style={{ transform: `translateX(${sliderPos}px)` }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            >
              {puzzleStatus === 'success' ? (
                <CheckCircle2 size={18} color="#ffffff" />
              ) : puzzleStatus === 'error' ? (
                <AlertTriangle size={18} color="#ffffff" />
              ) : (
                <ArrowRight size={18} />
              )}
            </div>
          </div>

          {/* Status Message */}
          {puzzleMsg && (
            <div className={`captcha-status-msg ${puzzleStatus}`}>
              {puzzleStatus === 'success' ? (
                <CheckCircle2 size={16} />
              ) : (
                <AlertTriangle size={16} />
              )}
              <span>{puzzleMsg}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="captcha-footer">
          <span>Intrusion Prevention Gateway</span>
          <span className="captcha-footer-link">Baguio City e-Governance</span>
        </div>
      </div>
    </div>
  );
};