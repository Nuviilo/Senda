import {
  AlertTriangle,
  Bell,
  Camera,
  CheckCircle2,
  FolderOpen,
  Laptop,
  Loader2,
  LogOut,
  Mail,
  Monitor,
  Moon,
  ShieldCheck,
  Smartphone,
  Sun,
  Trash2,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { Avatar } from '../components/Avatar';
import { useAuth } from '../context/AuthContext';
import { useTransfer } from '../context/TransferContext';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { apiRequest } from '../lib/api';
import { supportsDirectoryPicker } from '../lib/fileUtils';
import { LANGUAGE_OPTIONS } from '../lib/i18n';
import type { NavTab, ThemePreference } from '../types/senda';

interface SettingsViewProps {
  onNavigate: (tab: NavTab) => void;
  onOpenPackaging: () => void;
}

async function resizeAvatarFile(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');

  const minSide = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - minSide) / 2;
  const sy = (bitmap.height - minSide) / 2;
  ctx.drawImage(bitmap, sx, sy, minSide, minSide, 0, 0, size, size);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.88);
}

export function SettingsView({ onNavigate, onOpenPackaging }: SettingsViewProps) {
  const { user, logout, updateProfile, refreshSession, setThemePreference } = useAuth();
  const { downloadDirName, pickDownloadDirectory, showToast } = useTransfer();
  const { isInstallable, isInstalled, install } = usePWAInstall();

  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [username, setUsername] = useState(user?.username || '');
  const [usernameStatus, setUsernameStatus] = useState<{
    checking: boolean;
    available: boolean | null;
    reason: string | null;
  }>({ checking: false, available: null, reason: null });

  const [savingProfile, setSavingProfile] = useState(false);

  // Email verification
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyPreviewCode, setVerifyPreviewCode] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  // Change Email
  const [newEmail, setNewEmail] = useState('');
  const [emailChangePassword, setEmailChangePassword] = useState('');
  const [emailChangeCode, setEmailChangeCode] = useState('');
  const [emailChangePending, setEmailChangePending] = useState(false);
  const [emailChangePreview, setEmailChangePreview] = useState<string | null>(null);

  // Change Password
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changingPass, setChangingPass] = useState(false);

  // Delete Account
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);

  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName);
      setUsername(user.username);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const clean = username.trim().toLowerCase().replace(/^@/, '');
    if (!clean || clean === user.username) {
      setUsernameStatus({ checking: false, available: null, reason: null });
      return;
    }
    setUsernameStatus((s) => ({ ...s, checking: true }));
    const timer = window.setTimeout(async () => {
      try {
        const res = await apiRequest<{ available: boolean; valid: boolean; reason: string | null }>(
          `/api/users/check-username?username=${encodeURIComponent(clean)}`
        );
        setUsernameStatus({
          checking: false,
          available: res.valid && res.available,
          reason: res.reason,
        });
      } catch {
        setUsernameStatus({ checking: false, available: null, reason: null });
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [username, user]);

  if (!user) return null;

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await updateProfile({
        displayName: displayName.trim(),
        username: username.trim().toLowerCase().replace(/^@/, ''),
      });
      showToast('Profile updated', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to save profile', 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await resizeAvatarFile(file);
      await updateProfile({ avatarUrl: dataUrl });
      showToast('Profile picture updated', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to upload image', 'error');
    } finally {
      e.target.value = '';
    }
  };

  const handleSendVerifyEmail = async () => {
    try {
      const res = await apiRequest<{ sent: boolean; verificationPreview?: { code: string } | null }>(
        '/api/auth/send-verification',
        { method: 'POST' }
      );
      setVerifyPreviewCode(res.verificationPreview?.code || null);
      showToast('Verification code sent', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not send code', 'error');
    }
  };

  const handleConfirmVerifyEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerifying(true);
    try {
      await apiRequest('/api/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ code: verifyCode.trim(), email: user.email }),
      });
      setVerifyCode('');
      setVerifyPreviewCode(null);
      await refreshSession();
      showToast('Email verified', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Verification failed', 'error');
    } finally {
      setVerifying(false);
    }
  };

  const handleRequestEmailChange = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiRequest<{ sent: boolean; verificationPreview?: { code: string } | null }>(
        '/api/users/change-email',
        {
          method: 'POST',
          body: JSON.stringify({
            newEmail: newEmail.trim(),
            currentPassword: emailChangePassword,
          }),
        }
      );
      setEmailChangePending(true);
      setEmailChangePreview(res.verificationPreview?.code || null);
      showToast('Confirmation code sent to new email', 'info');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to request email change', 'error');
    }
  };

  const handleConfirmEmailChange = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ code: emailChangeCode.trim(), email: newEmail.trim() }),
      });
      setEmailChangePending(false);
      setNewEmail('');
      setEmailChangePassword('');
      setEmailChangeCode('');
      setEmailChangePreview(null);
      await refreshSession();
      showToast('Email updated and verified', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Invalid confirmation code', 'error');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangingPass(true);
    try {
      await apiRequest('/api/users/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      showToast('Password updated', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Password change failed', 'error');
    } finally {
      setChangingPass(false);
    }
  };

  const handleToggleNotifications = async () => {
    const next = !user.notificationsEnabled;
    if (next && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch {}
    }
    await updateProfile({ notificationsEnabled: next });
    showToast(next ? 'Notifications enabled' : 'Notifications muted', 'info');
  };

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeleting(true);
    try {
      await apiRequest('/api/users/me', {
        method: 'DELETE',
        body: JSON.stringify({ password: deletePassword }),
      });
      await logout();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not delete account', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Settings
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Manage your profile, security, transfer preferences, and native app builds.
        </p>
      </div>

      {/* Profile & Avatar */}
      <section className="bg-white dark:bg-[#13161C] border border-zinc-200/90 dark:border-zinc-800 rounded-2xl p-5 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar name={user.displayName} src={user.avatarUrl} size="xl" />
            <div>
              <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                {user.displayName}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
                @{user.username}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-800 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <Camera className="w-3.5 h-3.5" />
              Change Photo
            </button>
            {user.avatarUrl && (
              <button
                type="button"
                onClick={() => void updateProfile({ avatarUrl: '' })}
                className="px-3 py-2 rounded-xl text-xs font-medium text-zinc-500 hover:text-red-600 transition-colors"
              >
                Remove
              </button>
            )}
          </div>
        </div>

        <form onSubmit={handleSaveProfile} className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              Display name
            </label>
            <input
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-[#0B0D11] text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              Username
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400 font-mono">
                @
              </span>
              <input
                type="text"
                required
                value={username}
                onChange={(e) =>
                  setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))
                }
                className="w-full h-10 pl-7 pr-8 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-[#0B0D11] text-sm font-mono"
              />
              {usernameStatus.checking && (
                <Loader2 className="w-4 h-4 animate-spin text-zinc-400 absolute right-2.5 top-1/2 -translate-y-1/2" />
              )}
              {!usernameStatus.checking && usernameStatus.available === true && (
                <CheckCircle2 className="w-4 h-4 text-emerald-500 absolute right-2.5 top-1/2 -translate-y-1/2" />
              )}
            </div>
            {usernameStatus.reason && (
              <p className="text-[11px] text-red-600 dark:text-red-400 mt-1">
                {usernameStatus.reason}
              </p>
            )}
          </div>

          <div className="sm:col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={savingProfile || usernameStatus.available === false}
              className="px-4 py-2 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold disabled:opacity-50 transition-colors"
            >
              {savingProfile ? 'Saving...' : 'Save Profile'}
            </button>
          </div>
        </form>
      </section>

      {/* Email & Verification */}
      <section className="bg-white dark:bg-[#13161C] border border-zinc-200/90 dark:border-zinc-800 rounded-2xl p-5 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Email & Verification
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Private email: <span className="font-mono text-zinc-800 dark:text-zinc-200">{user.email}</span>
              {' · '}
              <span className={user.emailVerified ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-amber-600 dark:text-amber-400 font-medium'}>
                {user.emailVerified ? 'Verified' : 'Unverified'}
              </span>
            </p>
          </div>

          {!user.emailVerified && (
            <button
              type="button"
              onClick={() => void handleSendVerifyEmail()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <Mail className="w-3.5 h-3.5" />
              Send Verification Code
            </button>
          )}
        </div>

        {!user.emailVerified && (
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#0B0D11] p-4 space-y-3">
            {verifyPreviewCode && (
              <p className="text-xs text-blue-700 dark:text-blue-300 font-mono">
                Verification code (instant preview): <strong>{verifyPreviewCode}</strong>
              </p>
            )}
            <form onSubmit={handleConfirmVerifyEmail} className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                required
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value)}
                placeholder="Enter 6-digit code"
                className="h-9 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#13161C] text-xs font-mono w-44"
              />
              <button
                type="submit"
                disabled={verifying}
                className="px-3.5 py-2 rounded-lg bg-[#2563EB] text-white text-xs font-semibold hover:bg-[#1D4ED8] disabled:opacity-50"
              >
                {verifying ? 'Verifying...' : 'Verify Email'}
              </button>
            </form>
          </div>
        )}

        {/* Change Email */}
        <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800">
          <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2.5">
            Change email address
          </p>
          {!emailChangePending ? (
            <form onSubmit={handleRequestEmailChange} className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <input
                type="email"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="New email address"
                className="h-10 px-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-[#0B0D11] text-xs"
              />
              <input
                type="password"
                required
                value={emailChangePassword}
                onChange={(e) => setEmailChangePassword(e.target.value)}
                placeholder="Current password"
                className="h-10 px-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-[#0B0D11] text-xs"
              />
              <button
                type="submit"
                className="h-10 px-4 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                Update Email
              </button>
            </form>
          ) : (
            <form onSubmit={handleConfirmEmailChange} className="space-y-2.5">
              {emailChangePreview && (
                <p className="text-xs font-mono text-blue-700 dark:text-blue-300">
                  Confirmation code: <strong>{emailChangePreview}</strong>
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  required
                  value={emailChangeCode}
                  onChange={(e) => setEmailChangeCode(e.target.value)}
                  placeholder="6-digit code sent to new email"
                  className="h-10 px-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-[#0B0D11] text-xs font-mono"
                />
                <button
                  type="submit"
                  className="h-10 px-4 rounded-xl bg-[#2563EB] text-white text-xs font-semibold"
                >
                  Confirm New Email
                </button>
                <button
                  type="button"
                  onClick={() => setEmailChangePending(false)}
                  className="h-10 px-3 text-xs text-zinc-500"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Change Password */}
        <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800">
          <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2.5">
            Change password
          </p>
          <form onSubmit={handleChangePassword} className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Current password"
              className="h-10 px-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-[#0B0D11] text-xs"
            />
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password (min 8 chars)"
              className="h-10 px-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-[#0B0D11] text-xs"
            />
            <button
              type="submit"
              disabled={changingPass}
              className="h-10 px-4 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              {changingPass ? 'Updating...' : 'Change Password'}
            </button>
          </form>
        </div>
      </section>

      {/* Transfer, Appearance & App Preferences */}
      <section className="bg-white dark:bg-[#13161C] border border-zinc-200/90 dark:border-zinc-800 rounded-2xl divide-y divide-zinc-100 dark:divide-zinc-800/80">
        {/* Download Folder */}
        <div className="p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              Default download location
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 truncate">
              {downloadDirName}
            </p>
          </div>
          {supportsDirectoryPicker() ? (
            <button
              type="button"
              onClick={() => void pickDownloadDirectory()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              Select Folder
            </button>
          ) : (
            <span className="text-xs text-zinc-400">Uses device Downloads folder</span>
          )}
        </div>

        {/* Auto-Accept */}
        <div className="p-5 flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-4 h-4 text-zinc-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Auto-accept from trusted devices
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Skip confirmation when receiving files from your own trusted devices
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={user.autoAcceptTrusted}
            onClick={() => void updateProfile({ autoAcceptTrusted: !user.autoAcceptTrusted })}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              user.autoAcceptTrusted ? 'bg-[#2563EB]' : 'bg-zinc-300 dark:bg-zinc-700'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition-transform ${
                user.autoAcceptTrusted ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Notifications */}
        <div className="p-5 flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Bell className="w-4 h-4 text-zinc-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Transfer notifications
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Alert when files arrive or transfers finish
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={user.notificationsEnabled}
            onClick={() => void handleToggleNotifications()}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              user.notificationsEnabled ? 'bg-[#2563EB]' : 'bg-zinc-300 dark:bg-zinc-700'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition-transform ${
                user.notificationsEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Theme */}
        <div className="p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Appearance</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Choose light, dark, or system theme</p>
          </div>
          <div className="flex items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-900 rounded-xl">
            {(
              [
                { id: 'system', label: 'System', icon: Monitor },
                { id: 'light', label: 'Light', icon: Sun },
                { id: 'dark', label: 'Dark', icon: Moon },
              ] as Array<{ id: ThemePreference; label: string; icon: typeof Monitor }>
            ).map((opt) => {
              const Icon = opt.icon;
              const active = user.themePreference === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => void setThemePreference(opt.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    active
                      ? 'bg-white dark:bg-[#1C2029] text-zinc-900 dark:text-zinc-100 shadow-xs'
                      : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Language */}
        <div className="p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Language</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Interface display language</p>
          </div>
          <select
            value={user.language}
            onChange={(e) => void updateProfile({ language: e.target.value })}
            className="h-9 px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#0B0D11] text-xs font-medium"
          >
            {LANGUAGE_OPTIONS.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Manage Devices Shortcut */}
        <div className="p-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Manage devices</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Rename, trust, or remove signed-in devices
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('devices')}
            className="px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            Open Devices
          </button>
        </div>
      </section>

      {/* Install & Native APK / EXE Packaging */}
      <section className="bg-white dark:bg-[#13161C] border border-zinc-200/90 dark:border-zinc-800 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0">
            <Smartphone className="w-5 h-5 text-zinc-700 dark:text-zinc-200" />
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Install Senda on Android & Windows
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Install directly as an app or view step-by-step instructions to compile an .apk and .exe installer.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isInstallable && !isInstalled && (
            <button
              type="button"
              onClick={() => void install()}
              className="px-3.5 py-2 rounded-xl bg-[#2563EB] text-white text-xs font-semibold hover:bg-[#1D4ED8] transition-colors"
            >
              Install App
            </button>
          )}
          <button
            type="button"
            onClick={onOpenPackaging}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <Laptop className="w-3.5 h-3.5" />
            APK & EXE Guide
          </button>
        </div>
      </section>

      {/* Sign Out & Delete Account */}
      <section className="bg-white dark:bg-[#13161C] border border-zinc-200/90 dark:border-zinc-800 rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Account session</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Sign out from this device or permanently delete your Senda account
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => void logout()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-800 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
            <button
              type="button"
              onClick={() => setShowDeleteConfirm((v) => !v)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-red-200 dark:border-red-900/60 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete Account
            </button>
          </div>
        </div>

        {showDeleteConfirm && (
          <form
            onSubmit={handleDeleteAccount}
            className="pt-4 border-t border-zinc-100 dark:border-zinc-800 space-y-3"
          >
            <div className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                This permanently deletes your account, username (@{user.username}), device registry, and transfer history. Enter your password to confirm.
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="password"
                required
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                placeholder="Confirm password"
                className="h-10 px-3 rounded-xl border border-red-200 dark:border-red-900/60 bg-zinc-50 dark:bg-[#0B0D11] text-xs"
              />
              <button
                type="submit"
                disabled={deleting}
                className="h-10 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Permanently Delete'}
              </button>
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="h-10 px-3 text-xs text-zinc-500"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
