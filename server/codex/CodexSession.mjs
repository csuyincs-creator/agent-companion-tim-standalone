// server/codex/CodexSession.mjs
import { randomUUID } from 'node:crypto';
import { CodexAppServerProcess } from './CodexAppServerProcess.mjs';
import { CodexRpcTransport } from './CodexRpcTransport.mjs';
import {
  buildCodexAppServerLaunchSpec,
  initializeCodexAppServerTransport,
  listModels as requestModels,
  startThread,
  startTurn,
} from './CodexAppServerSupport.mjs';

const NOTIFICATION_METHODS = [
  'item/agentMessage/delta',
  'item/started',
  'item/completed',
  'item/plan/delta',
  'item/reasoning/textDelta',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/summaryPartAdded',
  'thread/tokenUsage/updated',
  'turn/plan/updated',
  'thread/started',
  'thread/status/changed',
  'turn/started',
  'item/commandExecution/outputDelta',
  'item/fileChange/outputDelta',
  'item/fileChange/patchUpdated',
  'rawResponseItem/completed',
  'event_msg',
];

// turn/completed and error are handled separately via waitForTurnCompletion
// to avoid overwriting wireNotifications handlers

const SERVER_REQUEST_METHODS = [
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'item/permissions/requestApproval',
  'item/tool/requestUserInput',
  'item/tool/call',
];

export class CodexSession {
  sessionId = randomUUID();
  process = null;
  transport = null;
  launchSpec = null;
  threadId = null;
  disposed = false;
  lifecycleGeneration = 0;
  notificationUnsubscribers = [];
  ensureProcessMutex = Promise.resolve();

  constructor(config) {
    this.config = config;
  }

  /**
   * Execute a user message and stream events.
   * @param {object} options
   * @param {string} options.message - User's text message
   * @param {string} [options.model] - Model name
   * @param {string} [options.effort] - Reasoning effort: low/medium/high/xhigh/max
   * @param {string} [options.safeMode] - Sandbox mode: readOnly/workspaceWrite/dangerFullAccess
   * @param {string} [options.cwd] - Working directory
   * @param {AbortSignal} [options.signal] - Abort signal
   * @param {Function} onEvent - Callback for each event: (event) => void
   * @returns {Promise<void>}
   */
  async execute({ message, model, effort, safeMode, cwd, signal }, onEvent) {
    if (this.disposed) throw new Error('Session disposed');

    const generation = ++this.lifecycleGeneration;
    const cwd_ = cwd || process.cwd();

    try {
      // 1. Ensure process is running (with mutex to prevent concurrent starts)
      await this.ensureProcess(cwd_, generation);
      if (generation !== this.lifecycleGeneration) return;

      // 2. Start thread (or reuse existing)
      if (!this.threadId) {
        const threadResult = await startThread(this.transport, {
          model: model || 'gpt-5.4-mini',
          cwd: cwd_,
        });
        this.threadId = threadResult.thread?.id;
        if (!this.threadId) throw new Error('Failed to start thread: no thread id returned');
        if (generation !== this.lifecycleGeneration) return;
      }

      // 3. Wire notification handlers for this turn
      this.wireNotifications(generation, onEvent);

      // 4. Register turn completion listener BEFORE startTurn (avoid race condition)
      const turnCompleted = this.waitForTurnCompletion(generation, signal);

      // 5. Start turn
      const turnResult = await startTurn(this.transport, {
        threadId: this.threadId,
        message,
        model,
        effort: effort || 'high',
        safeMode: safeMode || 'workspaceWrite',
        cwd: cwd_,
      });
      if (generation !== this.lifecycleGeneration) return;

      onEvent({ type: 'state', status: 'running', turnId: turnResult?.turn?.id });

      // 6. Wait for turn completion
      await turnCompleted;
      if (generation !== this.lifecycleGeneration) return;

      onEvent({
        type: 'completed',
        summary: 'Codex 已完成本轮回复。',
      });
    } catch (error) {
      if (generation !== this.lifecycleGeneration) return;
      if (signal?.aborted) {
        onEvent({ type: 'error', message: '请求已取消', retryable: true });
        throw error;
      }
      onEvent({ type: 'error', message: error.message || 'Codex 执行失败', retryable: true });
      throw error;
    }
  }

  async listModels({ cwd = process.cwd(), signal, includeHidden = false } = {}) {
    if (this.disposed) throw new Error('Session disposed');
    const generation = ++this.lifecycleGeneration;
    await this.ensureProcess(cwd, generation);
    if (generation !== this.lifecycleGeneration) return [];

    const models = [];
    let cursor = null;
    for (let page = 0; page < 5; page += 1) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      const result = await requestModels(this.transport, { cursor, limit: 100, includeHidden });
      if (!result || !Array.isArray(result.data)) throw new Error('Invalid Codex model catalog');
      models.push(...result.data.slice(0, 100));
      cursor = typeof result.nextCursor === 'string' && result.nextCursor ? result.nextCursor : null;
      if (!cursor) break;
    }
    return models.slice(0, 500);
  }

  async ensureProcess(cwd, generation) {
    // Serialize ensureProcess calls to prevent concurrent start race conditions
    const previous = this.ensureProcessMutex;
    let release;
    this.ensureProcessMutex = new Promise((resolve) => { release = resolve; });
    await previous;

    try {
      if (this.process && this.transport && this.process.isAlive()) return;

      await this.shutdownDeadProcess();
      if (generation !== this.lifecycleGeneration) return;

      // Reset threadId when creating a new process
      this.threadId = null;

      const launchSpec = buildCodexAppServerLaunchSpec({ cwd });
      this.launchSpec = launchSpec;

      const process = new CodexAppServerProcess(launchSpec);
      this.process = process;
      process.onExit(() => this.handleProcessExit(process));

      process.start();
      if (generation !== this.lifecycleGeneration) return;

      const transport = new CodexRpcTransport(process);
      this.transport = transport;
      transport.start();
      if (generation !== this.lifecycleGeneration) return;

      const initializeResult = await initializeCodexAppServerTransport(transport);
      if (generation !== this.lifecycleGeneration) return;

      return initializeResult;
    } finally {
      release();
    }
  }

  async shutdownDeadProcess() {
    if (this.transport) {
      this.transport.dispose();
    }
    if (this.process) {
      await this.process.shutdown();
    }
    this.transport = null;
    this.process = null;
  }

  handleProcessExit(process) {
    if (process !== this.process) return;
    this.unwireNotifications();
    this.process = null;
    this.transport = null;
  }

  wireNotifications(generation, onEvent) {
    this.unwireNotifications();

    for (const method of NOTIFICATION_METHODS) {
      const unsub = this.transport.onNotification(method, (params) => {
        if (generation !== this.lifecycleGeneration) return;
        this.handleNotification(method, params, onEvent);
      });
      this.notificationUnsubscribers.push(unsub);
    }

    for (const method of SERVER_REQUEST_METHODS) {
      const unsubSr = this.transport.onServerRequest(method, (requestId, params) => {
        if (generation !== this.lifecycleGeneration) {
          return Promise.reject(new Error('Stale transport'));
        }
        return this.handleServerRequest(method, requestId, params);
      });
      this.notificationUnsubscribers.push(unsubSr);
    }
  }

  unwireNotifications() {
    for (const unsub of this.notificationUnsubscribers) {
      try { unsub(); } catch {}
    }
    this.notificationUnsubscribers = [];
  }

  handleNotification(method, params, onEvent) {
    switch (method) {
      case 'item/agentMessage/delta':
        onEvent({ type: 'message_delta', text: params.delta || '' });
        break;

      case 'item/started': {
        const item = params.item;
        if (!item) break;
        const type = item.type;
        if (type === 'commandExecution') {
          onEvent({ type: 'tool_start', tool: 'command_execution', command: item.command, cwd: item.cwd });
        } else if (type === 'fileChange') {
          onEvent({ type: 'tool_start', tool: 'file_change', changes: item.changes });
        } else if (type === 'webSearch') {
          onEvent({ type: 'tool_start', tool: 'web_search', query: item.query });
        } else if (type === 'agentMessage') {
          onEvent({ type: 'message_start', itemId: item.id });
        }
        break;
      }

      case 'item/completed': {
        const item = params.item;
        if (!item) break;
        if (item.type === 'commandExecution') {
          onEvent({
            type: 'tool_result',
            tool: 'command_execution',
            output: item.aggregatedOutput,
            exitCode: item.exitCode,
            durationMs: item.durationMs,
          });
        } else if (item.type === 'fileChange') {
          onEvent({ type: 'tool_result', tool: 'file_change', status: item.status });
        } else if (item.type === 'webSearch') {
          onEvent({ type: 'tool_result', tool: 'web_search', status: item.status });
        }
        break;
      }

      // turn/completed and error are handled by waitForTurnCompletion,
      // not via the notification wire. See NOTIFICATION_METHODS comment.

      case 'thread/tokenUsage/updated':
        onEvent({
          type: 'usage',
          totalTokens: params.tokenUsage?.total?.totalTokens,
          inputTokens: params.tokenUsage?.total?.inputTokens,
          outputTokens: params.tokenUsage?.total?.outputTokens,
        });
        break;

      case 'turn/plan/updated':
        if (params.plan) {
          onEvent({ type: 'plan', steps: params.plan, explanation: params.explanation });
        }
        break;

      case 'item/plan/delta':
        onEvent({ type: 'plan_delta', text: params.delta || '' });
        break;

      case 'item/reasoning/textDelta':
        onEvent({ type: 'reasoning_delta', text: params.delta || '' });
        break;

      case 'item/commandExecution/outputDelta':
        onEvent({ type: 'tool_output_delta', text: params.delta || '' });
        break;

      case 'item/fileChange/patchUpdated':
        if (params.changes) {
          onEvent({ type: 'file_patch', changes: params.changes });
        }
        break;

      default:
        break;
    }
  }

  async handleServerRequest(method, requestId, params) {
    switch (method) {
      case 'item/commandExecution/requestApproval':
        // Auto-accept in workspaceWrite mode
        return { decision: 'acceptForSession' };

      case 'item/fileChange/requestApproval':
        return { decision: 'acceptForSession' };

      case 'item/permissions/requestApproval':
        return { permissions: params.permissions || {}, scope: 'turn' };

      case 'item/tool/requestUserInput':
        return { answers: {} };

      case 'item/tool/call':
        return { success: false, contentItems: [] };

      default:
        return {};
    }
  }

  waitForTurnCompletion(generation, signal) {
    const TURN_TIMEOUT_MS = 300_000; // 5 minutes

    return new Promise((resolve, reject) => {
      let unsubCompleted;
      let unsubError;
      let onAbort;
      let onProcessExit;
      let timer;
      const proc = this.process;

      const cleanup = () => {
        unsubCompleted?.();
        unsubError?.();
        if (timer) clearTimeout(timer);
        if (onAbort && signal) {
          signal.removeEventListener('abort', onAbort);
        }
        if (onProcessExit && proc) {
          proc.offExit(onProcessExit);
        }
      };

      unsubCompleted = this.transport.onNotification('turn/completed', () => {
        if (generation !== this.lifecycleGeneration) return;
        cleanup();
        resolve();
      });

      unsubError = this.transport.onNotification('error', (params) => {
        if (generation !== this.lifecycleGeneration) return;
        cleanup();
        reject(new Error(params?.error?.message || 'Codex turn error'));
      });

      // Listen for process exit to avoid hanging when process crashes unexpectedly
      if (proc) {
        onProcessExit = () => {
          if (generation !== this.lifecycleGeneration) return;
          cleanup();
          reject(new Error('Codex process exited unexpectedly'));
        };
        proc.onExit(onProcessExit);
      }

      timer = setTimeout(() => {
        cleanup();
        reject(new Error('Codex turn timeout'));
      }, TURN_TIMEOUT_MS);

      if (signal?.aborted) {
        cleanup();
        reject(new Error('Aborted'));
        return;
      }
      if (signal) {
        onAbort = () => {
          cleanup();
          reject(new Error('Aborted'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.lifecycleGeneration += 1;

    await this.shutdownDeadProcess();
  }
}
