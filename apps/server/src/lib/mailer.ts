import nodemailer from "nodemailer";
import { config } from "../config.js";

const transporter = nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  secure: config.SMTP_PORT === 465,
  auth:
    config.SMTP_USER !== undefined
      ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
      : undefined,
});

export interface SendMailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendMail(opts: SendMailOptions): Promise<void> {
  if (config.NODE_ENV === "test") {
    // Never send real emails during tests
    return;
  }

  if (config.NODE_ENV === "development" && !config.SMTP_USER) {
    // In dev without SMTP configured, just log the email content
    console.log("\n--- [DEV EMAIL] ---");
    console.log(`To: ${opts.to}`);
    console.log(`Subject: ${opts.subject}`);
    console.log(opts.text);
    console.log("-------------------\n");
    return;
  }

  await transporter.sendMail({
    from: config.SMTP_FROM,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  });
}

export function buildPasswordResetEmail(username: string, resetUrl: string): SendMailOptions {
  return {
    to: "",
    subject: "AsepriteSync — Reset your password",
    text: [
      `Hi ${username},`,
      "",
      "You requested a password reset for your AsepriteSync account.",
      "",
      `Reset link (valid for 1 hour): ${resetUrl}`,
      "",
      "If you did not request this, ignore this email.",
    ].join("\n"),
    html: `
      <p>Hi <strong>${username}</strong>,</p>
      <p>You requested a password reset for your AsepriteSync account.</p>
      <p><a href="${resetUrl}">Reset my password</a> (valid for 1 hour)</p>
      <p>If you did not request this, ignore this email.</p>
    `,
  };
}
