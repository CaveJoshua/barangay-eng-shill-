import { Resend } from 'resend';
import dotenv from 'dotenv';

dotenv.config();

// =========================================================
// 📧 RESEND EMAIL ENGINE  (replaces nodemailer / SMTP)
// API-key (HTTP) transport — there is no persistent SMTP socket to verify.
// A missing key DISABLES email but does NOT crash the server, so logins and
// the rest of the system keep working.
// =========================================================
const RESEND_API_KEY = process.env.RESEND_API_KEY;

// Sender must be a Resend-verified address. `onboarding@resend.dev` works for
// testing (only delivers to your own Resend account email until you verify a domain).
const FROM_ADDRESS = process.env.RESEND_FROM || "Barangay Engineer's Hill <onboarding@resend.dev>";

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

if (resend) {
  console.log('✅ [MAILER CHECK] Resend transport configured. Ready to send emails.');
} else {
  console.warn('⚠️ [MAILER] RESEND_API_KEY is not set — email sending is DISABLED until you add it to .env (https://resend.com/api-keys).');
}

export const sendAutoMail = async (to, subject, title, message) => {
  if (!resend) {
    console.warn(`⚠️ [MAILER] Skipped email to ${to} — RESEND_API_KEY not configured.`);
    return false;
  }

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [to],
      subject: `[NOTICE] ${subject}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
          <h2 style="color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px;">${title}</h2>
          <p style="font-size: 16px; color: #34495e; line-height: 1.6;">${message}</p>
          <div style="background: #f9f9f9; padding: 10px; text-align: center; font-weight: bold; color: #2980b9; margin-top: 20px; border-radius: 5px;">
            Engineer's Hill Digital Governance
          </div>
        </div>
      `,
    });

    if (error) {
      console.error('❌ [MAILER ERROR]', error.message || JSON.stringify(error));
      return false;
    }

    console.log(`📧 [MAILER] Email successfully sent to ${to} (id: ${data?.id})`);
    return true;
  } catch (error) {
    console.error('❌ [MAILER ERROR]', error.message);
    return false;
  }
};
