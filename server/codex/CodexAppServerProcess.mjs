// server/codex/CodexAppServerProcess.mjs
import { ManagedStdioProcess } from './ManagedStdioProcess.mjs';

const STDERR_BUFFER_LIMIT = 8_192;

export class CodexAppServerProcess {
  exitCallbacks = [];
  process;

  constructor(launchSpec) {
    this.process = new ManagedStdioProcess({
      args: launchSpec.args,
      command: launchSpec.command,
      cwd: launchSpec.spawnCwd,
      env: launchSpec.env,
      stderrBufferLimit: STDERR_BUFFER_LIMIT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process.onClose(({ code, signal }) => {
      for (const callback of [...this.exitCallbacks]) {
        try { callback(code, signal); } catch {}
      }
      this.exitCallbacks.length = 0;
    });
  }

  get stdin() {
    this.assertStarted();
    return this.process.stdin;
  }

  get stdout() {
    this.assertStarted();
    return this.process.stdout;
  }

  get stderr() {
    this.assertStarted();
    return this.process.stderr;
  }

  start() {
    this.process.start();
  }

  isAlive() {
    return this.process.isAlive();
  }

  getStderrSnapshot() {
    return this.process.getStderrSnapshot();
  }

  onExit(callback) {
    this.exitCallbacks.push(callback);
  }

  offExit(callback) {
    const index = this.exitCallbacks.indexOf(callback);
    if (index !== -1) this.exitCallbacks.splice(index, 1);
  }

  shutdown() {
    return this.process.shutdown();
  }

  assertStarted() {
    if (!this.process.isStarted()) {
      throw new Error('Process not started');
    }
  }
}