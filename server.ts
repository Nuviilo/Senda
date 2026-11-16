import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import http from 'http';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { db } from './server/db.ts';
import {
  AuthenticatedRequest,
  generateSixDigitCode,
  generateToken,
  hashIp,
  hashPassword,
  hashToken,
  isValidEmail,
  isValidUsername,
  requireAuth,
  resolveSessionFromToken,
  verifyPassword,
} from './server/auth.ts';
import { getOutboxForEmail, sendTransactionalEmail } from './server/mailer.ts';

const PORT = Number(process.env.PORT || 3000);
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

const app = express();
app.use(express.json({ limit: '3mb' }));

function getClientIp(req: http.IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

function getBaseUrl(req: express.Request): string {
  if (process.env.APP_URL && !process.env.APP_URL.includes('MY_APP_URL')) {
    return process.env.APP_URL.replace(/\/$/, '');
  }
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

function formatPrivateUser(row: any) {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.email_verified === 1,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url || '',
    autoAcceptTrusted: row.auto_accept_trusted === 1,
    defaultDownloadFolder: row.default_download_folder || 'Downloads/Senda',
    notificationsEnabled: row.notifications_enabled === 1,
    themePreference: row.theme_preference || 'system',
    language: row.language || 'en',
    createdAt: row.created_at,
  };
}

function formatPublicUser(row: any, devices: any[] = []) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url || '',
    devices: devices.map((d) => ({
      id: d.id,
      deviceName: d.device_name,
      os: d.os,
      deviceType: d.device_type,
      isOnline: d.is_online === 1,
      lastSeen: d.last_seen,
    })),
  };
}

function formatDevice(d: any, currentDeviceId?: string, currentIpHash?: string) {
  return {
    id: d.id,
    userId: d.user_id,
    deviceName: d.device_name,
    os: d.os,
    deviceType: d.device_type,
    isTrusted: d.is_trusted === 1,
    isOnline: d.is_online === 1,
    lastSeen: d.last_seen,
    sameNetwork: Boolean(currentIpHash && d.last_ip_hash && d.last_ip_hash === currentIpHash),
    isCurrentDevice: currentDeviceId ? d.id === currentDeviceId : false,
    createdAt: d.created_at,
  };
}

// Track live WebSocket connections keyed by deviceId
interface ConnectedClient {
  ws: WebSocket;
  userId: string;
  deviceId: string;
  ipHash: string;
}

const connectedDevices = new Map<string, ConnectedClient>();

function sendWs(deviceId: string, payload: unknown): boolean {
  const client = connectedDevices.get(deviceId);
  if (!client || client.ws.readyState !== WebSocket.OPEN) {
    return false;
  }
  client.ws.send(JSON.stringify(payload));
  return true;
}

function broadcastUserDevicePresence(userId: string) {
  const devices = db
    .prepare('SELECT * FROM devices WHERE user_id = ? ORDER BY is_online DESC, last_seen DESC')
    .all(userId) as any[];

  for (const client of connectedDevices.values()) {
    if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(
        JSON.stringify({
          type: 'devices:sync',
          devices: devices.map((d) => formatDevice(d, client.deviceId, client.ipHash)),
        })
      );
    }
  }
}

// ======================== AUTH ROUTES ========================

app.get('/api/users/check-username', (req, res) => {
  const raw = String(req.query.username || '').trim().toLowerCase().replace(/^@/, '');
  if (!isValidUsername(raw)) {
    res.json({
      available: false,
      valid: false,
      reason: 'Username must be 3-24 characters using lowercase letters, numbers, or underscores.',
    });
    return;
  }
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(raw) as { id: string } | undefined;
  res.json({
    available: !existing,
    valid: true,
    username: raw,
    reason: existing ? 'That username is already taken.' : null,
  });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const username = String(req.body.username || '').trim().toLowerCase().replace(/^@/, '');
    const displayName = String(req.body.displayName || '').trim();
    const password = String(req.body.password || '');
    const deviceInfo = req.body.device || {};

    if (!isValidEmail(email)) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }
    if (!isValidUsername(username)) {
      res.status(400).json({
        error: 'Username must be 3-24 characters (lowercase letters, numbers, underscores).',
      });
      return;
    }
    if (!displayName || displayName.length < 2 || displayName.length > 60) {
      res.status(400).json({ error: 'Display name must be between 2 and 60 characters.' });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters long.' });
      return;
    }

    const emailTaken = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (emailTaken) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const usernameTaken = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (usernameTaken) {
      res.status(409).json({ error: 'This username is already taken.' });
      return;
    }

    const now = Date.now();
    const userId = crypto.randomUUID();
    const passwordHash = hashPassword(password);

    db.prepare(
      `INSERT INTO users (id, email, email_verified, username, display_name, avatar_url, password_hash, created_at, updated_at)
       VALUES (?, ?, 0, ?, ?, '', ?, ?, ?)`
    ).run(userId, email, username, displayName, passwordHash, now, now);

    // Create initial device & session
    const deviceId = String(deviceInfo.id || crypto.randomUUID()).slice(0, 80);
    const deviceName = String(deviceInfo.deviceName || 'My Browser').slice(0, 60);
    const os = String(deviceInfo.os || 'Web').slice(0, 32);
    const deviceType = ['desktop', 'mobile', 'tablet', 'web'].includes(deviceInfo.deviceType)
      ? deviceInfo.deviceType
      : 'web';
    const ipHash = hashIp(getClientIp(req));

    db.prepare(
      `INSERT INTO devices (id, user_id, device_name, os, device_type, is_trusted, is_online, last_seen, last_ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`
    ).run(deviceId, userId, deviceName, os, deviceType, now, ipHash, now);

    const rawToken = generateToken();
    const sessionId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO sessions (id, user_id, device_id, token_hash, expires_at, created_at, last_active_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(sessionId, userId, deviceId, hashToken(rawToken), now + SESSION_TTL_MS, now, now);

    // Email verification token
    const verifyToken = generateToken();
    const code = generateSixDigitCode();
    db.prepare(
      `INSERT INTO verification_tokens (id, user_id, token, code, type, expires_at, used, created_at)
       VALUES (?, ?, ?, ?, 'email_verify', ?, 0, ?)`
    ).run(crypto.randomUUID(), userId, verifyToken, code, now + TOKEN_TTL_MS, now);

    const actionUrl = `${getBaseUrl(req)}/?verifyToken=${verifyToken}`;
    const outbox = await sendTransactionalEmail({
      to: email,
      subject: 'Verify your Senda email address',
      code,
      actionUrl,
      type: 'email_verify',
      headline: `Welcome to Senda, ${displayName}`,
      bodyText: 'Enter this 6-digit verification code or click the link below to verify your email address.',
    });

    const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    res.status(201).json({
      token: rawToken,
      deviceId,
      user: formatPrivateUser(userRow),
      verificationPreview: outbox.sentViaSmtp ? null : outbox,
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Unable to create account right now.' });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const identifier = String(req.body.email || req.body.identifier || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const deviceInfo = req.body.device || {};

    if (!identifier || !password) {
      res.status(400).json({ error: 'Email/username and password are required.' });
      return;
    }

    const cleanIdentifier = identifier.replace(/^@/, '');
    const userRow = db
      .prepare('SELECT * FROM users WHERE email = ? OR username = ?')
      .get(identifier, cleanIdentifier) as any;

    if (!userRow || !verifyPassword(password, userRow.password_hash)) {
      res.status(401).json({ error: 'Invalid credentials. Check your email and password.' });
      return;
    }

    const now = Date.now();
    const ipHash = hashIp(getClientIp(req));
    const requestedDeviceId = String(deviceInfo.id || '').trim().slice(0, 80);
    let deviceId = requestedDeviceId || crypto.randomUUID();

    const existingDevice = db
      .prepare('SELECT * FROM devices WHERE id = ?')
      .get(deviceId) as any;

    if (existingDevice && existingDevice.user_id !== userRow.id) {
      // Never collide device IDs across different users
      deviceId = crypto.randomUUID();
    }

    const deviceName = String(deviceInfo.deviceName || 'Senda Device').slice(0, 60);
    const os = String(deviceInfo.os || 'Web').slice(0, 32);
    const deviceType = ['desktop', 'mobile', 'tablet', 'web'].includes(deviceInfo.deviceType)
      ? deviceInfo.deviceType
      : 'web';

    if (existingDevice && existingDevice.user_id === userRow.id) {
      db.prepare('UPDATE devices SET is_online = 1, last_seen = ?, last_ip_hash = ?, os = ? WHERE id = ?').run(
        now,
        ipHash,
        os,
        deviceId
      );
    } else {
      db.prepare(
        `INSERT INTO devices (id, user_id, device_name, os, device_type, is_trusted, is_online, last_seen, last_ip_hash, created_at)
         VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?, ?)`
      ).run(deviceId, userRow.id, deviceName, os, deviceType, now, ipHash, now);
    }

    const rawToken = generateToken();
    const sessionId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO sessions (id, user_id, device_id, token_hash, expires_at, created_at, last_active_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(sessionId, userRow.id, deviceId, hashToken(rawToken), now + SESSION_TTL_MS, now, now);

    res.json({
      token: rawToken,
      deviceId,
      user: formatPrivateUser(userRow),
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Unable to sign in right now.' });
  }
});

app.post('/api/auth/logout', requireAuth, (req: AuthenticatedRequest, res) => {
  const auth = req.authUser!;
  db.prepare('DELETE FROM sessions WHERE id = ?').run(auth.sessionId);
  db.prepare('UPDATE devices SET is_online = 0, last_seen = ? WHERE id = ?').run(Date.now(), auth.deviceId);
  const client = connectedDevices.get(auth.deviceId);
  if (client) {
    client.ws.close(1000, 'Signed out');
    connectedDevices.delete(auth.deviceId);
  }
  broadcastUserDevicePresence(auth.id);
  res.json({ ok: true });
});

app.post('/api/auth/send-verification', requireAuth, async (req: AuthenticatedRequest, res) => {
  const auth = req.authUser!;
  const now = Date.now();
  const verifyToken = generateToken();
  const code = generateSixDigitCode();

  db.prepare(
    `INSERT INTO verification_tokens (id, user_id, token, code, type, expires_at, used, created_at)
     VALUES (?, ?, ?, ?, 'email_verify', ?, 0, ?)`
  ).run(crypto.randomUUID(), auth.id, verifyToken, code, now + TOKEN_TTL_MS, now);

  const actionUrl = `${getBaseUrl(req)}/?verifyToken=${verifyToken}`;
  const outbox = await sendTransactionalEmail({
    to: auth.email,
    subject: 'Verify your Senda email address',
    code,
    actionUrl,
    type: 'email_verify',
    headline: 'Verify your email address',
    bodyText: 'Use the 6-digit code below or click the confirmation button to verify your email.',
  });

  res.json({
    sent: true,
    verificationPreview: outbox.sentViaSmtp ? null : outbox,
  });
});

app.post('/api/auth/verify-email', (req, res) => {
  const token = String(req.body.token || '').trim();
  const code = String(req.body.code || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const now = Date.now();

  let row: any;
  if (token) {
    row = db
      .prepare(
        `SELECT * FROM verification_tokens
         WHERE token = ? AND type IN ('email_verify', 'email_change') AND used = 0 AND expires_at > ?`
      )
      .get(token, now);
  } else if (code && email) {
    row = db
      .prepare(
        `SELECT vt.* FROM verification_tokens vt
         JOIN users u ON u.id = vt.user_id
         WHERE vt.code = ? AND (u.email = ? OR vt.new_email = ?)
           AND vt.type IN ('email_verify', 'email_change') AND vt.used = 0 AND vt.expires_at > ?
         ORDER BY vt.created_at DESC LIMIT 1`
      )
      .get(code, email, email, now);
  }

  if (!row) {
    res.status(400).json({ error: 'Invalid or expired verification code or link.' });
    return;
  }

  db.prepare('UPDATE verification_tokens SET used = 1 WHERE id = ?').run(row.id);

  if (row.type === 'email_change' && row.new_email) {
    db.prepare('UPDATE users SET email = ?, email_verified = 1, updated_at = ? WHERE id = ?').run(
      row.new_email,
      now,
      row.user_id
    );
  } else {
    db.prepare('UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?').run(now, row.user_id);
  }

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  res.json({ verified: true, user: formatPrivateUser(updated) });
});

app.post('/api/auth/forgot-password', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return;
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
  if (!user) {
    // Return uniform success to prevent account enumeration
    res.json({ sent: true, resetPreview: null });
    return;
  }

  const now = Date.now();
  const resetToken = generateToken();
  const code = generateSixDigitCode();

  db.prepare(
    `INSERT INTO verification_tokens (id, user_id, token, code, type, expires_at, used, created_at)
     VALUES (?, ?, ?, ?, 'password_reset', ?, 0, ?)`
  ).run(crypto.randomUUID(), user.id, resetToken, code, now + TOKEN_TTL_MS, now);

  const actionUrl = `${getBaseUrl(req)}/?resetToken=${resetToken}`;
  const outbox = await sendTransactionalEmail({
    to: user.email,
    subject: 'Reset your Senda password',
    code,
    actionUrl,
    type: 'password_reset',
    headline: 'Password Reset Request',
    bodyText: 'Use the 6-digit reset code below or click the link to choose a new password.',
  });

  res.json({
    sent: true,
    resetPreview: outbox.sentViaSmtp ? null : outbox,
  });
});

app.post('/api/auth/reset-password', (req, res) => {
  const token = String(req.body.token || '').trim();
  const code = String(req.body.code || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const newPassword = String(req.body.newPassword || '');
  const now = Date.now();

  if (newPassword.length < 8) {
    res.status(400).json({ error: 'New password must be at least 8 characters long.' });
    return;
  }

  let row: any;
  if (token) {
    row = db
      .prepare(
        `SELECT * FROM verification_tokens
         WHERE token = ? AND type = 'password_reset' AND used = 0 AND expires_at > ?`
      )
      .get(token, now);
  } else if (code && email) {
    row = db
      .prepare(
        `SELECT vt.* FROM verification_tokens vt
         JOIN users u ON u.id = vt.user_id
         WHERE vt.code = ? AND u.email = ? AND vt.type = 'password_reset' AND vt.used = 0 AND vt.expires_at > ?
         ORDER BY vt.created_at DESC LIMIT 1`
      )
      .get(code, email, now);
  }

  if (!row) {
    res.status(400).json({ error: 'Invalid or expired password reset code.' });
    return;
  }

  db.prepare('UPDATE verification_tokens SET used = 1 WHERE id = ?').run(row.id);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
    hashPassword(newPassword),
    now,
    row.user_id
  );
  // Revoke existing sessions on password reset
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);

  res.json({ reset: true });
});

app.get('/api/auth/outbox', requireAuth, (req: AuthenticatedRequest, res) => {
  const emails = getOutboxForEmail(req.authUser!.email);
  res.json({ emails });
});

app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.authUser!.id);
  if (!row) {
    res.status(404).json({ error: 'Account not found.' });
    return;
  }
  res.json({ user: formatPrivateUser(row), deviceId: req.authUser!.deviceId });
});

// ======================== USER PROFILE & SEARCH ========================

app.patch('/api/users/me', requireAuth, (req: AuthenticatedRequest, res) => {
  const auth = req.authUser!;
  const now = Date.now();
  const current = db.prepare('SELECT * FROM users WHERE id = ?').get(auth.id) as any;

  let displayName = current.display_name;
  if (typeof req.body.displayName === 'string') {
    const trimmed = req.body.displayName.trim();
    if (trimmed.length < 2 || trimmed.length > 60) {
      res.status(400).json({ error: 'Display name must be 2-60 characters.' });
      return;
    }
    displayName = trimmed;
  }

  let username = current.username;
  if (typeof req.body.username === 'string') {
    const nextUsername = req.body.username.trim().toLowerCase().replace(/^@/, '');
    if (!isValidUsername(nextUsername)) {
      res.status(400).json({ error: 'Username must be 3-24 lowercase letters, numbers, or underscores.' });
      return;
    }
    if (nextUsername !== current.username) {
      const taken = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(nextUsername, auth.id);
      if (taken) {
        res.status(409).json({ error: 'Username is already taken.' });
        return;
      }
      username = nextUsername;
    }
  }

  let avatarUrl = current.avatar_url;
  if (typeof req.body.avatarUrl === 'string') {
    if (req.body.avatarUrl.length > 2_000_000) {
      res.status(400).json({ error: 'Profile image is too large (max 1.5MB).' });
      return;
    }
    avatarUrl = req.body.avatarUrl;
  }

  const autoAcceptTrusted =
    typeof req.body.autoAcceptTrusted === 'boolean'
      ? req.body.autoAcceptTrusted
        ? 1
        : 0
      : current.auto_accept_trusted;
  const defaultDownloadFolder =
    typeof req.body.defaultDownloadFolder === 'string'
      ? req.body.defaultDownloadFolder.trim().slice(0, 180) || 'Downloads/Senda'
      : current.default_download_folder;
  const notificationsEnabled =
    typeof req.body.notificationsEnabled === 'boolean'
      ? req.body.notificationsEnabled
        ? 1
        : 0
      : current.notifications_enabled;
  const themePreference = ['system', 'light', 'dark'].includes(req.body.themePreference)
    ? req.body.themePreference
    : current.theme_preference;
  const language =
    typeof req.body.language === 'string' && req.body.language.length <= 10
      ? req.body.language
      : current.language;

  db.prepare(
    `UPDATE users SET
      display_name = ?,
      username = ?,
      avatar_url = ?,
      auto_accept_trusted = ?,
      default_download_folder = ?,
      notifications_enabled = ?,
      theme_preference = ?,
      language = ?,
      updated_at = ?
     WHERE id = ?`
  ).run(
    displayName,
    username,
    avatarUrl,
    autoAcceptTrusted,
    defaultDownloadFolder,
    notificationsEnabled,
    themePreference,
    language,
    now,
    auth.id
  );

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(auth.id);
  res.json({ user: formatPrivateUser(updated) });
});

app.post('/api/users/change-email', requireAuth, async (req: AuthenticatedRequest, res) => {
  const auth = req.authUser!;
  const newEmail = String(req.body.newEmail || '').trim().toLowerCase();
  const currentPassword = String(req.body.currentPassword || '');

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(auth.id) as any;
  if (!verifyPassword(currentPassword, user.password_hash)) {
    res.status(401).json({ error: 'Current password is incorrect.' });
    return;
  }
  if (!isValidEmail(newEmail)) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return;
  }
  const taken = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(newEmail, auth.id);
  if (taken) {
    res.status(409).json({ error: 'This email is already associated with another account.' });
    return;
  }

  const now = Date.now();
  const token = generateToken();
  const code = generateSixDigitCode();
  db.prepare(
    `INSERT INTO verification_tokens (id, user_id, token, code, type, new_email, expires_at, used, created_at)
     VALUES (?, ?, ?, ?, 'email_change', ?, ?, 0, ?)`
  ).run(crypto.randomUUID(), auth.id, token, code, newEmail, now + TOKEN_TTL_MS, now);

  const actionUrl = `${getBaseUrl(req)}/?verifyToken=${token}`;
  const outbox = await sendTransactionalEmail({
    to: newEmail,
    subject: 'Confirm your new Senda email address',
    code,
    actionUrl,
    type: 'email_change',
    headline: 'Confirm email change',
    bodyText: `Enter code ${code} to verify ${newEmail} as your new Senda email address.`,
  });

  res.json({
    sent: true,
    verificationPreview: outbox.sentViaSmtp ? null : outbox,
  });
});

app.post('/api/users/change-password', requireAuth, (req: AuthenticatedRequest, res) => {
  const auth = req.authUser!;
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(auth.id) as any;
  if (!verifyPassword(currentPassword, user.password_hash)) {
    res.status(401).json({ error: 'Current password is incorrect.' });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: 'New password must be at least 8 characters long.' });
    return;
  }

  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
    hashPassword(newPassword),
    Date.now(),
    auth.id
  );

  res.json({ ok: true });
});

app.delete('/api/users/me', requireAuth, (req: AuthenticatedRequest, res) => {
  const auth = req.authUser!;
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(auth.id) as any;
  if (!verifyPassword(password, user.password_hash)) {
    res.status(401).json({ error: 'Password confirmation failed.' });
    return;
  }

  // Disconnect active sockets for this user
  for (const [devId, client] of connectedDevices.entries()) {
    if (client.userId === auth.id) {
      client.ws.close(1000, 'Account deleted');
      connectedDevices.delete(devId);
    }
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(auth.id);
  res.json({ deleted: true });
});

// Search users by @username or display name (never exposes email)
app.get('/api/users/search', requireAuth, (req: AuthenticatedRequest, res) => {
  const q = String(req.query.q || '').trim().toLowerCase().replace(/^@/, '');
  if (!q) {
    // Return recently interacted peers (excluding self)
    const recentRows = db
      .prepare(
        `SELECT DISTINCT u.id, u.username, u.display_name, u.avatar_url
         FROM transfers t
         JOIN users u ON (u.id = CASE WHEN t.sender_id = ? THEN t.recipient_id ELSE t.sender_id END)
         WHERE (t.sender_id = ? OR t.recipient_id = ?) AND u.id != ?
         ORDER BY t.created_at DESC
         LIMIT 8`
      )
      .all(req.authUser!.id, req.authUser!.id, req.authUser!.id, req.authUser!.id) as any[];

    const results = recentRows.map((u) => {
      const devices = db
        .prepare('SELECT id, device_name, os, device_type, is_online, last_seen FROM devices WHERE user_id = ? ORDER BY is_online DESC, last_seen DESC')
        .all(u.id);
      return formatPublicUser(u, devices);
    });
    res.json({ users: results });
    return;
  }

  const pattern = `%${q}%`;
  const rows = db
    .prepare(
      `SELECT id, username, display_name, avatar_url
       FROM users
       WHERE (username LIKE ? OR LOWER(display_name) LIKE ?) AND id != ?
       ORDER BY CASE WHEN username = ? THEN 0 WHEN username LIKE ? THEN 1 ELSE 2 END, display_name ASC
       LIMIT 20`
    )
    .all(pattern, pattern, req.authUser!.id, q, `${q}%`) as any[];

  const users = rows.map((u) => {
    const devices = db
      .prepare('SELECT id, device_name, os, device_type, is_online, last_seen FROM devices WHERE user_id = ? ORDER BY is_online DESC, last_seen DESC')
      .all(u.id);
    return formatPublicUser(u, devices);
  });

  res.json({ users });
});

// ======================== DEVICE ROUTES ========================

app.get('/api/devices', requireAuth, (req: AuthenticatedRequest, res) => {
  const auth = req.authUser!;
  const ipHash = hashIp(getClientIp(req));
  const rows = db
    .prepare('SELECT * FROM devices WHERE user_id = ? ORDER BY is_online DESC, last_seen DESC')
    .all(auth.id) as any[];

  res.json({
    devices: rows.map((d) => formatDevice(d, auth.deviceId, ipHash)),
  });
});

app.patch('/api/devices/:deviceId', requireAuth, (req: AuthenticatedRequest, res) => {
  const auth = req.authUser!;
  const targetId = req.params.deviceId;
  const device = db
    .prepare('SELECT * FROM devices WHERE id = ? AND user_id = ?')
    .get(targetId, auth.id) as any;

  if (!device) {
    res.status(404).json({ error: 'Device not found.' });
    return;
  }

  const deviceName =
    typeof req.body.deviceName === 'string' && req.body.deviceName.trim().length > 0
      ? req.body.deviceName.trim().slice(0, 60)
      : device.device_name;
  const isTrusted =
    typeof req.body.isTrusted === 'boolean' ? (req.body.isTrusted ? 1 : 0) : device.is_trusted;

  db.prepare('UPDATE devices SET device_name = ?, is_trusted = ? WHERE id = ?').run(
    deviceName,
    isTrusted,
    targetId
  );

  const updated = db.prepare('SELECT * FROM devices WHERE id = ?').get(targetId);
  broadcastUserDevicePresence(auth.id);
  res.json({ device: formatDevice(updated, auth.deviceId) });
});

app.delete('/api/devices/:deviceId', requireAuth, (req: AuthenticatedRequest, res) => {
  const auth = req.authUser!;
  const targetId = req.params.deviceId;
  const device = db
    .prepare('SELECT * FROM devices WHERE id = ? AND user_id = ?')
    .get(targetId, auth.id) as any;

  if (!device) {
    res.status(404).json({ error: 'Device not found.' });
    return;
  }

  const client = connectedDevices.get(targetId);
  if (client) {
    client.ws.send(JSON.stringify({ type: 'session:revoked' }));
    client.ws.close(1000, 'Device removed');
    connectedDevices.delete(targetId);
  }

  db.prepare('DELETE FROM devices WHERE id = ?').run(targetId);
  broadcastUserDevicePresence(auth.id);
  res.json({ deleted: true });
});

// ======================== TRANSFER HISTORY ROUTES ========================

app.get('/api/transfers', requireAuth, (req: AuthenticatedRequest, res) => {
  const auth = req.authUser!;
  const rows = db
    .prepare(
      `SELECT * FROM transfers
       WHERE sender_id = ? OR recipient_id = ?
       ORDER BY created_at DESC
       LIMIT 200`
    )
    .all(auth.id, auth.id) as any[];

  res.json({
    transfers: rows.map((r) => ({
      id: r.id,
      senderId: r.sender_id,
      senderUsername: r.sender_username,
      senderDisplayName: r.sender_display_name,
      senderDeviceId: r.sender_device_id,
      senderDeviceName: r.sender_device_name,
      recipientId: r.recipient_id,
      recipientUsername: r.recipient_username,
      recipientDisplayName: r.recipient_display_name,
      recipientDeviceId: r.recipient_device_id,
      recipientDeviceName: r.recipient_device_name,
      files: JSON.parse(r.file_summary || '[]'),
      totalBytes: r.total_bytes,
      fileCount: r.file_count,
      transport: r.transport,
      status: r.status,
      errorMessage: r.error_message,
      createdAt: r.created_at,
      completedAt: r.completed_at,
    })),
  });
});

app.post('/api/transfers', requireAuth, (req: AuthenticatedRequest, res) => {
  const auth = req.authUser!;
  const id = String(req.body.id || crypto.randomUUID());
  const recipientId = String(req.body.recipientId || auth.id);
  const recipientDeviceId = String(req.body.recipientDeviceId || '');
  const files = Array.isArray(req.body.files) ? req.body.files : [];
  const totalBytes = Number(req.body.totalBytes || 0);
  const transport = String(req.body.transport || 'webrtc-p2p');
  const status = String(req.body.status || 'pending');

  const senderDevice = db.prepare('SELECT device_name FROM devices WHERE id = ?').get(auth.deviceId) as any;
  const recipientUser = db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(recipientId) as any;
  const recipientDevice = db.prepare('SELECT device_name FROM devices WHERE id = ?').get(recipientDeviceId) as any;

  if (!recipientUser) {
    res.status(404).json({ error: 'Recipient not found.' });
    return;
  }

  const now = Date.now();
  db.prepare(
    `INSERT OR REPLACE INTO transfers (
      id, sender_id, sender_username, sender_display_name, sender_device_id, sender_device_name,
      recipient_id, recipient_username, recipient_display_name, recipient_device_id, recipient_device_name,
      file_summary, total_bytes, file_count, transport, status, error_message, created_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)`
  ).run(
    id,
    auth.id,
    auth.username,
    auth.displayName,
    auth.deviceId,
    senderDevice?.device_name || 'This Device',
    recipientUser.id,
    recipientUser.username,
    recipientUser.display_name,
    recipientDeviceId,
    recipientDevice?.device_name || 'Recipient Device',
    JSON.stringify(files.slice(0, 100)),
    totalBytes,
    files.length,
    transport,
    status,
    now
  );

  res.status(201).json({ id });
});

app.patch('/api/transfers/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const auth = req.authUser!;
  const id = req.params.id;
  const existing = db
    .prepare('SELECT * FROM transfers WHERE id = ? AND (sender_id = ? OR recipient_id = ?)')
    .get(id, auth.id, auth.id) as any;

  if (!existing) {
    res.status(404).json({ error: 'Transfer record not found.' });
    return;
  }

  const status = typeof req.body.status === 'string' ? req.body.status : existing.status;
  const transport = typeof req.body.transport === 'string' ? req.body.transport : existing.transport;
  const errorMessage = typeof req.body.errorMessage === 'string' ? req.body.errorMessage : existing.error_message;
  const completedAt = ['completed', 'failed', 'cancelled', 'declined'].includes(status)
    ? Date.now()
    : existing.completed_at;

  db.prepare('UPDATE transfers SET status = ?, transport = ?, error_message = ?, completed_at = ? WHERE id = ?').run(
    status,
    transport,
    errorMessage,
    completedAt,
    id
  );

  res.json({ ok: true });
});

// ======================== HTTP + WEBSOCKET SERVER ========================

async function startServer() {
  const server = http.createServer(app);

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 * 1024 });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);
    const token = url.searchParams.get('token') || '';
    const authUser = resolveSessionFromToken(token);

    if (!authUser) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    const ipHash = hashIp(getClientIp(req));
    const deviceId = authUser.deviceId;
    const now = Date.now();

    // Close previous socket for same device if reconnecting
    const prev = connectedDevices.get(deviceId);
    if (prev && prev.ws !== ws && prev.ws.readyState === WebSocket.OPEN) {
      prev.ws.close(1000, 'Replaced by newer connection');
    }

    connectedDevices.set(deviceId, {
      ws,
      userId: authUser.id,
      deviceId,
      ipHash,
    });

    db.prepare('UPDATE devices SET is_online = 1, last_seen = ?, last_ip_hash = ? WHERE id = ?').run(
      now,
      ipHash,
      deviceId
    );
    broadcastUserDevicePresence(authUser.id);

    ws.send(
      JSON.stringify({
        type: 'ws:ready',
        deviceId,
        userId: authUser.id,
      })
    );

    ws.on('message', (raw, isBinary) => {
      if (isBinary) {
        // Binary envelope format: [4-byte headerLen][JSON header][binary payload]
        const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
        if (buf.length < 4) return;
        const headerLen = buf.readUInt32BE(0);
        if (buf.length < 4 + headerLen) return;
        try {
          const header = JSON.parse(buf.subarray(4, 4 + headerLen).toString('utf8'));
          const targetDeviceId = String(header.toDeviceId || '');
          const target = connectedDevices.get(targetDeviceId);
          if (!target || target.ws.readyState !== WebSocket.OPEN) return;
          // Stamp verified sender identity onto forwarded header
          const stampedHeader = Buffer.from(
            JSON.stringify({
              ...header,
              fromUserId: authUser.id,
              fromDeviceId: deviceId,
            }),
            'utf8'
          );
          const outLen = Buffer.alloc(4);
          outLen.writeUInt32BE(stampedHeader.length, 0);
          const payload = buf.subarray(4 + headerLen);
          target.ws.send(Buffer.concat([outLen, stampedHeader, payload]), { binary: true });
        } catch {
          // Ignore malformed frame
        }
        return;
      }

      let msg: any;
      try {
        msg = JSON.parse(raw.toString('utf8'));
      } catch {
        return;
      }

      if (msg.type === 'ping') {
        db.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').run(Date.now(), deviceId);
        ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        return;
      }

      // Signaling & transfer coordination messages targeted to a specific peer device
      const targetDeviceId = String(msg.toDeviceId || '');
      if (!targetDeviceId) return;

      const targetClient = connectedDevices.get(targetDeviceId);
      if (!targetClient || targetClient.ws.readyState !== WebSocket.OPEN) {
        if (msg.type === 'transfer:offer') {
          ws.send(
            JSON.stringify({
              type: 'transfer:peer-offline',
              transferId: msg.transferId,
              toDeviceId: targetDeviceId,
            })
          );
        }
        return;
      }

      // Enrich transfer:offer with verified sender info & whether sender/receiver share the same LAN IP
      if (msg.type === 'transfer:offer') {
        const senderDevice = db.prepare('SELECT device_name, os, is_trusted FROM devices WHERE id = ?').get(deviceId) as any;
        const targetUser = db
          .prepare('SELECT auto_accept_trusted FROM users WHERE id = ?')
          .get(targetClient.userId) as any;
        const isSelfTransfer = targetClient.userId === authUser.id;
        const isSenderTrusted = isSelfTransfer && senderDevice?.is_trusted === 1;
        const autoAccept = Boolean(targetUser?.auto_accept_trusted === 1 && isSenderTrusted);

        sendWs(targetDeviceId, {
          ...msg,
          fromUserId: authUser.id,
          fromUsername: authUser.username,
          fromDisplayName: authUser.displayName,
          fromAvatarUrl: authUser.avatarUrl,
          fromDeviceId: deviceId,
          fromDeviceName: senderDevice?.device_name || 'Peer Device',
          fromDeviceOs: senderDevice?.os || 'Web',
          sameNetwork: ipHash === targetClient.ipHash,
          autoAccept,
        });
        return;
      }

      // Forward signaling & control messages securely
      const allowedForwardTypes = new Set([
        'signal:offer',
        'signal:answer',
        'signal:ice',
        'ecdh:pubkey',
        'transfer:accept',
        'transfer:decline',
        'transfer:pause',
        'transfer:resume',
        'transfer:cancel',
        'transfer:ack',
        'transfer:complete',
        'transfer:error',
        'transfer:relay-ready',
      ]);

      if (allowedForwardTypes.has(msg.type)) {
        sendWs(targetDeviceId, {
          ...msg,
          fromUserId: authUser.id,
          fromDeviceId: deviceId,
          sameNetwork: ipHash === targetClient.ipHash,
        });
      }
    });

    ws.on('close', () => {
      const current = connectedDevices.get(deviceId);
      if (current && current.ws === ws) {
        connectedDevices.delete(deviceId);
        db.prepare('UPDATE devices SET is_online = 0, last_seen = ? WHERE id = ?').run(Date.now(), deviceId);
        broadcastUserDevicePresence(authUser.id);
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Senda server listening on http://localhost:${PORT}`);
  });
}

startServer();
