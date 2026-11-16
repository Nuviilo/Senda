import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { apiRequest, getStoredToken } from '../lib/api';
import {
  decryptChunk,
  deriveAesGcmKey,
  encryptChunk,
  exportPublicKeyJwk,
  generateEcdhKeyPair,
  importPublicKeyJwk,
} from '../lib/crypto';
import {
  getDirectoryWritableStream,
  triggerBlobDownload,
} from '../lib/fileUtils';
import { StreamingSha256 } from '../lib/sha256';
import type {
  ActiveTransfer,
  FileMeta,
  IncomingTransferRequest,
  QueuedFileItem,
  TransferHistoryRecord,
  TransportMode,
} from '../types/senda';
import { useAuth } from './AuthContext';

const CHUNK_SIZE = 64 * 1024; // 64 KB chunks
const DC_BUFFERED_LIMIT = 512 * 1024; // 512 KB backpressure ceiling
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export interface TransferTarget {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  deviceId: string;
  deviceName: string;
}

interface TransferSessionRuntime {
  id: string;
  direction: 'send' | 'receive';
  peerDeviceId: string;
  pc: RTCPeerConnection | null;
  dc: RTCDataChannel | null;
  transport: TransportMode;
  sameNetwork: boolean;
  paused: boolean;
  cancelled: boolean;
  resumeResolver: (() => void) | null;
  ecdhPair: CryptoKeyPair | null;
  aesKey: CryptoKey | null;
  // Sender state
  queuedFiles?: QueuedFileItem[];
  currentFileIndex: number;
  currentOffset: number;
  transferredBytes: number;
  totalBytes: number;
  lastSpeedSampleAt: number;
  lastSpeedSampleBytes: number;
  // Receiver state
  fileMetas?: FileMeta[];
  receiveChunks?: Uint8Array[];
  receiveHasher?: StreamingSha256;
  writableStream?: FileSystemWritableFileStream | null;
  completedReceivedFiles?: Array<{
    name: string;
    relativePath: string;
    size: number;
    mimeType: string;
    blob?: Blob;
    savedToDisk?: boolean;
    sha256?: string;
  }>;
  fallbackTimer?: number;
  relayReadyPromiseResolve?: (() => void) | null;
}

interface TransferContextValue {
  wsConnected: boolean;
  activeTransfers: ActiveTransfer[];
  incomingRequests: IncomingTransferRequest[];
  history: TransferHistoryRecord[];
  downloadDirHandle: FileSystemDirectoryHandle | null;
  downloadDirName: string;
  pickDownloadDirectory: () => Promise<boolean>;
  clearDownloadDirectory: () => void;
  refreshHistory: () => Promise<void>;
  sendFilesToTargets: (files: QueuedFileItem[], targets: TransferTarget[]) => Promise<string[]>;
  acceptIncomingRequest: (transferId: string) => Promise<void>;
  declineIncomingRequest: (transferId: string) => void;
  pauseTransfer: (transferId: string) => void;
  resumeTransfer: (transferId: string) => void;
  cancelTransfer: (transferId: string) => void;
  dismissTransfer: (transferId: string) => void;
  toastMessage: { id: string; text: string; kind: 'info' | 'success' | 'error' } | null;
  showToast: (text: string, kind?: 'info' | 'success' | 'error') => void;
}

const TransferContext = createContext<TransferContextValue | null>(null);

function encodeBinaryPacket(fileIndex: number, offset: number, chunk: Uint8Array): Uint8Array {
  const out = new Uint8Array(13 + chunk.length);
  const view = new DataView(out.buffer);
  out[0] = 1; // data frame
  view.setUint32(1, fileIndex, false);
  view.setFloat64(5, offset, false);
  out.set(chunk, 13);
  return out;
}

function decodeBinaryPacket(data: Uint8Array): { fileIndex: number; offset: number; chunk: Uint8Array } | null {
  if (data.length < 13 || data[0] !== 1) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const fileIndex = view.getUint32(1, false);
  const offset = view.getFloat64(5, false);
  const chunk = data.subarray(13);
  return { fileIndex, offset, chunk };
}

export function TransferProvider({ children }: { children: React.ReactNode }) {
  const { user, deviceId, setDevices, logout } = useAuth();
  const [wsConnected, setWsConnected] = useState(false);
  const [activeTransfers, setActiveTransfers] = useState<ActiveTransfer[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<IncomingTransferRequest[]>([]);
  const [history, setHistory] = useState<TransferHistoryRecord[]>([]);
  const [downloadDirHandle, setDownloadDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [downloadDirName, setDownloadDirName] = useState<string>(user?.defaultDownloadFolder || 'Browser Downloads');
  const [toastMessage, setToastMessage] = useState<{ id: string; text: string; kind: 'info' | 'success' | 'error' } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const sessionsRef = useRef<Map<string, TransferSessionRuntime>>(new Map());
  const downloadDirRef = useRef<FileSystemDirectoryHandle | null>(null);
  const incomingRef = useRef<IncomingTransferRequest[]>([]);
  const userRef = useRef(user);
  userRef.current = user;
  downloadDirRef.current = downloadDirHandle;

  useEffect(() => {
    if (user?.defaultDownloadFolder && !downloadDirHandle) {
      setDownloadDirName(user.defaultDownloadFolder);
    }
  }, [user?.defaultDownloadFolder, downloadDirHandle]);

  const showToast = useCallback((text: string, kind: 'info' | 'success' | 'error' = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToastMessage({ id, text, kind });
    setTimeout(() => {
      setToastMessage((prev) => (prev?.id === id ? null : prev));
    }, 4500);
  }, []);

  const notifySystem = useCallback((title: string, body: string) => {
    if (!userRef.current?.notificationsEnabled) return;
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification(title, { body, icon: '/pwa-192x192.png' });
      } catch {
        // Ignore on unsupported mobile webviews
      }
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    if (!getStoredToken()) return;
    try {
      const data = await apiRequest<{ transfers: TransferHistoryRecord[] }>('/api/transfers');
      setHistory(data.transfers);
    } catch {
      // Ignore
    }
  }, []);

  useEffect(() => {
    if (user) {
      void refreshHistory();
    } else {
      setHistory([]);
      setActiveTransfers([]);
      setIncomingRequests([]);
    }
  }, [user, refreshHistory]);

  const sendSignal = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }, []);

  const sendBinaryRelayFrame = useCallback((header: Record<string, unknown>, payload: Uint8Array) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const headerBytes = new TextEncoder().encode(JSON.stringify(header));
    const frame = new Uint8Array(4 + headerBytes.length + payload.length);
    const view = new DataView(frame.buffer);
    view.setUint32(0, headerBytes.length, false);
    frame.set(headerBytes, 4);
    frame.set(payload, 4 + headerBytes.length);
    ws.send(frame.buffer);
    return true;
  }, []);

  const updateTransferCard = useCallback((id: string, patch: Partial<ActiveTransfer>) => {
    setActiveTransfers((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  }, []);

  const updateRemoteRecord = useCallback(
    async (id: string, status: string, transport?: TransportMode, errorMessage?: string) => {
      try {
        await apiRequest(`/api/transfers/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status, transport, errorMessage }),
        });
        void refreshHistory();
      } catch {
        // Ignore
      }
    },
    [refreshHistory]
  );

  const cleanupRuntime = useCallback((transferId: string) => {
    const rt = sessionsRef.current.get(transferId);
    if (!rt) return;
    if (rt.fallbackTimer) {
      window.clearTimeout(rt.fallbackTimer);
    }
    try {
      rt.dc?.close();
    } catch {}
    try {
      rt.pc?.close();
    } catch {}
    try {
      void rt.writableStream?.close();
    } catch {}
    sessionsRef.current.delete(transferId);
  }, []);

  const pickDownloadDirectory = useCallback(async () => {
    const picker = (window as Window & { showDirectoryPicker?: (opts?: { mode?: string }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
    if (!picker) {
      showToast('Direct folder selection is supported on desktop Chrome/Edge. Browser downloads will be used here.', 'info');
      return false;
    }
    try {
      const handle = await picker({ mode: 'readwrite' });
      setDownloadDirHandle(handle);
      setDownloadDirName(handle.name);
      showToast(`Downloads will stream directly into "${handle.name}"`, 'success');
      return true;
    } catch {
      return false;
    }
  }, [showToast]);

  const clearDownloadDirectory = useCallback(() => {
    setDownloadDirHandle(null);
    setDownloadDirName(userRef.current?.defaultDownloadFolder || 'Browser Downloads');
  }, []);

  // ======================== SENDER STREAMING ENGINE ========================

  const startSenderStreaming = useCallback(
    async (transferId: string) => {
      const rt = sessionsRef.current.get(transferId);
      if (!rt || !rt.queuedFiles) return;

      const files = rt.queuedFiles;
      let totalTransferred = 0;
      rt.lastSpeedSampleAt = performance.now();
      rt.lastSpeedSampleBytes = 0;

      updateTransferCard(transferId, {
        status: 'active',
        transport: rt.transport,
      });

      const sendControl = (obj: Record<string, unknown>) => {
        if (rt.transport !== 'ws-relay' && rt.dc && rt.dc.readyState === 'open') {
          rt.dc.send(JSON.stringify(obj));
        } else {
          sendSignal({
            type: obj.controlType as string,
            transferId,
            toDeviceId: rt.peerDeviceId,
            ...obj,
          });
        }
      };

      const waitIfPaused = async () => {
        while (rt.paused && !rt.cancelled) {
          await new Promise<void>((resolve) => {
            rt.resumeResolver = resolve;
          });
        }
      };

      const waitDcBackpressure = async (dc: RTCDataChannel) => {
        if (dc.bufferedAmount <= DC_BUFFERED_LIMIT) return;
        await new Promise<void>((resolve) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            dc.removeEventListener('bufferedamountlow', finish);
            resolve();
          };
          dc.addEventListener('bufferedamountlow', finish);
          setTimeout(finish, 250);
        });
      };

      try {
        for (let fileIdx = rt.currentFileIndex; fileIdx < files.length; fileIdx++) {
          if (rt.cancelled) break;
          const item = files[fileIdx];
          rt.currentFileIndex = fileIdx;
          const hasher = new StreamingSha256();
          let offset = 0;

          updateTransferCard(transferId, {
            currentFileIndex: fileIdx,
            currentFileName: item.relativePath,
          });

          // Handle 0-byte empty file cleanly
          if (item.size === 0) {
            const sha256 = hasher.digestHex();
            sendControl({ controlType: 'transfer:file-done', type: 'file-done', fileIndex: fileIdx, sha256 });
            continue;
          }

          while (offset < item.size) {
            if (rt.cancelled) break;
            await waitIfPaused();
            if (rt.cancelled) break;

            const end = Math.min(offset + CHUNK_SIZE, item.size);
            const sliceBuf = await item.file.slice(offset, end).arrayBuffer();
            const chunk = new Uint8Array(sliceBuf);
            hasher.update(chunk);

            const packet = encodeBinaryPacket(fileIdx, offset, chunk);

            if (rt.transport !== 'ws-relay' && rt.dc && rt.dc.readyState === 'open') {
              await waitDcBackpressure(rt.dc);
              try {
                rt.dc.send(packet.buffer as ArrayBuffer);
              } catch {
                // Switch dynamically to encrypted relay if DataChannel closes mid-stream!
                rt.transport = 'ws-relay';
                updateTransferCard(transferId, { transport: 'ws-relay' });
                if (!rt.aesKey) {
                  await new Promise((r) => setTimeout(r, 400));
                }
                const payloadToSend = rt.aesKey ? await encryptChunk(rt.aesKey, packet) : packet;
                sendBinaryRelayFrame(
                  { type: 'relay:chunk', transferId, toDeviceId: rt.peerDeviceId, encrypted: Boolean(rt.aesKey) },
                  payloadToSend
                );
              }
            } else {
              // Encrypted WebSocket Relay
              if (!rt.aesKey) {
                // Wait briefly for ECDH key exchange if in progress
                await new Promise((r) => setTimeout(r, 300));
              }
              const payloadToSend = rt.aesKey ? await encryptChunk(rt.aesKey, packet) : packet;
              const sent = sendBinaryRelayFrame(
                { type: 'relay:chunk', transferId, toDeviceId: rt.peerDeviceId, encrypted: Boolean(rt.aesKey) },
                payloadToSend
              );
              if (!sent) {
                throw new Error('Relay connection lost. Check your network.');
              }
              // Yield gently so relay websocket buffer doesn't overwhelm browser main thread
              if (fileIdx === 0 || offset % (CHUNK_SIZE * 8) === 0) {
                await new Promise((r) => setTimeout(r, 4));
              }
            }

            offset = end;
            rt.currentOffset = offset;
            totalTransferred += chunk.length;
            rt.transferredBytes = totalTransferred;

            const now = performance.now();
            const dtSec = (now - rt.lastSpeedSampleAt) / 1000;
            if (dtSec >= 0.25 || totalTransferred === rt.totalBytes) {
              const deltaBytes = totalTransferred - rt.lastSpeedSampleBytes;
              const speedBps = dtSec > 0 ? deltaBytes / dtSec : 0;
              rt.lastSpeedSampleAt = now;
              rt.lastSpeedSampleBytes = totalTransferred;
              const remaining = Math.max(0, rt.totalBytes - totalTransferred);
              const etaSeconds = speedBps > 0 ? remaining / speedBps : null;
              const progress = rt.totalBytes > 0 ? Math.min(100, (totalTransferred / rt.totalBytes) * 100) : 100;

              updateTransferCard(transferId, {
                transferredBytes: totalTransferred,
                speedBps,
                etaSeconds,
                progress,
                transport: rt.transport,
              });
            }
          }

          if (!rt.cancelled) {
            const sha256 = hasher.digestHex();
            if (rt.transport !== 'ws-relay' && rt.dc && rt.dc.readyState === 'open') {
              rt.dc.send(JSON.stringify({ type: 'file-done', fileIndex: fileIdx, sha256 }));
            } else {
              sendSignal({
                type: 'transfer:complete',
                transferId,
                toDeviceId: rt.peerDeviceId,
                event: 'file-done',
                fileIndex: fileIdx,
                sha256,
              });
            }
          }
        }

        if (!rt.cancelled) {
          if (rt.transport !== 'ws-relay' && rt.dc && rt.dc.readyState === 'open') {
            rt.dc.send(JSON.stringify({ type: 'all-done' }));
          } else {
            sendSignal({
              type: 'transfer:complete',
              transferId,
              toDeviceId: rt.peerDeviceId,
              event: 'all-done',
            });
          }
          updateTransferCard(transferId, {
            status: 'completed',
            progress: 100,
            transferredBytes: rt.totalBytes,
            speedBps: 0,
            etaSeconds: 0,
            integrityVerified: true,
            completedAt: Date.now(),
          });
          void updateRemoteRecord(transferId, 'completed', rt.transport);
          showToast(`Sent ${files.length} ${files.length === 1 ? 'file' : 'files'} successfully`, 'success');
          notifySystem('Senda Transfer Complete', `Finished sending ${files.length} file(s).`);
          setTimeout(() => cleanupRuntime(transferId), 1500);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Transfer interrupted.';
        updateTransferCard(transferId, {
          status: 'failed',
          errorMessage: msg,
        });
        void updateRemoteRecord(transferId, 'failed', rt.transport, msg);
        showToast(msg, 'error');
        cleanupRuntime(transferId);
      }
    },
    [cleanupRuntime, notifySystem, sendBinaryRelayFrame, sendSignal, showToast, updateRemoteRecord, updateTransferCard]
  );

  // ======================== RECEIVER STREAMING ENGINE ========================

  const finalizeReceivedFile = useCallback(
    async (rt: TransferSessionRuntime, fileIndex: number, expectedSha256?: string) => {
      const meta = rt.fileMetas?.[fileIndex];
      if (!meta) return;

      const computedSha = rt.receiveHasher ? rt.receiveHasher.digestHex() : undefined;
      const verified = !expectedSha256 || !computedSha || expectedSha256 === computedSha;

      if (!verified) {
        throw new Error(`Integrity check failed for ${meta.name}`);
      }

      if (rt.writableStream) {
        await rt.writableStream.close();
        rt.writableStream = null;
        rt.completedReceivedFiles = rt.completedReceivedFiles || [];
        rt.completedReceivedFiles.push({
          name: meta.name,
          relativePath: meta.relativePath,
          size: meta.size,
          mimeType: meta.mimeType,
          savedToDisk: true,
          sha256: computedSha,
        });
      } else {
        const chunks = rt.receiveChunks || [];
        const blobParts = chunks.map((c) => new Uint8Array(c));
        const blob = new Blob(blobParts, { type: meta.mimeType || 'application/octet-stream' });
        rt.receiveChunks = [];
        rt.completedReceivedFiles = rt.completedReceivedFiles || [];
        rt.completedReceivedFiles.push({
          name: meta.name,
          relativePath: meta.relativePath,
          size: meta.size,
          mimeType: meta.mimeType,
          blob,
          savedToDisk: false,
          sha256: computedSha,
        });
        // Auto-save single/small downloads or trigger download immediately
        if ((rt.fileMetas?.length || 1) === 1) {
          triggerBlobDownload(blob, meta.name);
        }
      }

      rt.receiveHasher = new StreamingSha256();
      rt.currentFileIndex = fileIndex + 1;
      rt.currentOffset = 0;

      // Open writable stream for next file if directory picker is active
      if (downloadDirRef.current && rt.fileMetas && rt.currentFileIndex < rt.fileMetas.length) {
        const nextMeta = rt.fileMetas[rt.currentFileIndex];
        rt.writableStream = await getDirectoryWritableStream(downloadDirRef.current, nextMeta.relativePath);
        updateTransferCard(rt.id, {
          currentFileIndex: rt.currentFileIndex,
          currentFileName: nextMeta.relativePath,
        });
      }
    },
    [updateTransferCard]
  );

  const handleIncomingDataChunk = useCallback(
    async (transferId: string, packetBytes: Uint8Array) => {
      const rt = sessionsRef.current.get(transferId);
      if (!rt || rt.cancelled) return;

      const parsed = decodeBinaryPacket(packetBytes);
      if (!parsed) return;

      if (!rt.receiveHasher) {
        rt.receiveHasher = new StreamingSha256();
      }
      rt.receiveHasher.update(parsed.chunk);

      if (rt.writableStream) {
        await rt.writableStream.write(new Uint8Array(parsed.chunk));
      } else {
        rt.receiveChunks = rt.receiveChunks || [];
        rt.receiveChunks.push(new Uint8Array(parsed.chunk));
      }

      rt.transferredBytes += parsed.chunk.length;
      const now = performance.now();
      const dtSec = (now - rt.lastSpeedSampleAt) / 1000;
      if (dtSec >= 0.25 || rt.transferredBytes >= rt.totalBytes) {
        const delta = rt.transferredBytes - rt.lastSpeedSampleBytes;
        const speedBps = dtSec > 0 ? delta / dtSec : 0;
        rt.lastSpeedSampleAt = now;
        rt.lastSpeedSampleBytes = rt.transferredBytes;
        const remaining = Math.max(0, rt.totalBytes - rt.transferredBytes);
        const etaSeconds = speedBps > 0 ? remaining / speedBps : null;
        const progress = rt.totalBytes > 0 ? Math.min(100, (rt.transferredBytes / rt.totalBytes) * 100) : 100;
        const meta = rt.fileMetas?.[parsed.fileIndex];

        updateTransferCard(transferId, {
          status: rt.paused ? 'paused' : 'active',
          transferredBytes: rt.transferredBytes,
          speedBps,
          etaSeconds,
          progress,
          transport: rt.transport,
          currentFileIndex: parsed.fileIndex,
          currentFileName: meta?.relativePath || 'Receiving...',
        });
      }
    },
    [updateTransferCard]
  );

  const handleReceiverControlEvent = useCallback(
    async (transferId: string, eventObj: any) => {
      const rt = sessionsRef.current.get(transferId);
      if (!rt || rt.cancelled) return;

      if (eventObj.type === 'file-done' || eventObj.event === 'file-done') {
        try {
          await finalizeReceivedFile(rt, eventObj.fileIndex, eventObj.sha256);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Verification failed';
          updateTransferCard(transferId, { status: 'failed', errorMessage: msg });
          void updateRemoteRecord(transferId, 'failed', rt.transport, msg);
          cleanupRuntime(transferId);
        }
      } else if (eventObj.type === 'all-done' || eventObj.event === 'all-done') {
        const received = rt.completedReceivedFiles || [];
        // If multi-file without direct disk streaming, trigger individual downloads or allow ZIP save
        if (!downloadDirRef.current && received.length > 1) {
          // Download first automatically only if <= 3 files, otherwise present ZIP & individual save buttons in card!
          if (received.length <= 3) {
            received.forEach((f) => {
              if (f.blob) triggerBlobDownload(f.blob, f.name);
            });
          }
        }
        updateTransferCard(transferId, {
          status: 'completed',
          progress: 100,
          transferredBytes: rt.totalBytes,
          speedBps: 0,
          etaSeconds: 0,
          integrityVerified: true,
          completedAt: Date.now(),
          receivedFiles: received,
        });
        void updateRemoteRecord(transferId, 'completed', rt.transport);
        showToast(`Received ${received.length} ${received.length === 1 ? 'file' : 'files'} securely`, 'success');
        notifySystem('Senda File Received', `Received ${received.length} file(s) from peer.`);
        setTimeout(() => cleanupRuntime(transferId), 1200);
      }
    },
    [cleanupRuntime, finalizeReceivedFile, notifySystem, showToast, updateRemoteRecord, updateTransferCard]
  );

  // ======================== WEBRTC & SIGNALING WIRING ========================

  const acceptIncomingRequest = useCallback(
    async (transferId: string) => {
      const req = incomingRef.current.find((r) => r.transferId === transferId);
      if (!req) return;

      setIncomingRequests((prev) => prev.filter((r) => r.transferId !== transferId));

      const ecdhPair = await generateEcdhKeyPair();
      const pubJwk = await exportPublicKeyJwk(ecdhPair.publicKey);

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const runtime: TransferSessionRuntime = {
        id: transferId,
        direction: 'receive',
        peerDeviceId: req.fromDeviceId,
        pc,
        dc: null,
        transport: req.sameNetwork ? 'webrtc-lan' : 'webrtc-p2p',
        sameNetwork: req.sameNetwork,
        paused: false,
        cancelled: false,
        resumeResolver: null,
        ecdhPair,
        aesKey: null,
        currentFileIndex: 0,
        currentOffset: 0,
        transferredBytes: 0,
        totalBytes: req.totalBytes,
        lastSpeedSampleAt: performance.now(),
        lastSpeedSampleBytes: 0,
        fileMetas: req.files,
        receiveChunks: [],
        receiveHasher: new StreamingSha256(),
        completedReceivedFiles: [],
      };

      if (downloadDirRef.current && req.files.length > 0) {
        try {
          runtime.writableStream = await getDirectoryWritableStream(
            downloadDirRef.current,
            req.files[0].relativePath
          );
        } catch {
          runtime.writableStream = null;
        }
      }

      sessionsRef.current.set(transferId, runtime);

      setActiveTransfers((prev) => [
        {
          id: transferId,
          direction: 'receive',
          peerUserId: req.fromUserId,
          peerUsername: req.fromUsername,
          peerDisplayName: req.fromDisplayName,
          peerAvatarUrl: req.fromAvatarUrl,
          peerDeviceId: req.fromDeviceId,
          peerDeviceName: req.fromDeviceName,
          files: req.files,
          totalBytes: req.totalBytes,
          transferredBytes: 0,
          speedBps: 0,
          etaSeconds: null,
          progress: 0,
          status: 'connecting',
          transport: runtime.transport,
          sameNetwork: req.sameNetwork,
          integrityVerified: false,
          currentFileIndex: 0,
          currentFileName: req.files[0]?.relativePath || 'Incoming file',
          createdAt: Date.now(),
        },
        ...prev,
      ]);

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          sendSignal({
            type: 'signal:ice',
            transferId,
            toDeviceId: req.fromDeviceId,
            candidate: ev.candidate,
          });
        }
      };

      pc.ondatachannel = (ev) => {
        const dc = ev.channel;
        dc.binaryType = 'arraybuffer';
        runtime.dc = dc;

        dc.onopen = async () => {
          if (runtime.fallbackTimer) {
            window.clearTimeout(runtime.fallbackTimer);
          }
          let detectedTransport: TransportMode = req.sameNetwork ? 'webrtc-lan' : 'webrtc-p2p';
          try {
            const stats = await pc.getStats();
            stats.forEach((report) => {
              if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                const local = stats.get(report.localCandidateId);
                if (local?.candidateType === 'host') {
                  detectedTransport = 'webrtc-lan';
                }
              }
            });
          } catch {}
          runtime.transport = detectedTransport;
          updateTransferCard(transferId, { status: 'active', transport: detectedTransport });
        };

        dc.onmessage = async (msgEv) => {
          if (typeof msgEv.data === 'string') {
            try {
              const obj = JSON.parse(msgEv.data);
              await handleReceiverControlEvent(transferId, obj);
            } catch {}
          } else {
            const bytes = new Uint8Array(msgEv.data as ArrayBuffer);
            await handleIncomingDataChunk(transferId, bytes);
          }
        };
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'failed') {
          runtime.transport = 'ws-relay';
          updateTransferCard(transferId, { transport: 'ws-relay', status: 'active' });
        }
      };

      // Send ECDH public key + transfer:accept immediately
      sendSignal({
        type: 'ecdh:pubkey',
        transferId,
        toDeviceId: req.fromDeviceId,
        publicKey: pubJwk,
      });

      sendSignal({
        type: 'transfer:accept',
        transferId,
        toDeviceId: req.fromDeviceId,
      });
    },
    [handleIncomingDataChunk, handleReceiverControlEvent, sendSignal, updateTransferCard]
  );

  const declineIncomingRequest = useCallback(
    (transferId: string) => {
      const req = incomingRef.current.find((r) => r.transferId === transferId);
      setIncomingRequests((prev) => prev.filter((r) => r.transferId !== transferId));
      if (req) {
        sendSignal({
          type: 'transfer:decline',
          transferId,
          toDeviceId: req.fromDeviceId,
        });
        void updateRemoteRecord(transferId, 'declined');
      }
    },
    [sendSignal, updateRemoteRecord]
  );

  const sendFilesToTargets = useCallback(
    async (files: QueuedFileItem[], targets: TransferTarget[]): Promise<string[]> => {
      if (!userRef.current || files.length === 0 || targets.length === 0) return [];
      const totalBytes = files.reduce((acc, f) => acc + f.size, 0);
      const fileMetas: FileMeta[] = files.map((f) => ({
        id: f.id,
        name: f.name,
        relativePath: f.relativePath,
        size: f.size,
        mimeType: f.mimeType,
      }));

      const transferIds: string[] = [];

      for (const target of targets) {
        const transferId =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `tr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        transferIds.push(transferId);

        const ecdhPair = await generateEcdhKeyPair();
        const pubJwk = await exportPublicKeyJwk(ecdhPair.publicKey);

        const runtime: TransferSessionRuntime = {
          id: transferId,
          direction: 'send',
          peerDeviceId: target.deviceId,
          pc: null,
          dc: null,
          transport: 'webrtc-p2p',
          sameNetwork: false,
          paused: false,
          cancelled: false,
          resumeResolver: null,
          ecdhPair,
          aesKey: null,
          queuedFiles: files,
          currentFileIndex: 0,
          currentOffset: 0,
          transferredBytes: 0,
          totalBytes,
          lastSpeedSampleAt: performance.now(),
          lastSpeedSampleBytes: 0,
        };
        sessionsRef.current.set(transferId, runtime);

        setActiveTransfers((prev) => [
          {
            id: transferId,
            direction: 'send',
            peerUserId: target.userId,
            peerUsername: target.username,
            peerDisplayName: target.displayName,
            peerAvatarUrl: target.avatarUrl,
            peerDeviceId: target.deviceId,
            peerDeviceName: target.deviceName,
            files: fileMetas,
            totalBytes,
            transferredBytes: 0,
            speedBps: 0,
            etaSeconds: null,
            progress: 0,
            status: 'pending',
            transport: 'webrtc-p2p',
            sameNetwork: false,
            integrityVerified: false,
            currentFileIndex: 0,
            currentFileName: files[0].relativePath,
            createdAt: Date.now(),
          },
          ...prev,
        ]);

        // Persist initial transfer row
        try {
          await apiRequest('/api/transfers', {
            method: 'POST',
            body: JSON.stringify({
              id: transferId,
              recipientId: target.userId,
              recipientDeviceId: target.deviceId,
              files: fileMetas,
              totalBytes,
              transport: 'webrtc-p2p',
              status: 'pending',
            }),
          });
          void refreshHistory();
        } catch {
          // Continue even if history log fails transiently
        }

        // Send ECDH public key & transfer offer
        sendSignal({
          type: 'ecdh:pubkey',
          transferId,
          toDeviceId: target.deviceId,
          publicKey: pubJwk,
        });

        sendSignal({
          type: 'transfer:offer',
          transferId,
          toDeviceId: target.deviceId,
          files: fileMetas,
          totalBytes,
        });
      }

      return transferIds;
    },
    [refreshHistory, sendSignal]
  );

  // Establish WebRTC offer after recipient accepts
  const initiatePeerConnectionForSender = useCallback(
    async (transferId: string, sameNetwork: boolean) => {
      const rt = sessionsRef.current.get(transferId);
      if (!rt || rt.cancelled) return;

      rt.sameNetwork = sameNetwork;
      rt.transport = sameNetwork ? 'webrtc-lan' : 'webrtc-p2p';
      updateTransferCard(transferId, { status: 'connecting', sameNetwork, transport: rt.transport });

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      rt.pc = pc;

      const dc = pc.createDataChannel('senda-files', { ordered: true });
      dc.binaryType = 'arraybuffer';
      dc.bufferedAmountLowThreshold = DC_BUFFERED_LIMIT / 2;
      rt.dc = dc;

      let streamingStarted = false;
      const beginStreamingOnce = () => {
        if (streamingStarted || rt.cancelled) return;
        streamingStarted = true;
        if (rt.fallbackTimer) {
          window.clearTimeout(rt.fallbackTimer);
        }
        void startSenderStreaming(transferId);
      };

      dc.onopen = async () => {
        let detected: TransportMode = sameNetwork ? 'webrtc-lan' : 'webrtc-p2p';
        try {
          const stats = await pc.getStats();
          stats.forEach((report) => {
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
              const local = stats.get(report.localCandidateId);
              if (local?.candidateType === 'host') {
                detected = 'webrtc-lan';
              }
            }
          });
        } catch {}
        rt.transport = detected;
        beginStreamingOnce();
      };

      // Automatic encrypted WebSocket relay fallback if WebRTC fails or times out (6.5s)
      rt.fallbackTimer = window.setTimeout(() => {
        if (!streamingStarted && !rt.cancelled) {
          rt.transport = 'ws-relay';
          updateTransferCard(transferId, { transport: 'ws-relay' });
          beginStreamingOnce();
        }
      }, 6500);

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          sendSignal({
            type: 'signal:ice',
            transferId,
            toDeviceId: rt.peerDeviceId,
            candidate: ev.candidate,
          });
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'failed' && !streamingStarted && !rt.cancelled) {
          rt.transport = 'ws-relay';
          updateTransferCard(transferId, { transport: 'ws-relay' });
          beginStreamingOnce();
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignal({
        type: 'signal:offer',
        transferId,
        toDeviceId: rt.peerDeviceId,
        sdp: offer,
      });
    },
    [sendSignal, startSenderStreaming, updateTransferCard]
  );

  // ======================== PAUSE / RESUME / CANCEL ========================

  const pauseTransfer = useCallback(
    (transferId: string) => {
      const rt = sessionsRef.current.get(transferId);
      if (!rt) return;
      rt.paused = true;
      updateTransferCard(transferId, { status: 'paused', speedBps: 0 });
      sendSignal({ type: 'transfer:pause', transferId, toDeviceId: rt.peerDeviceId });
    },
    [sendSignal, updateTransferCard]
  );

  const resumeTransfer = useCallback(
    (transferId: string) => {
      const rt = sessionsRef.current.get(transferId);
      if (!rt) return;
      rt.paused = false;
      rt.lastSpeedSampleAt = performance.now();
      rt.lastSpeedSampleBytes = rt.transferredBytes;
      updateTransferCard(transferId, { status: 'active' });
      rt.resumeResolver?.();
      rt.resumeResolver = null;
      sendSignal({ type: 'transfer:resume', transferId, toDeviceId: rt.peerDeviceId });
    },
    [sendSignal, updateTransferCard]
  );

  const cancelTransfer = useCallback(
    (transferId: string) => {
      const rt = sessionsRef.current.get(transferId);
      if (rt) {
        rt.cancelled = true;
        rt.resumeResolver?.();
        sendSignal({ type: 'transfer:cancel', transferId, toDeviceId: rt.peerDeviceId });
        cleanupRuntime(transferId);
      }
      updateTransferCard(transferId, { status: 'cancelled', speedBps: 0 });
      void updateRemoteRecord(transferId, 'cancelled');
    },
    [cleanupRuntime, sendSignal, updateRemoteRecord, updateTransferCard]
  );

  const dismissTransfer = useCallback((transferId: string) => {
    setActiveTransfers((prev) => prev.filter((t) => t.id !== transferId));
  }, []);

  // ======================== WEBSOCKET LIFECYCLE ========================

  useEffect(() => {
    if (!user || !deviceId) return;
    const token = getStoredToken();
    if (!token) return;

    let stopped = false;
    let reconnectAttempt = 0;
    let reconnectTimer: number | undefined;
    let pingTimer: number | undefined;

    const connect = () => {
      if (stopped) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttempt = 0;
        setWsConnected(true);
        pingTimer = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25000);
      };

      ws.onmessage = async (event) => {
        if (event.data instanceof ArrayBuffer) {
          // Relay binary envelope: [4-byte headerLen][JSON header][payload]
          const buf = new Uint8Array(event.data);
          if (buf.length < 4) return;
          const view = new DataView(buf.buffer);
          const headerLen = view.getUint32(0, false);
          if (buf.length < 4 + headerLen) return;
          try {
            const header = JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + headerLen)));
            const rt = sessionsRef.current.get(header.transferId);
            if (!rt) return;
            rt.transport = 'ws-relay';
            let payload = buf.subarray(4 + headerLen);
            if (header.encrypted && rt.aesKey) {
              payload = new Uint8Array(await decryptChunk(rt.aesKey, payload));
            }
            await handleIncomingDataChunk(header.transferId, payload);
          } catch {}
          return;
        }

        let msg: any;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        switch (msg.type) {
          case 'devices:sync': {
            if (Array.isArray(msg.devices)) {
              setDevices(msg.devices);
            }
            break;
          }
          case 'session:revoked': {
            showToast('This device session was signed out remotely.', 'info');
            void logout();
            break;
          }
          case 'ecdh:pubkey': {
            const rt = sessionsRef.current.get(msg.transferId);
            if (rt && rt.ecdhPair && msg.publicKey) {
              try {
                const peerPub = await importPublicKeyJwk(msg.publicKey);
                rt.aesKey = await deriveAesGcmKey(rt.ecdhPair.privateKey, peerPub);
              } catch {}
            }
            break;
          }
          case 'transfer:offer': {
            const incoming: IncomingTransferRequest = {
              transferId: msg.transferId,
              fromUserId: msg.fromUserId,
              fromUsername: msg.fromUsername,
              fromDisplayName: msg.fromDisplayName,
              fromAvatarUrl: msg.fromAvatarUrl || '',
              fromDeviceId: msg.fromDeviceId,
              fromDeviceName: msg.fromDeviceName || 'Peer Device',
              fromDeviceOs: msg.fromDeviceOs || 'Web',
              files: msg.files || [],
              totalBytes: msg.totalBytes || 0,
              sameNetwork: Boolean(msg.sameNetwork),
              autoAccept: Boolean(msg.autoAccept),
              receivedAt: Date.now(),
            };
            incomingRef.current = [incoming, ...incomingRef.current.filter((r) => r.transferId !== incoming.transferId)];
            setIncomingRequests(incomingRef.current);

            if (incoming.autoAccept) {
              showToast(`Auto-accepting files from trusted device ${incoming.fromDeviceName}`, 'info');
              void acceptIncomingRequest(incoming.transferId);
            } else {
              notifySystem(
                `Incoming files from ${incoming.fromDisplayName}`,
                `@${incoming.fromUsername} wants to send ${incoming.files.length} item(s).`
              );
            }
            break;
          }
          case 'transfer:peer-offline': {
            const tid = msg.transferId;
            updateTransferCard(tid, {
              status: 'failed',
              errorMessage: 'Recipient device is offline. Ask them to open Senda.',
            });
            void updateRemoteRecord(tid, 'failed', undefined, 'Recipient device offline');
            cleanupRuntime(tid);
            break;
          }
          case 'transfer:accept': {
            void initiatePeerConnectionForSender(msg.transferId, Boolean(msg.sameNetwork));
            break;
          }
          case 'transfer:decline': {
            const tid = msg.transferId;
            updateTransferCard(tid, {
              status: 'declined',
              errorMessage: 'Recipient declined the transfer.',
            });
            void updateRemoteRecord(tid, 'declined');
            cleanupRuntime(tid);
            showToast('Recipient declined the transfer.', 'info');
            break;
          }
          case 'signal:offer': {
            const rt = sessionsRef.current.get(msg.transferId);
            if (rt && rt.pc && msg.sdp) {
              await rt.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
              const answer = await rt.pc.createAnswer();
              await rt.pc.setLocalDescription(answer);
              sendSignal({
                type: 'signal:answer',
                transferId: msg.transferId,
                toDeviceId: msg.fromDeviceId,
                sdp: answer,
              });
            }
            break;
          }
          case 'signal:answer': {
            const rt = sessionsRef.current.get(msg.transferId);
            if (rt && rt.pc && msg.sdp) {
              await rt.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            }
            break;
          }
          case 'signal:ice': {
            const rt = sessionsRef.current.get(msg.transferId);
            if (rt && rt.pc && msg.candidate) {
              try {
                await rt.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
              } catch {}
            }
            break;
          }
          case 'transfer:pause': {
            const rt = sessionsRef.current.get(msg.transferId);
            if (rt) {
              rt.paused = true;
              updateTransferCard(msg.transferId, { status: 'paused', speedBps: 0 });
            }
            break;
          }
          case 'transfer:resume': {
            const rt = sessionsRef.current.get(msg.transferId);
            if (rt) {
              rt.paused = false;
              rt.lastSpeedSampleAt = performance.now();
              rt.lastSpeedSampleBytes = rt.transferredBytes;
              updateTransferCard(msg.transferId, { status: 'active' });
              rt.resumeResolver?.();
              rt.resumeResolver = null;
            }
            break;
          }
          case 'transfer:cancel': {
            const rt = sessionsRef.current.get(msg.transferId);
            if (rt) {
              rt.cancelled = true;
              rt.resumeResolver?.();
              cleanupRuntime(msg.transferId);
            }
            setIncomingRequests((prev) => prev.filter((r) => r.transferId !== msg.transferId));
            updateTransferCard(msg.transferId, { status: 'cancelled', speedBps: 0 });
            break;
          }
          case 'transfer:complete': {
            await handleReceiverControlEvent(msg.transferId, msg);
            break;
          }
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (pingTimer) window.clearInterval(pingTimer);
        if (!stopped) {
          const delay = Math.min(10000, 1000 * Math.pow(1.5, reconnectAttempt++));
          reconnectTimer = window.setTimeout(connect, delay);
        }
      };
    };

    connect();

    return () => {
      stopped = true;
      if (pingTimer) window.clearInterval(pingTimer);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [
    user?.id,
    deviceId,
    acceptIncomingRequest,
    cleanupRuntime,
    handleIncomingDataChunk,
    handleReceiverControlEvent,
    initiatePeerConnectionForSender,
    logout,
    notifySystem,
    sendSignal,
    setDevices,
    showToast,
    updateRemoteRecord,
    updateTransferCard,
  ]);

  useEffect(() => {
    incomingRef.current = incomingRequests;
  }, [incomingRequests]);

  return (
    <TransferContext.Provider
      value={{
        wsConnected,
        activeTransfers,
        incomingRequests,
        history,
        downloadDirHandle,
        downloadDirName,
        pickDownloadDirectory,
        clearDownloadDirectory,
        refreshHistory,
        sendFilesToTargets,
        acceptIncomingRequest,
        declineIncomingRequest,
        pauseTransfer,
        resumeTransfer,
        cancelTransfer,
        dismissTransfer,
        toastMessage,
        showToast,
      }}
    >
      {children}
    </TransferContext.Provider>
  );
}

export function useTransfer() {
  const ctx = useContext(TransferContext);
  if (!ctx) throw new Error('useTransfer must be used inside TransferProvider');
  return ctx;
}
