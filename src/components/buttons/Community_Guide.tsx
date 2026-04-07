import React, { useState, useEffect, useCallback, useRef } from 'react';
import './styles/Community_Guide.css';

export interface GuideStep {
  targetId: string;
  title: string;
  content: string;
  position: 'top' | 'bottom' | 'left' | 'right';
  mobileTargetId?: string;
}

interface CommunityGuideProps {
  isOpen: boolean;
  steps: GuideStep[];
  onComplete: () => void;
  onSkip: () => void;
}

const TOOLTIP_W = 320;
const TOOLTIP_H = 200;
const MOBILE_BREAKPOINT = 768;

const Community_Guide: React.FC<CommunityGuideProps> = ({
  isOpen,
  steps,
  onComplete,
  onSkip,
}) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect,  setTargetRect]  = useState<DOMRect | null>(null);
  const [winDims,     setWinDims]     = useState({ w: 0, h: 0 });
  const [isMobile,    setIsMobile]    = useState(false);
  const [animating,   setAnimating]   = useState(false);
  const [entering,    setEntering]    = useState(false);
  const pollTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // ── helpers ───────────────────────────────────────────────────────────
  const isMobileView = () =>
    typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT;

  const resolveElement = useCallback((step: GuideStep): HTMLElement | null => {
    const mobile = isMobileView();
    if (mobile && step.mobileTargetId) {
      const el = document.getElementById(step.mobileTargetId);
      if (el) return el;
    }
    let el = document.getElementById(step.targetId);
    if (el) return el;
    el = document.getElementById(`${step.targetId}-mobile`);
    if (el) return el;
    if (step.targetId === 'guide-add-btn') {
      const els = document.getElementsByClassName('BTN_ADD');
      if (els.length > 0) return els[0] as HTMLElement;
    }
    return null;
  }, []);

  // ── position update ───────────────────────────────────────────────────
  const updatePosition = useCallback(() => {
    if (!isOpen || !steps.length || currentStep >= steps.length) return;
    const step = steps[currentStep];
    const attempt = () => {
      const el = resolveElement(step);
      if (el) {
        if (!isMobileView()) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }
        setTimeout(() => setTargetRect(el.getBoundingClientRect()), 300);
      } else {
        setTargetRect(null);
        pollTimer.current = setTimeout(attempt, 500);
      }
    };
    attempt();
    return () => { if (pollTimer.current) clearTimeout(pollTimer.current); };
  }, [isOpen, currentStep, steps, resolveElement]);

  // ── resize ────────────────────────────────────────────────────────────
  useEffect(() => {
    const sync = () => {
      setWinDims({ w: window.innerWidth, h: window.innerHeight });
      setIsMobile(isMobileView());
      updatePosition();
    };
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, [updatePosition]);

  useEffect(() => { updatePosition(); }, [updatePosition]);

  // ── entrance animation trigger ────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setEntering(true);
      const t = setTimeout(() => setEntering(false), 500);
      return () => clearTimeout(t);
    }
  }, [isOpen, currentStep]);

  // ── desktop click-through ─────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen || !steps.length || currentStep >= steps.length || !targetRect || isMobile) return;
    const el = resolveElement(steps[currentStep]);
    if (!el) return;
    const handleClick = (e: Event) => { e.stopPropagation(); setTimeout(() => advance(), 200); };
    el.addEventListener('click', handleClick);
    const prevPos = el.style.position;
    const prevZ   = el.style.zIndex;
    el.style.position = prevPos === 'static' || !prevPos ? 'relative' : prevPos;
    el.style.zIndex   = '99999';
    cleanupRef.current = () => {
      el.removeEventListener('click', handleClick);
      el.style.zIndex   = prevZ;
      el.style.position = prevPos;
    };
    return () => { cleanupRef.current?.(); cleanupRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, currentStep, targetRect, isMobile]);

  // ── reset on close ────────────────────────────────────────────────────
  useEffect(() => { if (!isOpen) setCurrentStep(0); }, [isOpen, steps]);

  // ── navigation ────────────────────────────────────────────────────────
  const advance = () => {
    if (animating) return;
    setAnimating(true);
    setTimeout(() => {
      if (currentStep < steps.length - 1) {
        setCurrentStep(p => p + 1);
      } else {
        setCurrentStep(0);
        onComplete();
      }
      setAnimating(false);
    }, 200);
  };

  const skip = () => { cleanupRef.current?.(); setCurrentStep(0); onSkip(); };

  // ── guard ─────────────────────────────────────────────────────────────
  if (!isOpen || !steps.length || currentStep >= steps.length) return null;

  const guide    = steps[currentStep];
  const progress = ((currentStep + 1) / steps.length) * 100;
  const isLast   = currentStep === steps.length - 1;

  // ════════════════════════════════════════════════════════════════════
  // MOBILE — bottom sheet
  // ════════════════════════════════════════════════════════════════════
  if (isMobile) {
    return (
      <>
        <div className="guide-overlay" />

        {targetRect && (
          <div
            className="guide-spotlight"
            style={{
              top:    targetRect.top    - 8,
              left:   targetRect.left   - 8,
              width:  targetRect.width  + 16,
              height: targetRect.height + 16,
            }}
          />
        )}

        <div className={`guide-mobile-sheet${entering ? ' guide-entering' : ''}`}>
          <div className="guide-sheet-handle" />

          <div className="guide-progress-track">
            <div className="guide-progress-bar" style={{ width: `${progress}%` }} />
          </div>

          <div className="guide-sheet-body">
            <div className="guide-sheet-header">
              <div className="guide-step-badge">
                <span className="guide-step-icon">💡</span>
                <span>{currentStep + 1} of {steps.length}</span>
              </div>
              <button className="guide-close-btn" onClick={skip}>×</button>
            </div>

            <h4 className="guide-title">{guide.title}</h4>
            <p className="guide-content">{guide.content}</p>

            <div className="guide-dots">
              {steps.map((_, i) => (
                <span
                  key={i}
                  className={`guide-dot${i === currentStep ? ' active' : ''}${i < currentStep ? ' done' : ''}`}
                />
              ))}
            </div>

            <div className="guide-mobile-actions">
              <button className="guide-skip-btn" onClick={skip}>Skip Tour</button>
              <button className={`guide-next-btn${isLast ? ' guide-finish-btn' : ''}`} onClick={advance}>
                <span>{isLast ? 'Finish' : 'Next'}</span>
                <span className="guide-btn-icon">{isLast ? '✓' : '→'}</span>
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ════════════════════════════════════════════════════════════════════
  // DESKTOP — floating tooltip
  // ════════════════════════════════════════════════════════════════════
  if (!targetRect) {
    return <div className="guide-overlay" style={{ pointerEvents: 'none' }} />;
  }

  let tTop  = targetRect.bottom + 16;
  let tLeft = targetRect.left + targetRect.width / 2 - TOOLTIP_W / 2;

  switch (guide.position) {
    case 'top':
      tTop  = targetRect.top - TOOLTIP_H - 16;
      break;
    case 'left':
      tTop  = targetRect.top + targetRect.height / 2 - TOOLTIP_H / 2;
      tLeft = targetRect.left - TOOLTIP_W - 16;
      break;
    case 'right':
      tTop  = targetRect.top + targetRect.height / 2 - TOOLTIP_H / 2;
      tLeft = targetRect.right + 16;
      break;
  }

  if (tLeft < 12)                          tLeft = 12;
  if (tLeft + TOOLTIP_W > winDims.w - 12)  tLeft = winDims.w - TOOLTIP_W - 12;
  if (tTop  < 12)                          tTop  = targetRect.bottom + 16;
  if (tTop  + TOOLTIP_H > winDims.h - 12)  tTop  = targetRect.top - TOOLTIP_H - 16;

  const arrowDir =
    guide.position === 'bottom' ? 'top' :
    guide.position === 'top'    ? 'bottom' :
    guide.position === 'left'   ? 'right' : 'left';

  return (
    <>
      <div className="guide-overlay" style={{ pointerEvents: 'none' }} />

      <div
        className="guide-spotlight"
        style={{
          top:    targetRect.top    - 8,
          left:   targetRect.left   - 8,
          width:  targetRect.width  + 16,
          height: targetRect.height + 16,
        }}
      />

      <div
        className={`guide-tooltip guide-arrow-${arrowDir}${entering ? ' guide-entering' : ''}`}
        style={{ top: tTop, left: tLeft, width: TOOLTIP_W }}
      >
        {/* accent bar */}
        <div className="guide-tooltip-bar" />

        <div className="guide-tooltip-inner">
          <div className="guide-tooltip-header">
            <div className="guide-step-badge">
              <span className="guide-step-icon">💡</span>
              <span>Step {currentStep + 1} of {steps.length}</span>
            </div>
            <button className="guide-close-btn" onClick={skip} title="Close">×</button>
          </div>

          <h4 className="guide-title">{guide.title}</h4>
          <p className="guide-content">{guide.content}</p>

          <div className="guide-dots">
            {steps.map((_, i) => (
              <span
                key={i}
                className={`guide-dot${i === currentStep ? ' active' : ''}${i < currentStep ? ' done' : ''}`}
              />
            ))}
          </div>

          <div className="guide-footer">
            <button className="guide-skip-btn" onClick={skip}>Skip</button>
            <button className={`guide-next-btn${isLast ? ' guide-finish-btn' : ''}`} onClick={advance}>
              <span>{isLast ? 'Finish' : 'Next'}</span>
              <span className="guide-btn-icon">{isLast ? '✓' : '→'}</span>
            </button>
          </div>

          <p className="guide-click-hint">or click the highlighted area to advance</p>
        </div>

        <div className="guide-progress-track">
          <div className="guide-progress-bar" style={{ width: `${progress}%` }} />
        </div>
      </div>
    </>
  );
};

export default Community_Guide;