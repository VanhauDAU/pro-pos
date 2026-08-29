import qz from 'qz-tray';

import { PrinterConnectionError, PrinterError } from '../printer-errors';
import type { PrinterConnectionStatus } from '../printer-types';
import { configureQzSecurity } from './qz-security';

const CONNECT_TIMEOUT_MS = 8_000;
let connectPromise: Promise<void> | null = null;

function timeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new PrinterConnectionError()), timeoutMs);
    promise.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function ensureQzConnected(): Promise<void> {
  configureQzSecurity();
  if (qz.websocket.isActive()) {
    if (import.meta.env.DEV) {
      console.log('[QZ] websocket connected');
    }
    return;
  }
  if (connectPromise) return connectPromise;

  connectPromise = timeout(qz.websocket.connect({ retries: 1, delay: 0.5 }), CONNECT_TIMEOUT_MS)
    .then(() => {
      if (import.meta.env.DEV) {
        console.log('[QZ] websocket connected');
      }
    })
    .catch((error) => {
      if (import.meta.env.DEV) {
        console.warn(
          '[QZ] trusted setup required: ensure QZ Tray is running and certificate is whitelisted',
        );
      }
      throw new PrinterConnectionError(undefined, { cause: error });
    })
    .finally(() => {
      connectPromise = null;
    });
  return connectPromise;
}

export async function reconnectQz(): Promise<void> {
  if (qz.websocket.isActive()) {
    try {
      await qz.websocket.disconnect();
    } catch {
      // The socket may already be closing; ensureQzConnected handles the next state.
    }
  }
  connectPromise = null;
  await ensureQzConnected();
}

export async function disconnectQz(): Promise<void> {
  connectPromise = null;
  if (qz.websocket.isActive()) await qz.websocket.disconnect();
}

export async function checkQzConnection(connect = false): Promise<PrinterConnectionStatus> {
  try {
    if (!qz.websocket.isActive()) {
      if (!connect) return { connected: false, error: 'Chưa kết nối QZ Tray.' };
      await ensureQzConnected();
    }
    return { connected: true, version: await qz.api.getVersion() };
  } catch (error) {
    const printerError =
      error instanceof PrinterError
        ? error
        : new PrinterConnectionError(undefined, { cause: error });
    return { connected: false, error: printerError.message };
  }
}

/** Retry one time only when a live QZ socket disappears during an operation. */
export async function withQzReconnect<T>(operation: () => Promise<T>): Promise<T> {
  await ensureQzConnected();
  try {
    return await operation();
  } catch (error) {
    if (qz.websocket.isActive()) throw error;
    await reconnectQz();
    return operation();
  }
}

export function resetQzClientForTests() {
  connectPromise = null;
}
