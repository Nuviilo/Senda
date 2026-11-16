import { Check, FolderOpen, Inbox, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTransfer } from '../context/TransferContext';
import { formatBytes, supportsDirectoryPicker } from '../lib/fileUtils';
import { Avatar } from './Avatar';
import { FileTypeIcon } from './FileTypeIcon';
import { TransferCard } from './TransferCard';

interface ReceiveModalProps {
  open: boolean;
  onClose: () => void;
}

export function ReceiveModal({ open, onClose }: ReceiveModalProps) {
  const { user, updateProfile } = useAuth();
  const {
    incomingRequests,
    activeTransfers,
    downloadDirName,
    pickDownloadDirectory,
    acceptIncomingRequest,
    declineIncomingRequest,
  } = useTransfer();

  if (!open) return null;

  const incomingTransfers = activeTransfers.filter((t) => t.direction === 'receive');

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs p-0 sm:p-4">
      <div className="w-full sm:max-w-xl bg-white dark:bg-[#13161C] border border-zinc-200 dark:border-zinc-800 rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200/80 dark:border-zinc-800">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Receive Files
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Your device is ready to accept incoming peer transfers
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[40px] min-h-[40px] rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center transition-colors"
            aria-label="Close receive panel"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5">
          {/* Download Location & Auto-Accept Controls */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3 bg-zinc-50/70 dark:bg-[#0F1117]">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Download destination
                </p>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate mt-0.5">
                  {downloadDirName}
                </p>
              </div>
              {supportsDirectoryPicker() && (
                <button
                  type="button"
                  onClick={() => void pickDownloadDirectory()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium text-zinc-800 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 shrink-0 transition-colors"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  Choose Folder
                </button>
              )}
            </div>

            <div className="pt-3 border-t border-zinc-200/80 dark:border-zinc-800 flex items-center justify-between gap-4">
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-zinc-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    Auto-accept from trusted devices
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Automatically start transfers sent from your own trusted devices
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={Boolean(user?.autoAcceptTrusted)}
                onClick={() =>
                  void updateProfile({ autoAcceptTrusted: !user?.autoAcceptTrusted })
                }
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  user?.autoAcceptTrusted ? 'bg-[#2563EB]' : 'bg-zinc-300 dark:bg-zinc-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition-transform ${
                    user?.autoAcceptTrusted ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Incoming Requests */}
          {incomingRequests.length === 0 ? (
            <div className="py-10 text-center">
              <div className="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-800/80 text-zinc-500 dark:text-zinc-400 flex items-center justify-center mx-auto">
                <Inbox className="w-6 h-6" strokeWidth={1.6} />
              </div>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mt-3">
                Listening for incoming transfers
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-xs mx-auto">
                Ask someone to search for <span className="font-mono">@{user?.username}</span> or send directly from another signed-in device.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                Incoming Requests ({incomingRequests.length})
              </h3>
              {incomingRequests.map((req) => (
                <div
                  key={req.transferId}
                  className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3 bg-white dark:bg-[#13161C]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar name={req.fromDisplayName} src={req.fromAvatarUrl} size="md" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                          {req.fromDisplayName}
                        </p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                          @{req.fromUsername} · {req.fromDeviceName}
                          {req.sameNetwork ? ' · Same Wi-Fi / LAN' : ''}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs font-mono tabular-nums font-semibold text-zinc-800 dark:text-zinc-200 shrink-0">
                      {formatBytes(req.totalBytes)}
                    </span>
                  </div>

                  <div className="max-h-36 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800 rounded-lg border border-zinc-100 dark:border-zinc-800 px-3">
                    {req.files.map((f, idx) => (
                      <div key={`${f.id}-${idx}`} className="py-2 flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileTypeIcon fileName={f.name} mimeType={f.mimeType} className="w-4 h-4 text-zinc-500 shrink-0" />
                          <span className="truncate text-zinc-800 dark:text-zinc-200">{f.relativePath}</span>
                        </div>
                        <span className="font-mono tabular-nums text-zinc-500 shrink-0">{formatBytes(f.size)}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => declineIncomingRequest(req.transferId)}
                      className="px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    >
                      Decline
                    </button>
                    <button
                      type="button"
                      onClick={() => void acceptIncomingRequest(req.transferId)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#2563EB] text-white text-xs font-medium hover:bg-[#1D4ED8] transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Accept Transfer
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {incomingTransfers.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                Active & Recent Receives
              </h3>
              {incomingTransfers.map((tr) => (
                <TransferCard key={tr.id} transfer={tr} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
