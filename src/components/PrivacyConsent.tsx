import React, { useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// 🔐 PRIVACY CONSENT — reusable RA 10173 / GDPR consent control.
// Renders an "I agree" checkbox plus a clickable Data Privacy Notice (transparency
// requirement). Drop it above any resident-facing submit button and gate the
// submit on `checked`. The displayed consent + notice is the auditable record
// that the data subject was informed and consented.
// ─────────────────────────────────────────────────────────────────────────────

interface PrivacyConsentProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Short context for what the data is used for (e.g. "this report"). */
  purpose?: string;
}

const PrivacyConsent: React.FC<PrivacyConsentProps> = ({ checked, onChange, purpose = 'this request' }) => {
  const [showNotice, setShowNotice] = useState(false);

  return (
    <>
      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: '0.85rem', color: '#334155', cursor: 'pointer', lineHeight: 1.5 }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          style={{ marginTop: 3, flexShrink: 0, width: 16, height: 16 }}
        />
        <span>
          I have read and agree to the{' '}
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); setShowNotice(true); }}
            style={{ color: '#2563eb', background: 'none', border: 'none', padding: 0, font: 'inherit', textDecoration: 'underline', cursor: 'pointer' }}
          >
            Data Privacy Notice
          </button>
          , and consent to the processing of my personal data for {purpose}.
        </span>
      </label>

      {showNotice && (
        <div
          onClick={() => setShowNotice(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: 16 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 14, maxWidth: 560, width: '100%', maxHeight: '85vh', overflowY: 'auto', padding: '24px 26px', fontSize: '0.85rem', lineHeight: 1.6, color: '#334155', boxShadow: '0 20px 50px rgba(0,0,0,0.3)' }}
          >
            <h3 style={{ marginTop: 0, color: '#0f172a' }}>Data Privacy Notice</h3>
            <p>Engineer's Hill Barangay processes your personal data in accordance with the
              <strong> Data Privacy Act of 2012 (RA 10173)</strong> and applicable international
              standards (including the EU GDPR).</p>
            <p><strong>What we collect:</strong> your name, address, contact details, and the
              contents and any evidence attached to your request or report.</p>
            <p><strong>Purpose &amp; lawful basis:</strong> to receive, process, and act on your
              barangay request as part of our public function, and on the basis of your consent.</p>
            <p><strong>Retention:</strong> kept only as long as necessary for the service and any
              legal records-retention requirement, then securely disposed of.</p>
            <p><strong>Sharing:</strong> stored on secure third-party processors (database, file
              storage, email) under appropriate data-processing agreements; never sold or used for
              marketing.</p>
            <p><strong>Your rights:</strong> to be informed, to access, correct, object to, and
              request erasure or a copy (portability) of your data, and to lodge a complaint with
              the National Privacy Commission.</p>
            <p><strong>Contact:</strong> the Barangay Data Protection Officer (DPO), Engineer's Hill
              Barangay Hall.</p>
            <button
              type="button"
              onClick={() => setShowNotice(false)}
              style={{ marginTop: 8, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontWeight: 700, cursor: 'pointer' }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default PrivacyConsent;
