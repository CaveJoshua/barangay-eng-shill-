import { useState, useEffect, useRef, useCallback } from 'react';
import './styles/VerifyChainModal.css';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface IVerifiableResident {
  id?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  dob?: string;
  genesisHash?: string;
}

export type ChainStatus = 'idle' | 'scanning' | 'valid' | 'compromised';

interface LogEntry {
  id: number;
  text: string;
  type: 'info' | 'success' | 'error' | 'warning' | 'result';
}

interface VerifyChainModalProps {
  isOpen: boolean;
  onClose: () => void;
  residents: IVerifiableResident[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function classifyLog(text: string): LogEntry['type'] {
  if (text.includes('❌') || text.includes('🔴') || text.includes('TAMPER') || text.includes('ERROR')) return 'error';
  if (text.includes('⚠️') || text.includes('SKIPPED') || text.includes('WARN')) return 'warning';
  if (text.includes('✅') || text.includes('🟢') || text.includes('SECURE') || text.includes('OK')) return 'success';
  if (text.includes('[RESULT]')) return 'result';
  return 'info';
}

let logCounter = 0;
function makeLog(text: string): LogEntry {
  return { id: logCounter++, text, type: classifyLog(text) };
}

// ─── Component ────────────────────────────────────────────────────────────────
export function VerifyChainModal({ isOpen, onClose, residents }: VerifyChainModalProps) {
  const [status, setStatus] = useState<ChainStatus>('idle');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isVerifying, setIsVerifying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<{ total: number; verified: number; skipped: number; compromised: number } | null>(null);

  const terminalRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(false);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  // Reset when modal opens
  useEffect(() => {
    if (isOpen) {
      setStatus('idle');
      setLogs([]);
      setProgress(0);
      setSummary(null);
      cancelRef.current = false;
    }
  }, [isOpen]);

  // Block page unload during verification
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isVerifying) {
        const msg = 'Warning: Ledger verification in progress. Closing now is unsafe.';
        e.preventDefault();
        e.returnValue = msg;
        return msg;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isVerifying]);

  const appendLog = useCallback((text: string) => {
    setLogs(prev => [...prev, makeLog(text)]);
  }, []);

  // ── Core Verification Logic ─────────────────────────────────────────────────
  const startVerification = useCallback(async () => {
    cancelRef.current = false;
    setStatus('scanning');
    setIsVerifying(true);
    setLogs([makeLog('[SYSTEM] Initializing Ledger Integrity Engine v2.0...')]);
    setProgress(0);
    setSummary(null);

    await new Promise(r => setTimeout(r, 400));

    // Guard: data
    if (residents.length === 0) {
      setLogs(prev => [...prev, makeLog('❌ [ERROR] No resident records found in memory. Scan aborted.')]);
      setStatus('compromised');
      setIsVerifying(false);
      return;
    }

    // Guard: secure context
    if (!window.isSecureContext || !crypto.subtle) {
      setLogs(prev => [
        ...prev,
        makeLog('❌ [CRITICAL] WebCrypto API is unavailable.'),
        makeLog('ℹ️  [REASON] A Secure Context (HTTPS or localhost) is required.'),
        makeLog('⚠️  Verification cannot proceed over insecure HTTP.'),
      ]);
      setStatus('compromised');
      setIsVerifying(false);
      return;
    }

    appendLog(`[SYSTEM] Auditing ${residents.length} identity blocks...`);
    await new Promise(r => setTimeout(r, 600));

    let compromisedCount = 0;
    let skippedCount = 0;
    let verifiedCount = 0;
    const batch: LogEntry[] = [];

    for (let i = 0; i < residents.length; i++) {
      if (cancelRef.current) {
        setLogs(prev => [...prev, makeLog('⚠️ [CANCELLED] Verification was stopped by user.')]);
        setStatus('idle');
        setIsVerifying(false);
        return;
      }

      const res = residents[i];

      if (!res.genesisHash) {
        skippedCount++;
        batch.push(makeLog(`⚠️ [SKIPPED] Block ${res.id?.substring(0, 8) ?? 'UNKNOWN'} — Legacy Record (No Hash).`));
      } else {
        // Normalization must mirror backend exactly
        const normalized = `${res.firstName?.trim().toLowerCase()}|${res.middleName?.trim().toLowerCase()}|${res.lastName?.trim().toLowerCase()}|${res.dob}`
          .replace(/\s+/g, '');

        const msgBuffer = new TextEncoder().encode(normalized);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const computedHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        if (computedHash !== res.genesisHash) {
          compromisedCount++;
          batch.push(makeLog(`❌ [TAMPER DETECTED] Block ${res.id?.substring(0, 8)}: Hash Mismatch!`));
          batch.push(makeLog(`   ↳ Expected : ${res.genesisHash.substring(0, 16)}...`));
          batch.push(makeLog(`   ↳ Computed : ${computedHash.substring(0, 16)}...`));
        } else {
          verifiedCount++;
          if (i % 15 === 0 || i === residents.length - 1) {
            batch.push(makeLog(`✅ [VERIFIED] Block ${res.id?.substring(0, 8)} — Signature matches.`));
          }
        }
      }

      // Flush batch every 10 records to prevent UI freeze
      if (i % 10 === 0 || i === residents.length - 1) {
        const flushed = [...batch];
        setLogs(prev => [...prev, ...flushed]);
        batch.length = 0;
      }

      setProgress(Math.round(((i + 1) / residents.length) * 100));
      // Yield to browser
      if (i % 5 === 0) await new Promise(r => setTimeout(r, 0));
    }

    const finalStatus = compromisedCount === 0 ? 'valid' : 'compromised';
    const resultLine = compromisedCount === 0
      ? `[RESULT] 🟢 CHAIN SECURE — All ${verifiedCount} signed blocks match their cryptographic signatures.`
      : `[RESULT] 🔴 INTEGRITY FAILED — ${compromisedCount} tampered record(s) detected.`;

    setLogs(prev => [...prev, makeLog(''), makeLog(resultLine)]);
    setSummary({ total: residents.length, verified: verifiedCount, skipped: skippedCount, compromised: compromisedCount });
    setStatus(finalStatus);
    setIsVerifying(false);
    setProgress(100);
  }, [residents, appendLog]);

  const handleCancel = () => {
    cancelRef.current = true;
  };

  const handleClose = () => {
    if (isVerifying) {
      if (!window.confirm('Verification is still running. Cancel and close?')) return;
      cancelRef.current = true;
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="VCM_BACKDROP" onClick={handleClose}>
      <div className="VCM_MODAL" onClick={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="VCM_HEADER">
          <div className="VCM_HEADER_LEFT">
            <div className={`VCM_ICON_RING ${status === 'scanning' ? 'scanning' : status === 'valid' ? 'valid' : status === 'compromised' ? 'compromised' : ''}`}>
              <i className={`fas fa-link ${status === 'scanning' ? 'fa-spin' : ''}`}></i>
            </div>
            <div>
              <h2 className="VCM_TITLE">Ledger Integrity Scanner</h2>
              <p className="VCM_SUBTITLE">Cryptographic block-by-block verification</p>
            </div>
          </div>
          <button className="VCM_CLOSE_BTN" onClick={handleClose} disabled={isVerifying && !cancelRef.current}>
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* ── Status Badge ── */}
        <div className="VCM_STATUS_ROW">
          <div className={`VCM_STATUS_BADGE ${status}`}>
            {status === 'idle' && <><i className="fas fa-circle-dot"></i> Ready to Scan</>}
            {status === 'scanning' && <><i className="fas fa-spinner fa-spin"></i> Scanning in Progress</>}
            {status === 'valid' && <><i className="fas fa-shield-halved"></i> Chain Secure</>}
            {status === 'compromised' && <><i className="fas fa-triangle-exclamation"></i> Integrity Compromised</>}
          </div>
          <span className="VCM_RECORD_COUNT">
            <i className="fas fa-database"></i> {residents.length} records
          </span>
        </div>

        {/* ── Progress Bar ── */}
        {status !== 'idle' && (
          <div className="VCM_PROGRESS_WRAP">
            <div className="VCM_PROGRESS_TRACK">
              <div
                className={`VCM_PROGRESS_FILL ${status === 'valid' ? 'valid' : status === 'compromised' ? 'compromised' : ''}`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="VCM_PROGRESS_PCT">{progress}%</span>
          </div>
        )}

        {/* ── Terminal ── */}
        <div className="VCM_TERMINAL_WRAP">
          <div className="VCM_TERMINAL_HEADER">
            <div className="VCM_TERMINAL_DOTS">
              <span className="dot red"></span>
              <span className="dot yellow"></span>
              <span className="dot green"></span>
            </div>
            <span className="VCM_TERMINAL_LABEL">INTEGRITY_SCANNER — terminal output</span>
          </div>
          <div className="VCM_TERMINAL" ref={terminalRef}>
            {logs.length === 0 ? (
              <div className="VCM_TERMINAL_PLACEHOLDER">
                <i className="fas fa-terminal"></i>
                <span>Output will appear here once you start the scan.</span>
              </div>
            ) : (
              logs.map(log => (
                <div key={log.id} className={`VCM_LOG_LINE log-${log.type}`}>
                  <span className="log-ts">{new Date().toLocaleTimeString('en-US', { hour12: false })}</span>
                  <span className="log-body">{log.text}</span>
                </div>
              ))
            )}
            {isVerifying && (
              <div className="VCM_LOG_LINE log-info VCM_CURSOR_LINE">
                <span className="log-ts">{new Date().toLocaleTimeString('en-US', { hour12: false })}</span>
                <span className="log-body VCM_BLINK_CURSOR">█</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Summary Cards (post-scan) ── */}
        {summary && (
          <div className="VCM_SUMMARY_ROW">
            <div className="VCM_SUMMARY_CARD total">
              <span className="sc-value">{summary.total}</span>
              <span className="sc-label">Total Blocks</span>
            </div>
            <div className="VCM_SUMMARY_CARD verified">
              <span className="sc-value">{summary.verified}</span>
              <span className="sc-label">Verified</span>
            </div>
            <div className="VCM_SUMMARY_CARD skipped">
              <span className="sc-value">{summary.skipped}</span>
              <span className="sc-label">Skipped</span>
            </div>
            <div className="VCM_SUMMARY_CARD compromised">
              <span className="sc-value">{summary.compromised}</span>
              <span className="sc-label">Tampered</span>
            </div>
          </div>
        )}

        {/* ── Footer Actions ── */}
        <div className="VCM_FOOTER">
          {status === 'idle' || status === 'valid' || status === 'compromised' ? (
            <>
              <button className="VCM_BTN_GHOST" onClick={handleClose}>
                Close
              </button>
              <button
                className="VCM_BTN_PRIMARY"
                onClick={startVerification}
                disabled={isVerifying}
              >
                <i className="fas fa-play"></i>
                {status === 'idle' ? 'Start Verification' : 'Re-scan Ledger'}
              </button>
            </>
          ) : (
            <>
              <button className="VCM_BTN_DANGER" onClick={handleCancel}>
                <i className="fas fa-stop"></i> Abort Scan
              </button>
              <button className="VCM_BTN_GHOST" disabled>
                <i className="fas fa-spinner fa-spin"></i> Verifying...
              </button>
            </>
          )}
        </div>

      </div>
    </div>
  );
}