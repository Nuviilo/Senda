import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { NextFunction, Request, Response } from 'express';
import { db } from './db.ts';

const secretFilePath = path.resolve(process.cwd(), 'data', '.session_secret');

function getSessionSecret(): string {
  if (process.env.SENDA_SESSION_SECRET && process.env.SENDA_SESSION_SECRET.length >= 16) {
    return process.env.SENDA_SESSION_SECRET;
  }
  if (fs.existsSync(secretFilePath)) {
    return fs.readFileSync(secretFilePath, 'utf8').trim();
  }
  const generated = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(secretFilePath, generated, { mode: 0o600 });
  return generated;
}

const SESSION_SECRET = getSessionSecret();

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, originalHex] = parts;
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  const originalBuf = Buffer.from(originalHex, 'hex');
  if (derivedBuf.length !== originalBuf.length) return false;
  return crypto.timingSafeEqual(derivedBuf, originalBuf);
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return crypto.createHmac('sha256', SESSION_SECRET).update(token).digest('hex');
}

export function generateSixDigitCode(): string {
  return String(crypto.randomInt(100000, 999999));
}

export function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(`${SESSION_SECRET}:${ip}`).digest('hex').slice(0, 16);
}

export function isValidUsername(username: string): boolean {
  return /^[a-z0-9_]{3,24}$/.test(username);
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 160;
}

export interface AuthenticatedRequest extends Request {
  authUser?: {
    id: string;
    email: string;
    emailVerified: boolean;
    username: string;
    displayName: string;
    avatarUrl: string;
    deviceId: string;
    sessionId: string;
  };
}

export function resolveSessionFromToken(rawToken: string) {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const now = Date.now();
  const row = db
    .prepare(
      `SELECT
        s.id AS session_id,
        s.device_id AS device_id,
        s.expires_at AS expires_at,
        u.id AS user_id,
        u.email AS email,
        u.email_verified AS email_verified,
        u.username AS username,
        u.display_name AS display_name,
        u.avatar_url AS avatar_url
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`
    )
    .get(tokenHash, now) as
    | {
        session_id: string;
        device_id: string;
        expires_at: number;
        user_id: string;
        email: string;
        email_verified: number;
        username: string;
        display_name: string;
        avatar_url: string;
      }
    | undefined;

  if (!row) return null;

  db.prepare('UPDATE sessions SET last_active_at = ? WHERE id = ?').run(now, row.session_id);

  return {
    id: row.user_id,
    email: row.email,
    emailVerified: row.email_verified === 1,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    deviceId: row.device_id,
    sessionId: row.session_id,
  };
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const user = resolveSessionFromToken(token);
  if (!user) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }
  req.authUser = user;
  next();
}
