import dotenv from 'dotenv';

dotenv.config();

// =========================================================
// 📱 SMS ENGINE — provider-agnostic OTP/text sender
// ---------------------------------------------------------
// Free-first design: pick a provider via SMS_PROVIDER. A missing/unknown
// provider DISABLES SMS (logged, never crashes) — same graceful-degradation
// contract as the mailer.
//
//   SMS_PROVIDER=textbelt   → textbelt.com. Key 'textbelt' = 1 FREE SMS/day
//                             (testing). Paid keys for volume.
//                             env: SMS_TEXTBELT_KEY (defaults to 'textbelt')
//
//   SMS_PROVIDER=httpsms    → httpsms.com / Android SMS Gateway pattern —
//                             your OWN Android phone + unli-text SIM becomes
//                             the sender. Genuinely free; ideal for a barangay.
//                             env: SMS_HTTPSMS_KEY (API key),
//                                  SMS_HTTPSMS_FROM (the gateway phone's number)
//
//   SMS_PROVIDER=semaphore  → semaphore.co — Philippine-dedicated gateway.
//                             Not free (₱0.50/msg) but the natural production
//                             upgrade. env: SMS_SEMAPHORE_KEY, SMS_SEMAPHORE_NAME
// =========================================================
const PROVIDER = (process.env.SMS_PROVIDER || '').trim().toLowerCase();

if (PROVIDER) {
    console.log(`✅ [SMS CHECK] SMS provider configured: ${PROVIDER}`);
} else {
    console.warn('⚠️ [SMS] SMS_PROVIDER is not set — SMS sending is DISABLED (email verification still works).');
}

// Normalizes a PH mobile number to +63 international format.
// Accepts 09171234567 / 9171234567 / +639171234567 / 639171234567.
export const normalizePhNumber = (raw) => {
    const digits = String(raw || '').replace(/\D/g, '');
    if (/^09\d{9}$/.test(digits)) return `+63${digits.slice(1)}`;
    if (/^9\d{9}$/.test(digits)) return `+63${digits}`;
    if (/^639\d{9}$/.test(digits)) return `+${digits}`;
    return null; // not a recognizable PH mobile number
};

const sendViaTextbelt = async (to, message) => {
    const resp = await fetch('https://textbelt.com/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            phone: to,
            message,
            key: process.env.SMS_TEXTBELT_KEY || 'textbelt', // 'textbelt' = 1 free SMS/day
        }),
    });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || 'TextBelt rejected the message.');
    return true;
};

const sendViaHttpSms = async (to, message) => {
    const key = process.env.SMS_HTTPSMS_KEY;
    const from = process.env.SMS_HTTPSMS_FROM;
    if (!key || !from) throw new Error('SMS_HTTPSMS_KEY / SMS_HTTPSMS_FROM not configured.');
    const resp = await fetch('https://api.httpsms.com/v1/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({ from, to, content: message }),
    });
    if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`httpSMS error ${resp.status}: ${body.slice(0, 200)}`);
    }
    return true;
};

const sendViaSemaphore = async (to, message) => {
    const apikey = process.env.SMS_SEMAPHORE_KEY;
    if (!apikey) throw new Error('SMS_SEMAPHORE_KEY not configured.');
    const resp = await fetch('https://api.semaphore.co/api/v4/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            apikey,
            number: to.replace('+', ''),
            message,
            sendername: process.env.SMS_SEMAPHORE_NAME || 'SEMAPHORE',
        }),
    });
    if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`Semaphore error ${resp.status}: ${body.slice(0, 200)}`);
    }
    return true;
};

/**
 * Sends an SMS through the configured provider.
 * Returns true on success, false on any failure (logged) — NEVER throws,
 * so a dead SMS gateway can't break account creation or verification flows.
 */
export const sendSms = async (rawNumber, message) => {
    const to = normalizePhNumber(rawNumber);
    if (!to) {
        console.warn(`⚠️ [SMS] Skipped — "${rawNumber}" is not a valid PH mobile number.`);
        return false;
    }
    if (!PROVIDER) {
        console.warn(`⚠️ [SMS] Skipped SMS to ${to} — SMS_PROVIDER not configured.`);
        return false;
    }

    try {
        if (PROVIDER === 'textbelt') await sendViaTextbelt(to, message);
        else if (PROVIDER === 'httpsms') await sendViaHttpSms(to, message);
        else if (PROVIDER === 'semaphore') await sendViaSemaphore(to, message);
        else {
            console.warn(`⚠️ [SMS] Unknown SMS_PROVIDER "${PROVIDER}" — SMS disabled.`);
            return false;
        }
        console.log(`📱 [SMS] Message sent to ${to} via ${PROVIDER}.`);
        return true;
    } catch (err) {
        console.error(`❌ [SMS ERROR] (${PROVIDER})`, err.message);
        return false;
    }
};
