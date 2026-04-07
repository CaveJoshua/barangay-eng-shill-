import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

console.log("[MAILER DEBUG] Target User:", process.env.SMTP_USER ? "FOUND" : "NOT FOUND");

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587, // 🛡️ Changed from 465 for better cloud compatibility
  secure: false, // 🛡️ Must be false for Port 587
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS, // Use your 16-digit App Password here
  },
  tls: {
    // 🛡️ This prevents Render from rejecting Google's self-signed certificates
    rejectUnauthorized: false 
  }
});

// Immediate Verification check
transporter.verify((error, success) => {
  if (error) {
    console.error("❌ [MAILER CHECK] Connection Failed:", error.message);
  } else {
    console.log("✅ [MAILER CHECK] Connection Successful! Ready to send emails.");
  }
});

export const sendAutoMail = async (to, subject, title, message) => {
  try {
    await transporter.sendMail({
      from: `"Smart Barangay" <${process.env.SMTP_USER}>`,
      to,
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
    console.log(`📧 [MAILER] Email successfully sent to ${to}`);
    return true;
  } catch (error) {
    console.error("❌ [MAILER ERROR]", error.message);
    return false;
  }
};