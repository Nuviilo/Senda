import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Mail,
  Moon,
  Sun,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../lib/api';

type AuthMode = 'login' | 'register' | 'forgot' | 'reset';

export function AuthScreen() {
  const { login, register, resolvedTheme, toggleThemeQuick } = useAuth();
  const [mode, setMode] = useState<AuthMode>('login');

  // Form fields
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Username availability
  const [usernameStatus, setUsernameStatus] = useState<{
    checking: boolean;
    available: boolean | null;
    reason: string | null;
  }>({ checking: false, available: null, reason: null });

  // Reset password fields
  const [resetEmail, setResetEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetPreview, setResetPreview] = useState<{ code: string; actionUrl: string } | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Check URL for resetToken or verifyToken
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rt = params.get('resetToken');
    if (rt) {
      setResetToken(rt);
      setMode('reset');
    }
  }, []);

  // Live username availability check
  useEffect(() => {
    if (mode !== 'register') return;
    const clean = username.trim().toLowerCase().replace(/^@/, '');
    if (!clean) {
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
  }, [username, mode]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(identifier, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { verificationPreview } = await register({
        email,
        username: username.trim().toLowerCase().replace(/^@/, ''),
        displayName,
        password,
      });
      if (verificationPreview?.code) {
        sessionStorage.setItem('senda_pending_verify_preview', JSON.stringify(verificationPreview));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Account creation failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setSubmitting(true);
    try {
      const res = await apiRequest<{ sent: boolean; resetPreview?: { code: string; actionUrl: string } | null }>(
        '/api/auth/forgot-password',
        {
          method: 'POST',
          body: JSON.stringify({ email: resetEmail }),
        }
      );
      setResetPreview(res.resetPreview || null);
      setSuccessMsg('If an account exists for that email, a 6-digit reset code has been sent.');
      setMode('reset');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to process request.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setSubmitting(true);
    try {
      await apiRequest('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({
          token: resetToken || undefined,
          code: resetCode || undefined,
          email: resetEmail || undefined,
          newPassword,
        }),
      });
      setSuccessMsg('Password updated. You can now sign in with your new password.');
      setMode('login');
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F8F9FA] dark:bg-[#0B0D11] text-zinc-900 dark:text-zinc-100">
      <header className="flex items-center justify-between px-6 py-4 max-w-6xl w-full mx-auto">
        <div className="flex items-center gap-2.5">
          <img
            src="/src/assets/images/senda_app_icon_1794834881731.jpg"
            alt="Senda"
            className="w-8 h-8 rounded-lg object-cover border border-zinc-200 dark:border-zinc-800"
          />
          <span className="text-lg font-bold tracking-tight">Senda</span>
        </div>

        <button
          type="button"
          onClick={toggleThemeQuick}
          className="min-w-[40px] min-h-[40px] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#13161C] text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 flex items-center justify-center transition-colors"
          aria-label="Toggle theme"
        >
          {resolvedTheme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md bg-white dark:bg-[#13161C] border border-zinc-200/90 dark:border-zinc-800 rounded-2xl p-6 sm:p-8 shadow-xs">
          <div className="mb-6">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              {mode === 'login' && 'Sign in to Senda'}
              {mode === 'register' && 'Create your Senda account'}
              {mode === 'forgot' && 'Reset your password'}
              {mode === 'reset' && 'Choose a new password'}
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1.5">
              {mode === 'login' && 'Transfer files directly across your Android, Windows, and web devices.'}
              {mode === 'register' && 'Claim your unique @username to send and receive files.'}
              {mode === 'forgot' && 'Enter your account email to receive a 6-digit recovery code.'}
              {mode === 'reset' && 'Enter the verification code and your new password.'}
            </p>
          </div>

          {error && (
            <div className="mb-4 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {successMsg && (
            <div className="mb-4 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 px-3.5 py-2.5 text-xs text-emerald-700 dark:text-emerald-300">
              {successMsg}
            </div>
          )}

          {mode === 'reset' && resetPreview && (
            <div className="mb-4 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/30 p-3 text-xs text-blue-800 dark:text-blue-200 space-y-1">
              <div className="flex items-center gap-1.5 font-medium">
                <Mail className="w-3.5 h-3.5" />
                Instant Recovery Code (SMTP not configured)
              </div>
              <p className="font-mono text-sm font-bold tracking-widest">{resetPreview.code}</p>
            </div>
          )}

          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Email or username
                </label>
                <input
                  type="text"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="you@example.com or @username"
                  className="w-full h-11 px-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-[#0B0D11] text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setSuccessMsg(null);
                      setMode('forgot');
                    }}
                    className="text-xs text-[#2563EB] hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full h-11 px-3.5 pr-10 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-[#0B0D11] text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full h-11 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Sign In
                {!submitting && <ArrowRight className="w-4 h-4" />}
              </button>

              <p className="text-center text-xs text-zinc-500 dark:text-zinc-400 pt-2">
                New to Senda?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setSuccessMsg(null);
                    setMode('register');
                  }}
                  className="text-[#2563EB] font-medium hover:underline"
                >
                  Create an account
                </button>
              </p>
            </form>
          )}

          {mode === 'register' && (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Display name
                </label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="John Smith"
                  className="w-full h-11 px-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-[#0B0D11] text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Unique username
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-zinc-400 font-mono">
                    @
                  </span>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    placeholder="johnsmith"
                    className="w-full h-11 pl-8 pr-9 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-[#0B0D11] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                  />
                  {usernameStatus.checking && (
                    <Loader2 className="w-4 h-4 animate-spin text-zinc-400 absolute right-3 top-1/2 -translate-y-1/2" />
                  )}
                  {!usernameStatus.checking && usernameStatus.available === true && (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 absolute right-3 top-1/2 -translate-y-1/2" />
                  )}
                </div>
                {usernameStatus.reason && (
                  <p className="text-[11px] text-red-600 dark:text-red-400 mt-1">
                    {usernameStatus.reason}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Email address (private)
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="john@example.com"
                  className="w-full h-11 px-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-[#0B0D11] text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Password (min. 8 characters)
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Create a strong password"
                    className="w-full h-11 px-3.5 pr-10 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-[#0B0D11] text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting || usernameStatus.available === false}
                className="w-full h-11 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Create Account
              </button>

              <p className="text-center text-xs text-zinc-500 dark:text-zinc-400 pt-2">
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setSuccessMsg(null);
                    setMode('login');
                  }}
                  className="text-[#2563EB] font-medium hover:underline"
                >
                  Sign in
                </button>
              </p>
            </form>
          )}

          {mode === 'forgot' && (
            <form onSubmit={handleForgot} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Account email
                </label>
                <input
                  type="email"
                  required
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full h-11 px-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-[#0B0D11] text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full h-11 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Send Recovery Code
              </button>

              <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className="text-[#2563EB] font-medium hover:underline"
                >
                  Back to sign in
                </button>
              </p>
            </form>
          )}

          {mode === 'reset' && (
            <form onSubmit={handleReset} className="space-y-4">
              {!resetToken && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                      Account email
                    </label>
                    <input
                      type="email"
                      required
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      className="w-full h-11 px-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-[#0B0D11] text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                      6-digit recovery code
                    </label>
                    <input
                      type="text"
                      required
                      value={resetCode}
                      onChange={(e) => setResetCode(e.target.value)}
                      placeholder="123456"
                      className="w-full h-11 px-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-[#0B0D11] text-sm font-mono tracking-widest"
                    />
                  </div>
                </>
              )}
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  New password (min. 8 characters)
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-[#0B0D11] text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full h-11 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Update Password
              </button>

              <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className="text-[#2563EB] font-medium hover:underline"
                >
                  Back to sign in
                </button>
              </p>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
