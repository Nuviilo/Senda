import nodemailer from 'nodemailer';

export interface OutboxEmail {
  id: string;
  to: string;
  subject: string;
  code: string;
  actionUrl: string;
  type: 'email_verify' | 'password_reset' | 'email_change';
  sentViaSmtp: boolean;
  deliveryNote?: string;
  createdAt: number;
}

// Keep a rolling in-memory outbox for local/preview testing when email delivery is unconfigured or restricted
const recentOutbox: OutboxEmail[] = [];

export function isSmtpConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY ||
      (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
  );
}

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = Number(process.env.SMTP_PORT || '587');

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

function buildEmailHtml(params: {
  headline: string;
  bodyText: string;
  code: string;
  actionUrl: string;
}) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #111318;">
      <h2 style="margin: 0 0 12px; font-size: 20px;">${params.headline}</h2>
      <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: #4B5563;">${params.bodyText}</p>
      <div style="background: #F3F4F6; border-radius: 10px; padding: 14px 18px; font-family: monospace; font-size: 22px; font-weight: 700; letter-spacing: 4px; text-align: center; margin-bottom: 20px;">
        ${params.code}
      </div>
      <a href="${params.actionUrl}" style="display: inline-block; background: #2563EB; color: #FFFFFF; text-decoration: none; padding: 10px 18px; border-radius: 8px; font-size: 14px; font-weight: 600;">Continue in Senda</a>
    </div>
  `;
}

export async function sendTransactionalEmail(params: {
  to: string;
  subject: string;
  code: string;
  actionUrl: string;
  type: 'email_verify' | 'password_reset' | 'email_change';
  headline: string;
  bodyText: string;
}): Promise<OutboxEmail> {
  let sentViaSmtp = false;
  let deliveryNote: string | undefined;

  const textBody = `${params.headline}\n\n${params.bodyText}\n\nVerification code: ${params.code}\nOr open: ${params.actionUrl}\n`;
  const htmlBody = buildEmailHtml(params);

  // 1. Prefer Resend HTTPS API when RESEND_API_KEY is configured (works on all cloud environments without SMTP port blocking)
  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (resendKey) {
    try {
      const fromAddress =
        process.env.RESEND_FROM?.trim() ||
        process.env.SMTP_FROM?.trim() ||
        'Senda <onboarding@resend.dev>';

      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [params.to],
          subject: params.subject,
          text: textBody,
          html: htmlBody,
        }),
      });

      if (resp.ok) {
        sentViaSmtp = true;
      } else {
        const errData = await resp.json().catch(() => ({}));
        deliveryNote = errData?.message || `Resend returned status ${resp.status}`;
        console.warn('Resend delivery notice:', deliveryNote);
      }
    } catch (err) {
      deliveryNote = err instanceof Error ? err.message : 'Resend request failed';
      console.warn('Resend delivery failed:', deliveryNote);
    }
  }

  // 2. Fallback to generic SMTP via Nodemailer if configured and Resend didn't send
  if (!sentViaSmtp) {
    const transporter = getTransporter();
    if (transporter) {
      try {
        await transporter.sendMail({
          from: process.env.SMTP_FROM || 'Senda <noreply@senda.local>',
          to: params.to,
          subject: params.subject,
          text: textBody,
          html: htmlBody,
        });
        sentViaSmtp = true;
        deliveryNote = undefined;
      } catch (err) {
        deliveryNote = err instanceof Error ? err.message : 'SMTP delivery failed';
        console.warn('SMTP delivery failed, falling back to local preview outbox:', err);
      }
    }
  }

  const entry: OutboxEmail = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    to: params.to,
    subject: params.subject,
    code: params.code,
    actionUrl: params.actionUrl,
    type: params.type,
    sentViaSmtp,
    deliveryNote,
    createdAt: Date.now(),
  };

  recentOutbox.unshift(entry);
  if (recentOutbox.length > 25) {
    recentOutbox.length = 25;
  }

  return entry;
}

export function getOutboxForEmail(email: string): OutboxEmail[] {
  const lower = email.trim().toLowerCase();
  return recentOutbox.filter((e) => e.to.toLowerCase() === lower).slice(0, 5);
}
