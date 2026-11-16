import { Check, Copy, Laptop, Smartphone, X } from 'lucide-react';
import { useState } from 'react';

interface NativePackagingModalProps {
  open: boolean;
  onClose: () => void;
}

export function NativePackagingModal({ open, onClose }: NativePackagingModalProps) {
  const [tab, setTab] = useState<'android' | 'windows'>('android');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!open) return null;

  const copyText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {}
  };

  const androidCommands = `# Prerequisites: Node.js 20+, Java 17, Android Studio (Android SDK)
# 1. Edit capacitor.config.ts -> set server.url to your live Senda backend URL

# 2. Install dependencies & Capacitor Android platform
npm install
npm run build
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap add android
npx cap sync android

# 3. Build an installable APK (or open Android Studio for a signed Play Store .aab)
cd android
./gradlew assembleDebug
# APK output: android/app/build/outputs/apk/debug/app-debug.apk`;

  const windowsCommands = `# Prerequisites: Node.js 20+ on Windows 10/11
# 1. Edit electron/main.cjs -> set SENDA_URL to your live Senda backend URL

# 2. Install Electron & Builder (already configured in package.json + electron/main.cjs)
npm install
npm install -D electron electron-builder

# 3. Build both Senda Setup Installer (.exe) and Portable (.exe)
npm run build
npx electron-builder --win --x64
# Output in dist-electron/:
#   - Senda Setup 1.0.0.exe (NSIS Installer with Desktop + Start Menu shortcuts)
#   - Senda 1.0.0.exe (Portable single-file executable)`;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs p-0 sm:p-4">
      <div className="w-full sm:max-w-2xl bg-white dark:bg-[#13161C] border border-zinc-200 dark:border-zinc-800 rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200/80 dark:border-zinc-800">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Build Android APK & Windows EXE
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Ready-to-build packaging configs (<code className="font-mono">capacitor.config.ts</code> &amp; <code className="font-mono">electron/main.cjs</code>) are included
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[40px] min-h-[40px] rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center transition-colors"
            aria-label="Close packaging guide"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          <div className="flex items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-900 rounded-xl w-fit">
            <button
              type="button"
              onClick={() => setTab('android')}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                tab === 'android'
                  ? 'bg-white dark:bg-[#1C2029] text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <Smartphone className="w-4 h-4" />
              Android (.apk)
            </button>
            <button
              type="button"
              onClick={() => setTab('windows')}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                tab === 'windows'
                  ? 'bg-white dark:bg-[#1C2029] text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <Laptop className="w-4 h-4" />
              Windows (.exe)
            </button>
          </div>

          {tab === 'android' ? (
            <div className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
              <p className="leading-relaxed">
                Senda includes <code className="font-mono text-xs bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">capacitor.config.ts</code> and adaptive icons. Export/download the project to your computer and run:
              </p>
              <div className="relative rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-950 text-zinc-100 p-4 font-mono text-xs overflow-x-auto">
                <button
                  type="button"
                  onClick={() => void copyText('android', androidCommands)}
                  className="absolute top-3 right-3 inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] transition-colors"
                >
                  {copiedId === 'android' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedId === 'android' ? 'Copied' : 'Copy'}
                </button>
                <pre className="leading-relaxed whitespace-pre">{androidCommands}</pre>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                To publish on Google Play Store, run <code className="font-mono">npx cap open android</code>, then choose <strong>Build → Generate Signed Bundle / APK</strong> inside Android Studio.
              </p>
            </div>
          ) : (
            <div className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
              <p className="leading-relaxed">
                Senda includes <code className="font-mono text-xs bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">electron/main.cjs</code> with System Tray support, background transfers, and Start on Windows Startup. Run on your Windows PC:
              </p>
              <div className="relative rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-950 text-zinc-100 p-4 font-mono text-xs overflow-x-auto">
                <button
                  type="button"
                  onClick={() => void copyText('windows', windowsCommands)}
                  className="absolute top-3 right-3 inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] transition-colors"
                >
                  {copiedId === 'windows' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedId === 'windows' ? 'Copied' : 'Copy'}
                </button>
                <pre className="leading-relaxed whitespace-pre">{windowsCommands}</pre>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Both an installer (<code className="font-mono">Senda Setup 1.0.0.exe</code>) and a standalone portable <code className="font-mono">.exe</code> will be created in <code className="font-mono">dist-electron/</code> with your custom Senda icon.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
