import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

// =========================================================
// 📧 DUAL-TRANSPORT EMAIL ENGINE
// Primary: Resend HTTP API (plain HTTPS, essentially never blocked by a
//          host) — env: RESEND_API_KEY [, RESEND_FROM]
// Fallback: Nodemailer SMTP — env: SMTP_HOST, SMTP_USER, SMTP_PASS
//           [, SMTP_PORT, SMTP_FROM]
// Whichever is configured gets used; when both are, Resend goes first and a
// failed send falls through to SMTP. Neither configured → email disabled
// with a warning, never a crash.
//
// 🛡️ Resend is deliberately tried FIRST: many PaaS hosts (Render's free/
// starter tiers included) silently drop outbound SMTP ports instead of
// refusing them, so SMTP-first meant every send paid a real connection
// timeout before ever reaching the fallback — occasionally long enough to
// blow past the frontend's own request timeout.
// =========================================================
const RESEND_API_KEY = process.env.RESEND_API_KEY;

// Sender must be a Resend-verified address. `onboarding@resend.dev` works for
// testing (only delivers to your own Resend account email until you verify a domain).
const FROM_ADDRESS = process.env.RESEND_FROM || "Barangay Engineer's Hill <onboarding@resend.dev>";

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// 🛡️ Explicit short timeouts — many PaaS hosts (Render included) silently
// drop outbound SMTP ports instead of refusing them, so without these,
// a blocked port hangs on nodemailer's ~2min default until the FRONTEND's
// own 15s request timeout gives up first, showing "Request was cancelled"
// while the backend is still stuck mid-connection.
const SMTP_READY = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const smtpTransport = SMTP_READY
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 8000,
    })
  : null;

if (smtpTransport) {
  console.log('✅ [MAILER CHECK] Nodemailer SMTP transport configured (primary).');
}
if (resend) {
  console.log(`✅ [MAILER CHECK] Resend transport configured${smtpTransport ? ' (fallback)' : ''}.`);
}
if (!smtpTransport && !resend) {
  console.warn('⚠️ [MAILER] Neither SMTP_* nor RESEND_API_KEY is set — email sending is DISABLED.');
}

const wrapHtml = (title, message) => `
  <div style="font-family: sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
    <h2 style="color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px;">${title}</h2>
    <p style="font-size: 16px; color: #34495e; line-height: 1.6;">${message}</p>
    <div style="background: #f9f9f9; padding: 10px; text-align: center; font-weight: bold; color: #2980b9; margin-top: 20px; border-radius: 5px;">
      Engineer's Hill Digital Governance
    </div>
  </div>
`;

const sendViaSmtp = async (to, subject, html) => {
  const from = process.env.SMTP_FROM || `"Barangay Engineer's Hill" <${process.env.SMTP_USER}>`;
  await smtpTransport.sendMail({ from, to, subject: `[NOTICE] ${subject}`, html });
  console.log(`📧 [MAILER] Email sent to ${to} via SMTP (nodemailer).`);
  return true;
};

const sendViaResend = async (to, subject, html) => {
  const { data, error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: [to],
    subject: `[NOTICE] ${subject}`,
    html,
  });
  if (error) throw new Error(error.message || JSON.stringify(error));
  console.log(`📧 [MAILER] Email sent to ${to} via Resend (id: ${data?.id})`);
  return true;
};

export const sendAutoMail = async (to, subject, title, message) => {
  const html = wrapHtml(title, message);

  if (resend) {
    try {
      return await sendViaResend(to, subject, html);
    } catch (err) {
      console.error('❌ [MAILER ERROR] Resend failed:', err.message, smtpTransport ? '— trying SMTP fallback…' : '');
    }
  }

  if (smtpTransport) {
    try {
      return await sendViaSmtp(to, subject, html);
    } catch (err) {
      console.error('❌ [MAILER ERROR] SMTP failed:', err.message);
    }
  }

  if (!smtpTransport && !resend) {
    console.warn(`⚠️ [MAILER] Skipped email to ${to} — no transport configured.`);
  }
  return false;
};
