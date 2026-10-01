import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { API_BASE_URL } from './api';
import './styles/DocumentTracker.css';

interface TrackingData {
  referenceNo: string;
  trackingCode: string | null;
  type: string;
  purpose: string;
  status: string;
  stepIndex: number;
  priceDisplay: string;
  maskedName: string;
  requestMethod: string;
  dateRequested: string;
  dateReleased: string | null;
  rejectionReason: string | null;
  barangay: string;
}

const STEP_LABELS = [
  { step: 1, title: 'Submitted', subtitle: 'Request received & queued', icon: 'fa-file-import' },
  { step: 2, title: 'Under Review', subtitle: 'Verification & assessment', icon: 'fa-user-check' },
  { step: 3, title: 'Processing', subtitle: 'Official sign-off & stamping', icon: 'fa-stamp' },
  { step: 4, title: 'Ready for Pick-up', subtitle: 'Available at Barangay Hall', icon: 'fa-box-open' },
  { step: 5, title: 'Completed', subtitle: 'Claimed & finalized', icon: 'fa-check-circle' },
];

export const DocumentTracker: React.FC = () => {
  const { ref: paramRef } = useParams<{ ref?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [inputRef, setInputRef] = useState(paramRef || searchParams.get('ref') || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trackingData, setTrackingData] = useState<TrackingData | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchTracking = useCallback(async (queryCode: string) => {
    const trimmed = queryCode.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE_URL}/documents/track/${encodeURIComponent(trimmed)}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || data.error || 'Unable to locate document request.');
        setTrackingData(null);
      } else {
        setTrackingData(data);
        setError(null);
      }
    } catch (err: any) {
      setError('Connection to Barangay records server timed out. Please try again.');
      setTrackingData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialQuery = paramRef || searchParams.get('ref');
    if (initialQuery) {
      setInputRef(initialQuery);
      fetchTracking(initialQuery);
    }
  }, [paramRef, searchParams, fetchTracking]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputRef.trim()) return;
    navigate(`/track/${encodeURIComponent(inputRef.trim())}`, { replace: true });
    fetchTracking(inputRef);
  };

  const handleCopyRef = () => {
    if (trackingData?.referenceNo) {
      navigator.clipboard.writeText(trackingData.referenceNo);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="TRACKER_PAGE_WRAPPER">
      {/* HEADER NAV */}
      <header className="TRACKER_HEADER">
        <div className="TRACKER_HEADER_CONTAINER">
          <div className="TRACKER_BRAND" onClick={() => navigate('/')}>
            <div className="TRACKER_LOGO_SHIELD">
              <i className="fas fa-shield-alt"></i>
            </div>
            <div>
              <strong>Barangay Engineer's Hill</strong>
              <span>Public Document Tracking Portal</span>
            </div>
          </div>

          <button className="TRACKER_NAV_BACK" onClick={() => navigate('/')}>
            <i className="fas fa-home"></i> Back to Portal
          </button>
        </div>
      </header>

      <main className="TRACKER_MAIN">
        <div className="TRACKER_CONTAINER">
          {/* SEARCH HERO */}
          <section className="TRACKER_HERO_CARD">
            <div className="TRACKER_HERO_ICON">
              <i className="fas fa-search-location"></i>
            </div>
            <h1>Track Clearance / Document Status</h1>
            <p>
              Enter your official Reference Number (e.g. <code>ON-LN-0012</code> or <code>WK-IN-0045</code>) to check real-time processing progress.
            </p>

            <form className="TRACKER_SEARCH_BAR" onSubmit={handleSearch}>
              <div className="TRACKER_INPUT_WRAPPER">
                <i className="fas fa-barcode TRACKER_INPUT_ICON"></i>
                <input
                  type="text"
                  placeholder="Enter Reference Number..."
                  value={inputRef}
                  onChange={(e) => setInputRef(e.target.value.toUpperCase())}
                  autoFocus
                />
                {inputRef && (
                  <button 
                    type="button" 
                    className="TRACKER_CLEAR_BTN"
                    onClick={() => { setInputRef(''); setTrackingData(null); setError(null); }}
                  >
                    <i className="fas fa-times"></i>
                  </button>
                )}
              </div>
              <button type="submit" className="TRACKER_SUBMIT_BTN" disabled={loading || !inputRef.trim()}>
                {loading ? <i className="fas fa-spinner fa-spin"></i> : <><i className="fas fa-search"></i> Track</>}
              </button>
            </form>
          </section>

          {/* ERROR ALERT */}
          {error && (
            <div className="TRACKER_ALERT TRACKER_ALERT_ERROR">
              <i className="fas fa-exclamation-triangle"></i>
              <div>
                <strong>Record Not Found</strong>
                <p>{error}</p>
              </div>
            </div>
          )}

          {/* TRACKING RESULTS */}
          {trackingData && (
            <div className="TRACKER_RESULT_STAGE">
              {/* REJECTION BANNER IF APPLICABLE */}
              {trackingData.stepIndex === -1 && (
                <div className="TRACKER_ALERT TRACKER_ALERT_REJECTED">
                  <i className="fas fa-ban"></i>
                  <div>
                    <strong>Request {trackingData.status}</strong>
                    <p>{trackingData.rejectionReason || 'The request could not be processed. Please visit the Barangay Hall for assistance.'}</p>
                  </div>
                </div>
              )}

              {/* PROGRESS STEPPER */}
              {trackingData.stepIndex > 0 && (
                <section className="TRACKER_STEPPER_CARD">
                  <div className="TRACKER_CARD_TITLE">
                    <h3>Lifecycle Progress</h3>
                    <span className={`TRACKER_STATUS_PILL STATUS_${trackingData.status.toUpperCase().replace(/\s+/g, '_')}`}>
                      <i className="fas fa-circle-notch fa-spin"></i> {trackingData.status}
                    </span>
                  </div>

                  <div className="TRACKER_STEPPER">
                    {STEP_LABELS.map((s) => {
                      const isCompleted = trackingData.stepIndex > s.step;
                      const isCurrent = trackingData.stepIndex === s.step;
                      const isUpcoming = trackingData.stepIndex < s.step;

                      return (
                        <div 
                          key={s.step} 
                          className={`TRACKER_STEP_NODE ${isCompleted ? 'COMPLETED' : ''} ${isCurrent ? 'CURRENT' : ''} ${isUpcoming ? 'UPCOMING' : ''}`}
                        >
                          <div className="TRACKER_STEP_ICON_CIRCLE">
                            {isCompleted ? (
                              <i className="fas fa-check"></i>
                            ) : (
                              <i className={`fas ${s.icon}`}></i>
                            )}
                          </div>
                          <div className="TRACKER_STEP_TEXT">
                            <span className="TRACKER_STEP_NUM">Step {s.step}</span>
                            <strong>{s.title}</strong>
                            <small>{s.subtitle}</small>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* DETAILS SUMMARY CARD */}
              <section className="TRACKER_DETAILS_CARD">
                <div className="TRACKER_DETAILS_HEADER">
                  <div>
                    <span className="TRACKER_LABEL">DOCUMENT TYPE</span>
                    <h2>{trackingData.type}</h2>
                  </div>
                  <div className="TRACKER_REF_BADGE" onClick={handleCopyRef} title="Click to copy">
                    <span>Reference No:</span>
                    <strong>{trackingData.referenceNo}</strong>
                    <i className={copied ? "fas fa-check text-green" : "fas fa-copy"}></i>
                  </div>
                </div>

                <div className="TRACKER_GRID_INFO">
                  <div className="TRACKER_INFO_ITEM">
                    <span className="TRACKER_LABEL">Applicant</span>
                    <p><i className="fas fa-user-shield"></i> {trackingData.maskedName}</p>
                    <small className="TRACKER_PRIVACY_NOTE">Protected under RA 10173</small>
                  </div>

                  <div className="TRACKER_INFO_ITEM">
                    <span className="TRACKER_LABEL">Request Method</span>
                    <p><i className="fas fa-globe"></i> {trackingData.requestMethod}</p>
                  </div>

                  <div className="TRACKER_INFO_ITEM">
                    <span className="TRACKER_LABEL">Fee Status</span>
                    <p className="TRACKER_FEE_TEXT"><i className="fas fa-receipt"></i> {trackingData.priceDisplay}</p>
                  </div>

                  <div className="TRACKER_INFO_ITEM">
                    <span className="TRACKER_LABEL">Date Filed</span>
                    <p><i className="fas fa-calendar-alt"></i> {new Date(trackingData.dateRequested).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                  </div>

                  {trackingData.purpose && (
                    <div className="TRACKER_INFO_ITEM FULL_WIDTH">
                      <span className="TRACKER_LABEL">Purpose</span>
                      <p className="TRACKER_PURPOSE_BOX">{trackingData.purpose}</p>
                    </div>
                  )}
                </div>

                <div className="TRACKER_INSTRUCTIONS">
                  <i className="fas fa-info-circle"></i>
                  <div>
                    <strong>Pick-up Requirements:</strong>
                    <p>
                      When claiming, please bring 1 valid government-issued ID and present this Reference Number (<strong>{trackingData.referenceNo}</strong>) at Window 1, Barangay Hall.
                    </p>
                  </div>
                </div>

                <div className="TRACKER_ACTIONS">
                  <button className="TRACKER_PRINT_BTN" onClick={() => window.print()}>
                    <i className="fas fa-print"></i> Print Tracking Slip
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default DocumentTracker;
