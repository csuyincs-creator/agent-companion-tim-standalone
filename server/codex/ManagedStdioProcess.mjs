// server/codex/ManagedStdioProcess.mjs
import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { setTimeout, clearTimeout } from 'node:timers';

const DEFAULT_SIGKILL_TIMEOUT_MS = 3_000;
const DEFAULT_FINAL_SHUTDOWN_TIMEOUT_MS = 3_000;
const DEFAULT_STDERR_BUFFER_LIMIT = 8_000;
const IS_WINDOWS = platform() === 'win32';

export class ManagedStdioProcess {
  alive = false;
  closeListeners = new Set();
  errorListeners = new Set();
  exitState = null;
  exitListeners = new Set();
  proc = null;
  shutdownPromise = null;
  spawnConfirmed = false;
  startAttempted = false;
  stderrBuffer = '';
  stderrDataListener = null;

  constructor(options) {
    this.options = options;
  }

  get stdin() { return this.requireProcess().stdin; }
  get stdout() { return this.requireProcess().stdout; }
  get stderr() { return this.requireProcess().stderr; }

  start() {
    if (this.startAttempted || this.shutdownPromise) return;
    this.startAttempted = true;

    let proc;
    try {
      proc = spawn(this.options.command, this.options.args, {
        cwd: this.options.cwd,
        env: this.options.env,
        shell: IS_WINDOWS,
        stdio: this.options.stdio ?? 'pipe',
        windowsHide: true,
      });
    } catch (error) {
      const spawnError = error instanceof Error ? error : new Error(String(error));
      this.exitState = { closed: true, code: null, error: spawnError, signal: null };
      this.notifyError(spawnError);
      this.clearLifecycleListeners();
      throw spawnError;
    }

    this.proc = proc;
    this.spawnConfirmed = typeof proc.pid === 'number';
    this.alive = (proc.exitCode === null || proc.exitCode === undefined)
      && (proc.signalCode === null || proc.signalCode === undefined)
      && !proc.killed;
    this.stderrDataListener = (chunk) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      const limit = this.options.stderrBufferLimit ?? DEFAULT_STDERR_BUFFER_LIMIT;
      this.stderrBuffer = `${this.stderrBuffer}${text}`.slice(-limit);
    };
    proc.stderr.on('data', this.stderrDataListener);
    proc.on('spawn', this.handleSpawn);
    proc.on('error', this.handleError);
    proc.on('exit', this.handleExit);
    proc.on('close', this.handleClose);
  }

  isStarted() { return this.proc !== null; }
  isAlive() { return this.alive; }

  getExitState() {
    return this.exitState ? { ...this.exitState } : null;
  }

  getStderrSnapshot() {
    return this.stderrBuffer.trim();
  }

  onError(listener) {
    this.errorListeners.add(listener);
    return () => { this.errorListeners.delete(listener); };
  }

  onExit(listener) {
    this.exitListeners.add(listener);
    return () => { this.exitListeners.delete(listener); };
  }

  onClose(listener) {
    this.closeListeners.add(listener);
    return () => { this.closeListeners.delete(listener); };
  }

  shutdown() {
    if (this.shutdownPromise) return this.shutdownPromise;

    const proc = this.proc;
    if (!proc || !this.alive) {
      this.shutdownPromise = Promise.resolve();
      return this.shutdownPromise;
    }

    this.shutdownPromise = new Promise((resolve) => {
      let settled = false;
      let killTimer = null;
      let finalTimer = null;
      let unsubscribeExit = null;
      let unsubscribeClose = null;

      const finish = () => {
        if (settled) return;
        settled = true;
        if (killTimer !== null) clearTimeout(killTimer);
        if (finalTimer !== null) clearTimeout(finalTimer);
        unsubscribeExit?.();
        unsubscribeClose?.();
        resolve();
      };

      unsubscribeExit = this.onExit(finish);
      unsubscribeClose = this.onClose(finish);

      killTimer = setTimeout(() => {
        if (this.alive) {
          try { proc.kill(); } catch {}
        }
        finalTimer = setTimeout(() => {
          this.alive = false;
          this.cleanupProcessListeners(proc);
          destroyStdio(proc);
          this.clearLifecycleListeners();
          finish();
        }, this.options.finalShutdownTimeoutMs ?? DEFAULT_FINAL_SHUTDOWN_TIMEOUT_MS);
      }, this.options.sigkillTimeoutMs ?? DEFAULT_SIGKILL_TIMEOUT_MS);

      try { proc.kill(); } catch {}
    });

    return this.shutdownPromise;
  }

  handleSpawn = () => { this.spawnConfirmed = true; };

  handleError = (error) => {
    if (!this.spawnConfirmed) this.alive = false;
    this.exitState = {
      closed: false,
      code: this.exitState?.code ?? null,
      error,
      signal: this.exitState?.signal ?? null,
    };
    this.notifyError(error);
  };

  handleExit = (code, signal) => {
    this.alive = false;
    this.exitState = {
      closed: false,
      code,
      ...(this.exitState?.error ? { error: this.exitState.error } : {}),
      signal,
    };
    for (const listener of [...this.exitListeners]) {
      safelyNotify(() => listener(this.getExitState()));
    }
  };

  handleClose = (code, signal) => {
    this.alive = false;
    this.exitState = {
      closed: true,
      code,
      ...(this.exitState?.error ? { error: this.exitState.error } : {}),
      signal,
    };
    for (const listener of [...this.closeListeners]) {
      safelyNotify(() => listener(this.getExitState()));
    }
    this.cleanupProcessListeners(this.proc);
    this.clearLifecycleListeners();
  };

  requireProcess() {
    if (!this.proc) throw new Error('Managed stdio process is not started');
    return this.proc;
  }

  notifyError(error) {
    for (const listener of [...this.errorListeners]) {
      safelyNotify(() => listener(error));
    }
  }

  cleanupProcessListeners(proc) {
    if (!proc) return;
    proc.off('spawn', this.handleSpawn);
    proc.off('error', this.handleError);
    proc.off('exit', this.handleExit);
    proc.off('close', this.handleClose);
    if (this.stderrDataListener) {
      proc.stderr.off('data', this.stderrDataListener);
      this.stderrDataListener = null;
    }
  }

  clearLifecycleListeners() {
    this.errorListeners.clear();
    this.exitListeners.clear();
    this.closeListeners.clear();
  }
}

function destroyStdio(proc) {
  for (const stream of [proc.stdin, proc.stdout, proc.stderr]) {
    try { stream?.destroy(); } catch {}
  }
}

function safelyNotify(callback) {
  try { callback(); } catch {}
}