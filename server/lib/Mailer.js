import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

// =========================================================
// 📧 DUAL-TRANSPORT EMAIL ENGINE
// Primary: Nodemailer SMTP (a plain Gmail app-password works: smtp.gmail.com)
//          — env: SMTP_HOST, SMTP_USER, SMTP_PASS [, SMTP_PORT, SMTP_FROM]
// Fallback: Resend HTTP API — env: RESEND_API_KEY [, RESEND_FROM]
// Whichever is configured gets used; when both are, SMTP goes first and a
// failed send falls through to Resend. Neither configured → email disabled
// with a warning, never a crash.
// =========================================================
const RESEND_API_KEY = process.env.RESEND_API_KEY;

// Sender must be a Resend-verified address. `onboarding@resend.dev` works for
// testing (only delivers to your own Resend account email until you verify a domain).
const FROM_ADDRESS = process.env.RESEND_FROM || "Barangay Engineer's Hill <onboarding@resend.dev>";

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

const SMTP_READY = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const smtpTransport = SMTP_READY
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
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

  if (smtpTransport) {
    try {
      return await sendViaSmtp(to, subject, html);
    } catch (err) {
      console.error('❌ [MAILER ERROR] SMTP failed:', err.message, resend ? '— trying Resend fallback…' : '');
    }
  }

  if (resend) {
    try {
      return await sendViaResend(to, subject, html);
    } catch (err) {
      console.error('❌ [MAILER ERROR] Resend failed:', err.message);
    }
  }

  if (!smtpTransport && !resend) {
    console.warn(`⚠️ [MAILER] Skipped email to ${to} — no transport configured.`);
  }
  return false;
};
