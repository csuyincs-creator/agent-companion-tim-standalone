// server/codex/JsonRpcTransport.mjs
import { createInterface } from 'node:readline';
import { setTimeout, clearTimeout } from 'node:timers';

const DEFAULT_TIMEOUT_MS = 30_000;

export class JsonRpcTransportClosedError extends Error {
  constructor(message = 'JSON-RPC transport closed') {
    super(message);
    this.name = 'JsonRpcTransportClosedError';
  }
}

export class JsonRpcErrorResponse extends Error {
  constructor(method, code, message, data) {
    super(message);
    this.name = 'JsonRpcErrorResponse';
    this.method = method;
    this.code = code;
    this.data = data;
  }
}

export class JsonRpcTransport {
  abortController = new AbortController();
  closeListeners = new Set();
  disposed = false;
  nextId = 1;
  notificationHandlers = new Map();
  pending = new Map();
  readline = null;
  requestHandlers = new Map();
  streamCloseTimer = null;
  streamUnsubscribers = [];
  unregisterClose;

  constructor(streams, defaultTimeoutMs = DEFAULT_TIMEOUT_MS, options = {}) {
    this.streams = streams;
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.options = options;
  }

  get signal() { return this.abortController.signal; }
  get isClosed() { return this.disposed; }

  start() {
    if (this.readline || this.disposed) return;

    this.readline = createInterface({
      input: this.streams.input,
    });
    this.readline.on('line', line => this.handleLine(line));
    this.readline.on('error', () => {
      this.closeFromStream('JSON-RPC input error');
    });
    this.readline.on('close', () => {
      this.closeFromStream('JSON-RPC input closed');
    });

    this.streamUnsubscribers.push(
      subscribeStreamEvent(this.streams.input, 'error', () => {
        this.closeFromStream('JSON-RPC input error');
      }),
      subscribeStreamEvent(this.streams.input, 'end', () => {
        this.closeFromStream('JSON-RPC input closed');
      }),
      subscribeStreamEvent(this.streams.input, 'close', () => {
        this.closeFromStream('JSON-RPC input closed');
      }),
      subscribeStreamEvent(this.streams.output, 'error', () => {
        this.closeFromStream('JSON-RPC output error');
      }),
      subscribeStreamEvent(this.streams.output, 'close', () => {
        this.closeFromStream('JSON-RPC output closed');
      }),
    );

    this.unregisterClose = this.streams.onClose?.((error) => {
      if (!this.disposed) {
        this.dispose(error ?? new JsonRpcTransportClosedError());
      }
    });
  }

  onClose(listener) {
    if (this.disposed) return () => {};
    this.closeListeners.add(listener);
    return () => { this.closeListeners.delete(listener); };
  }

  onNotification(method, handler) {
    if (this.disposed) return () => {};
    let handlers = this.notificationHandlers.get(method);
    if (!handlers) {
      handlers = new Set();
      this.notificationHandlers.set(method, handlers);
    }
    handlers.add(handler);
    return () => {
      const current = this.notificationHandlers.get(method);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) this.notificationHandlers.delete(method);
    };
  }

  onRequest(method, handler) {
    if (this.disposed) return () => {};
    this.requestHandlers.set(method, handler);
    return () => {
      if (this.requestHandlers.get(method) === handler) {
        this.requestHandlers.delete(method);
      }
    };
  }

  async request(method, params, options = {}) {
    this.start();
    if (this.disposed) throw new JsonRpcTransportClosedError();

    const id = this.nextId++;
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;

    return new Promise((resolve, reject) => {
      let timer;
      let onAbort;

      const cleanup = () => {
        if (timer !== undefined) clearTimeout(timer);
        if (onAbort && options.signal) {
          options.signal.removeEventListener('abort', onAbort);
        }
      };

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this.pending.delete(id);
          cleanup();
          reject(new Error(`Request timeout: ${method} (${timeoutMs}ms)`));
        }, timeoutMs);
      }

      if (options.signal?.aborted) {
        cleanup();
        reject(new Error(`Request aborted: ${method}`));
        return;
      }
      if (options.signal) {
        onAbort = () => {
          this.pending.delete(id);
          cleanup();
          reject(new Error(`Request aborted: ${method}`));
        };
        options.signal.addEventListener('abort', onAbort, { once: true });
      }

      this.pending.set(id, { cleanup, method, reject, resolve: result => resolve(result) });

      try {
        this.sendRaw({ id, jsonrpc: '2.0', method, params });
      } catch (error) {
        this.pending.delete(id);
        cleanup();
        const transportError = error instanceof Error ? error : new Error(String(error));
        this.dispose(transportError);
        reject(transportError);
      }
    });
  }

  notify(method, params) {
    this.start();
    if (this.disposed) return;
    this.trySendRaw({ jsonrpc: '2.0', method, params });
  }

  flush() {
    if (this.disposed) return Promise.resolve();
    return new Promise((resolve, reject) => {
      try {
        this.streams.output.write('', (error) => {
          if (error) reject(error);
          else resolve();
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  dispose(error = new JsonRpcTransportClosedError('JSON-RPC transport disposed')) {
    if (this.disposed) return;
    this.disposed = true;
    this.abortController.abort();

    if (this.streamCloseTimer !== null) {
      clearTimeout(this.streamCloseTimer);
      this.streamCloseTimer = null;
    }

    this.unregisterClose?.();
    this.unregisterClose = undefined;
    while (this.streamUnsubscribers.length > 0) {
      this.streamUnsubscribers.pop()?.();
    }

    if (this.readline) {
      const readline = this.readline;
      this.readline = null;
      readline.close();
      readline.removeAllListeners();
    }

    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(error);
    }
    this.pending.clear();

    for (const listener of [...this.closeListeners]) {
      try { listener(error); } catch {}
    }
    this.closeListeners.clear();
    this.notificationHandlers.clear();
    this.requestHandlers.clear();
  }

  closeFromStream(message) {
    if (this.disposed || this.streamCloseTimer !== null) return;
    const graceMs = this.options.streamCloseGraceMs ?? 0;
    const error = new JsonRpcTransportClosedError(message);
    if (!this.streams.onClose || graceMs <= 0) {
      this.dispose(error);
      return;
    }
    this.streamCloseTimer = setTimeout(() => {
      this.streamCloseTimer = null;
      this.dispose(error);
    }, graceMs);
  }

  handleLine(line) {
    if (!line.trim()) return;
    let parsed;
    try { parsed = JSON.parse(line); } catch { return; }
    if (!isRecord(parsed)) return;
    const message = parsed;

    if ('id' in message && !('method' in message)) {
      this.handleResponse(message);
      return;
    }
    if ('method' in message && 'id' in message) {
      this.handleRequest(message);
      return;
    }
    if ('method' in message) this.handleNotification(message);
  }

  handleResponse(message) {
    if (typeof message.id !== 'number' && typeof message.id !== 'string') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    pending.cleanup();
    if (message.error) {
      pending.reject(new JsonRpcErrorResponse(
        pending.method, message.error.code, message.error.message, message.error.data,
      ));
      return;
    }
    pending.resolve(message.result);
  }

  handleNotification(message) {
    const handlers = this.notificationHandlers.get(message.method);
    if (!handlers) return;
    for (const handler of [...handlers]) {
      void Promise.resolve().then(() => handler(message.params)).catch(() => {});
    }
  }

  handleRequest(message) {
    const handler = this.requestHandlers.get(message.method);
    if (!handler) {
      this.trySendRaw({
        error: { code: -32601, message: `Unhandled server request: ${message.method}` },
        id: message.id, jsonrpc: '2.0',
      });
      return;
    }
    const context = { method: message.method, requestId: message.id };
    void Promise.resolve().then(() => handler(message.params, context)).then(
      result => this.trySendRaw({ id: message.id, jsonrpc: '2.0', result }),
      error => this.trySendRaw({
        error: { code: -32603, message: error instanceof Error ? error.message : 'Internal error' },
        id: message.id, jsonrpc: '2.0',
      }),
    );
  }

  sendRaw(message) {
    if (this.disposed) throw new JsonRpcTransportClosedError();
    this.streams.output.write(`${JSON.stringify(message)}\n`);
  }

  trySendRaw(message) {
    try { this.sendRaw(message); } catch (error) {
      this.dispose(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

function subscribeStreamEvent(stream, eventName, listener) {
  stream.on?.(eventName, listener);
  return () => {
    if (typeof stream.off === 'function') { stream.off(eventName, listener); return; }
    stream.removeListener?.(eventName, listener);
  };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}