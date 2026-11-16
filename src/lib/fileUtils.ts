import { zip } from 'fflate';
import type { QueuedFileItem } from '../types/senda';

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, exp);
  return `${val >= 100 || exp === 0 ? val.toFixed(0) : val.toFixed(val >= 10 ? 1 : 2)} ${units[exp]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '0.0 MB/s';
  const mbps = bytesPerSec / (1024 * 1024);
  if (mbps < 0.1) {
    const kbps = bytesPerSec / 1024;
    return `${kbps.toFixed(0)} KB/s`;
  }
  return `${mbps.toFixed(1)} MB/s`;
}

export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return 'Calculating...';
  if (seconds < 1) return '< 1s left';
  if (seconds < 60) return `${Math.ceil(seconds)}s left`;
  const mins = Math.floor(seconds / 60);
  const remSec = Math.ceil(seconds % 60);
  if (mins < 60) return `${mins}m ${remSec}s left`;
  const hrs = Math.floor(mins / 60);
  const remMin = mins % 60;
  return `${hrs}h ${remMin}m left`;
}

export function formatRelativeTime(ts: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 15) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function filesToQueuedItems(fileList: FileList | File[]): QueuedFileItem[] {
  const items: QueuedFileItem[] = [];
  const arr = Array.from(fileList);
  for (const file of arr) {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    items.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      file,
      name: file.name,
      relativePath: rel && rel.length > 0 ? rel : file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
    });
  }
  return items;
}

// Recursively traverse dropped files and folders via webkitGetAsEntry
export async function extractDroppedItems(dataTransfer: DataTransfer): Promise<QueuedFileItem[]> {
  const items = Array.from(dataTransfer.items || []);
  const entries = items
    .map((item) => (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => Boolean(entry));

  if (entries.length === 0) {
    return filesToQueuedItems(dataTransfer.files);
  }

  const collected: QueuedFileItem[] = [];

  async function walkEntry(entry: FileSystemEntry, prefix: string): Promise<void> {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      await new Promise<void>((resolve) => {
        fileEntry.file(
          (file) => {
            const relPath = prefix ? `${prefix}/${file.name}` : file.name;
            collected.push({
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
              file,
              name: file.name,
              relativePath: relPath,
              size: file.size,
              mimeType: file.type || 'application/octet-stream',
            });
            resolve();
          },
          () => resolve()
        );
      });
    } else if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry;
      const reader = dirEntry.createReader();
      const nextPrefix = prefix ? `${prefix}/${dirEntry.name}` : dirEntry.name;

      const readAllEntries = (): Promise<FileSystemEntry[]> =>
        new Promise((resolve) => {
          const all: FileSystemEntry[] = [];
          const readBatch = () => {
            reader.readEntries(
              (batch) => {
                if (batch.length === 0) {
                  resolve(all);
                } else {
                  all.push(...batch);
                  readBatch();
                }
              },
              () => resolve(all)
            );
          };
          readBatch();
        });

      const children = await readAllEntries();
      for (const child of children) {
        await walkEntry(child, nextPrefix);
      }
    }
  }

  for (const entry of entries) {
    await walkEntry(entry, '');
  }

  return collected;
}

// Trigger browser file download for a received Blob
export function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Package multiple received files (with folder structure) into a single ZIP download
export async function downloadFilesAsZip(
  files: Array<{ relativePath: string; blob: Blob }>,
  zipName = 'senda-transfer.zip'
): Promise<void> {
  const entries: Record<string, Uint8Array> = {};
  for (const item of files) {
    const buf = await item.blob.arrayBuffer();
    entries[item.relativePath] = new Uint8Array(buf);
  }
  const zipped = await new Promise<Uint8Array>((resolve, reject) => {
    zip(entries, { level: 0 }, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
  const blob = new Blob([new Uint8Array(zipped)], { type: 'application/zip' });
  triggerBlobDownload(blob, zipName);
}

// Write a received file stream directly to a user-selected directory handle (Chrome/Edge Desktop)
export async function getDirectoryWritableStream(
  rootDir: FileSystemDirectoryHandle,
  relativePath: string
): Promise<FileSystemWritableFileStream> {
  const segments = relativePath.split('/').filter(Boolean);
  const fileName = segments.pop() || 'received-file';
  let currentDir = rootDir;
  for (const folder of segments) {
    currentDir = await currentDir.getDirectoryHandle(folder, { create: true });
  }
  const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
  return fileHandle.createWritable();
}

export function supportsDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && typeof (window as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}
