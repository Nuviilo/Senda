import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'senda.db');
export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    avatar_url TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    auto_accept_trusted INTEGER NOT NULL DEFAULT 0,
    default_download_folder TEXT NOT NULL DEFAULT 'Downloads/Senda',
    notifications_enabled INTEGER NOT NULL DEFAULT 1,
    theme_preference TEXT NOT NULL DEFAULT 'system',
    language TEXT NOT NULL DEFAULT 'en',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

  CREATE TABLE IF NOT EXISTS verification_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    code TEXT NOT NULL,
    type TEXT NOT NULL,
    new_email TEXT,
    expires_at INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    device_name TEXT NOT NULL,
    os TEXT NOT NULL,
    device_type TEXT NOT NULL,
    is_trusted INTEGER NOT NULL DEFAULT 0,
    is_online INTEGER NOT NULL DEFAULT 0,
    last_seen INTEGER NOT NULL,
    last_ip_hash TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    last_active_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);

  CREATE TABLE IF NOT EXISTS transfers (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL,
    sender_username TEXT NOT NULL,
    sender_display_name TEXT NOT NULL,
    sender_device_id TEXT NOT NULL,
    sender_device_name TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    recipient_username TEXT NOT NULL,
    recipient_display_name TEXT NOT NULL,
    recipient_device_id TEXT NOT NULL,
    recipient_device_name TEXT NOT NULL,
    file_summary TEXT NOT NULL,
    total_bytes INTEGER NOT NULL,
    file_count INTEGER NOT NULL,
    transport TEXT NOT NULL DEFAULT 'webrtc-p2p',
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    created_at INTEGER NOT NULL,
    completed_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_transfers_sender ON transfers(sender_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_transfers_recipient ON transfers(recipient_id, created_at DESC);
`);

// Reset stale online flags on clean server boot
db.prepare('UPDATE devices SET is_online = 0').run();
