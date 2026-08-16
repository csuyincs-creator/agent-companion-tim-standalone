// server/codex/CodexRpcTransport.mjs
import { JsonRpcErrorResponse } from './JsonRpcTransport.mjs';
import { JsonRpcTransport } from './JsonRpcTransport.mjs';

const DEFAULT_TIMEOUT_MS = 30_000;
const PROCESS_CLOSE_GRACE_MS = 3_000;

export class CodexRpcResponseError extends Error {
  constructor(error) {
    super(error.message);
    this.name = 'CodexRpcResponseError';
    this.code = error.code;
    this.data = error.data;
  }
}

export class CodexRpcTransport {
  disposed = false;
  notificationHandlers = new Map();
  notificationUnsubscribers = new Map();
  serverRequestHandlers = new Map();
  serverRequestUnsubscribers = new Map();
  transport = null;
  proc;

  constructor(proc) {
    this.proc = proc;
  }

  start() {
    if (this.transport || this.disposed) return;

    const transport = new JsonRpcTransport({
      input: this.proc.stdout,
      onClose: (listener) => {
        const exitHandler = () => {
          listener(new Error(this.buildProcessExitMessage()));
        };
        this.proc.onExit(exitHandler);
        return () => this.proc.offExit(exitHandler);
      },
      output: this.proc.stdin,
    }, DEFAULT_TIMEOUT_MS, { streamCloseGraceMs: PROCESS_CLOSE_GRACE_MS });
    this.transport = transport;

    for (const [method, handler] of this.notificationHandlers) {
      this.registerNotificationHandler(transport, method, handler);
    }
    for (const [method, handler] of this.serverRequestHandlers) {
      this.registerServerRequestHandler(transport, method, handler);
    }
    transport.start();
  }

  async request(method, params, timeoutMs = DEFAULT_TIMEOUT_MS) {
    if (this.disposed) throw new Error('Transport disposed');
    this.start();

    try {
      return await this.transport.request(method, params, { timeoutMs });
    } catch (error) {
      if (error instanceof JsonRpcErrorResponse) {
        throw new CodexRpcResponseError({
          code: error.code,
          data: error.data,
          message: error.message,
        });
      }
      throw error;
    }
  }

  notify(method, params) {
    if (this.disposed) return;
    this.start();
    this.transport.notify(method, params);
  }

  onNotification(method, handler) {
    this.notificationHandlers.set(method, handler);
    if (this.transport) {
      this.registerNotificationHandler(this.transport, method, handler);
    }
    return () => {
      if (this.notificationHandlers.get(method) === handler) {
        this.notificationHandlers.delete(method);
      }
      this.notificationUnsubscribers.get(method)?.();
      this.notificationUnsubscribers.delete(method);
    };
  }

  onServerRequest(method, handler) {
    this.serverRequestHandlers.set(method, handler);
    if (this.transport) {
      this.registerServerRequestHandler(this.transport, method, handler);
    }
    return () => {
      if (this.serverRequestHandlers.get(method) === handler) {
        this.serverRequestHandlers.delete(method);
      }
      this.serverRequestUnsubscribers.get(method)?.();
      this.serverRequestUnsubscribers.delete(method);
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clearUnsubscribers(this.notificationUnsubscribers);
    this.clearUnsubscribers(this.serverRequestUnsubscribers);
    this.transport?.dispose(new Error('Transport disposed'));
    this.transport = null;
    this.notificationHandlers.clear();
    this.serverRequestHandlers.clear();
  }

  registerNotificationHandler(transport, method, handler) {
    this.notificationUnsubscribers.get(method)?.();
    this.notificationUnsubscribers.set(method, transport.onNotification(method, handler));
  }

  registerServerRequestHandler(transport, method, handler) {
    this.serverRequestUnsubscribers.get(method)?.();
    this.serverRequestUnsubscribers.set(method, transport.onRequest(
      method,
      (params, context) => handler(context.requestId, params),
    ));
  }

  clearUnsubscribers(unsubscribers) {
    for (const unsubscribe of unsubscribers.values()) unsubscribe();
    unsubscribers.clear();
  }

  buildProcessExitMessage() {
    const stderr = this.proc.getStderrSnapshot();
    return stderr ? `App-server process exited\n\n${stderr}` : 'App-server process exited';
  }
}