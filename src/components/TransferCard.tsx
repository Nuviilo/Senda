import {
  CheckCircle2,
  Download,
  FolderArchive,
  Pause,
  Play,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { useTransfer } from '../context/TransferContext';
import {
  downloadFilesAsZip,
  formatBytes,
  formatEta,
  formatSpeed,
  triggerBlobDownload,
} from '../lib/fileUtils';
import type { ActiveTransfer } from '../types/senda';
import { FileTypeIcon } from './FileTypeIcon';

function transportLabel(mode: ActiveTransfer['transport']): string {
  switch (mode) {
    case 'webrtc-lan':
      return 'Direct LAN';
    case 'webrtc-p2p':
      return 'Peer-to-Peer';
    case 'ws-relay':
      return 'Encrypted Relay';
  }
}

export function TransferCard({ transfer }: { transfer: ActiveTransfer }) {
  const { pauseTransfer, resumeTransfer, cancelTransfer, dismissTransfer } = useTransfer();
  const [zipping, setZipping] = useState(false);

  const primaryFile = transfer.files[0];
  const title =
    transfer.files.length === 1
      ? primaryFile?.name || 'File'
      : `${primaryFile?.name || 'Files'} + ${transfer.files.length - 1} more`;

  const isRunning =
    transfer.status === 'active' ||
    transfer.status === 'connecting' ||
    transfer.status === 'pending' ||
    transfer.status === 'paused';

  const handleSaveAllZip = async () => {
    const withBlobs = (transfer.receivedFiles || []).filter(
      (f): f is typeof f & { blob: Blob } => Boolean(f.blob)
    );
    if (withBlobs.length === 0) return;
    setZipping(true);
    try {
      await downloadFilesAsZip(
        withBlobs.map((f) => ({ relativePath: f.relativePath, blob: f.blob })),
        `senda-${transfer.peerUsername}-${transfer.id.slice(0, 6)}.zip`
      );
    } finally {
      setZipping(false);
    }
  };

  return (
    <div className="bg-white dark:bg-[#13161C] border border-zinc-200/90 dark:border-zinc-800 rounded-xl p-4 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-zinc-100 dark:bg-zinc-800/80 text-zinc-700 dark:text-zinc-200 flex items-center justify-center shrink-0">
            <FileTypeIcon
              fileName={transfer.currentFileName || primaryFile?.name || 'file'}
              mimeType={primaryFile?.mimeType}
              className="w-5 h-5"
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                {title}
              </p>
              {transfer.integrityVerified && (
                <ShieldCheck
                  className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0"
                  aria-label="SHA-256 verified"
                />
              )}
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 truncate">
              {transfer.direction === 'send' ? 'To' : 'From'} {transfer.peerDisplayName} (@{transfer.peerUsername})
              {' · '}
              {transfer.peerDeviceName}
              {' · '}
              <span className="font-mono tabular-nums">{formatBytes(transfer.totalBytes)}</span>
              {' · '}
              <span>{transportLabel(transfer.transport)}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {transfer.status === 'active' && (
            <button
              type="button"
              onClick={() => pauseTransfer(transfer.id)}
              title="Pause transfer"
              className="min-w-[36px] min-h-[36px] rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center transition-colors"
            >
              <Pause className="w-4 h-4" />
            </button>
          )}
          {transfer.status === 'paused' && (
            <button
              type="button"
              onClick={() => resumeTransfer(transfer.id)}
              title="Resume transfer"
              className="min-w-[36px] min-h-[36px] rounded-lg bg-[#2563EB] text-white hover:bg-[#1D4ED8] flex items-center justify-center transition-colors"
            >
              <Play className="w-4 h-4" />
            </button>
          )}
          {isRunning ? (
            <button
              type="button"
              onClick={() => cancelTransfer(transfer.id)}
              title="Cancel transfer"
              className="min-w-[36px] min-h-[36px] rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:text-red-600 hover:border-red-300 dark:hover:border-red-800 flex items-center justify-center transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => dismissTransfer(transfer.id)}
              title="Dismiss"
              className="min-w-[36px] min-h-[36px] rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 flex items-center justify-center transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar & Real-time Telemetry */}
      <div className="mt-3">
        <div className="h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-150 ${
              transfer.status === 'failed' || transfer.status === 'declined'
                ? 'bg-red-500'
                : transfer.status === 'cancelled'
                ? 'bg-zinc-400'
                : transfer.status === 'completed'
                ? 'bg-emerald-600 dark:bg-emerald-500'
                : 'bg-[#2563EB]'
            }`}
            style={{ width: `${Math.max(transfer.progress, transfer.status === 'pending' ? 3 : 0)}%` }}
          />
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <div className="flex items-center gap-2">
            {transfer.status === 'completed' ? (
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Completed
              </span>
            ) : transfer.status === 'failed' || transfer.status === 'declined' ? (
              <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 font-medium">
                <XCircle className="w-3.5 h-3.5" />
                {transfer.errorMessage || (transfer.status === 'declined' ? 'Declined' : 'Failed')}
              </span>
            ) : transfer.status === 'pending' ? (
              <span>Waiting for peer acceptance...</span>
            ) : transfer.status === 'connecting' ? (
              <span>Establishing direct connection...</span>
            ) : transfer.status === 'paused' ? (
              <span>Paused</span>
            ) : transfer.status === 'cancelled' ? (
              <span>Cancelled</span>
            ) : (
              <span className="truncate max-w-[220px]">{transfer.currentFileName}</span>
            )}
          </div>

          <div className="flex items-center gap-2 font-mono tabular-nums">
            <span>{transfer.progress.toFixed(0)}%</span>
            {transfer.status === 'active' && (
              <>
                <span aria-hidden="true">·</span>
                <span>{formatSpeed(transfer.speedBps)}</span>
                <span aria-hidden="true">·</span>
                <span>{formatEta(transfer.etaSeconds)}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Completed Received Files Actions */}
      {transfer.status === 'completed' &&
        transfer.direction === 'receive' &&
        transfer.receivedFiles &&
        transfer.receivedFiles.some((f) => f.blob) && (
          <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800 flex flex-wrap items-center gap-2">
            {transfer.receivedFiles.length > 1 && (
              <button
                type="button"
                disabled={zipping}
                onClick={handleSaveAllZip}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2563EB] text-white text-xs font-medium hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors"
              >
                <FolderArchive className="w-3.5 h-3.5" />
                {zipping ? 'Preparing ZIP...' : `Download All (${transfer.receivedFiles.length} files)`}
              </button>
            )}
            {transfer.receivedFiles.slice(0, 4).map((f, idx) =>
              f.blob ? (
                <button
                  key={`${f.relativePath}-${idx}`}
                  type="button"
                  onClick={() => triggerBlobDownload(f.blob!, f.name)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span className="truncate max-w-[160px]">{f.name}</span>
                </button>
              ) : null
            )}
          </div>
        )}
    </div>
  );
}
