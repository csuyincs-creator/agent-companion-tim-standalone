import { buildWorkbenchRequest, type WorkbenchRunInput } from './contracts.js';
import { parseWorkbenchSse } from './sse-client.js';

export type TimWorkbenchPet = {
  startTask(input: { id: string; title: string; message?: string }): void;
  setProgress?(input: { id: string; progress: number; message?: string }): void;
  setTaskMessage?(input: { id: string; message: string }): void;
  requestInput(input: { id: string; question: string; options?: readonly string[] }): void;
  completeTask(input: { id: string; summary: string }): void;
  blockTask(input: { id: string; reason: string; retryable?: boolean }): void;
  reset(): void;
};

export type WorkbenchRunCallbacks = {
  onDelta?(text: string): void;
  onNeedsInput?(question: string, options?: readonly string[]): void;
  onToolStart?(tool: string, detail: string): void;
  onStatus?(status: string): void;
  onProgress?(progress: number): void;
};

export type WorkbenchRunResult = {
  readonly taskId: string;
  readonly text: string;
  readonly summary: string;
  readonly outcome: 'completed' | 'awaiting_input';
};

export class WorkbenchBusyError extends Error {
  constructor() {
    super('A workbench request is already running');
    this.name = 'WorkbenchBusyError';
  }
}

export class WorkbenchRequestError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = true) {
    super(message);
    this.name = 'WorkbenchRequestError';
    this.retryable = retryable;
  }
}

type ControllerOptions = {
  readonly tim: TimWorkbenchPet;
  readonly fetcher?: typeof fetch;
  readonly endpoint?: string;
  readonly createId?: () => string;
};

function defaultId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `tim-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function responseError(response: Response): Promise<WorkbenchRequestError> {
  let message = `AI request failed (${response.status})`;
  try {
    const body = await response.json() as { error?: unknown; retryable?: unknown };
    if (typeof body.error === 'string' && body.error.trim()) message = body.error.trim();
    if (typeof body.retryable === 'boolean') return new WorkbenchRequestError(message, body.retryable);
  } catch {
    // A non-JSON provider failure still gets a bounded, actionable status message.
  }
  return new WorkbenchRequestError(message, response.status >= 500 || response.status === 429);
}

export class TimWorkbenchController {
  readonly #tim: TimWorkbenchPet;
  readonly #fetcher: typeof fetch;
  readonly #endpoint: string;
  readonly #createId: () => string;
  #active?: AbortController;

  constructor(options: ControllerOptions) {
    this.#tim = options.tim;
    this.#fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.#endpoint = options.endpoint ?? '/api/ai/run';
    this.#createId = options.createId ?? defaultId;
  }

  get isRunning(): boolean { return Boolean(this.#active); }

  stop(): void { this.#active?.abort(); }

  reset(): void {
    this.stop();
    this.#tim.reset();
  }

  async run(input: WorkbenchRunInput, callbacks: WorkbenchRunCallbacks = {}): Promise<WorkbenchRunResult> {
    if (this.#active) throw new WorkbenchBusyError();
    const request = buildWorkbenchRequest(input);
    const taskId = this.#createId();
    const abort = new AbortController();
    this.#active = abort;
    let text = '';
    let summary = 'AI 已完成本轮回复。';
    let completed = false;
    let awaitingInput = false;
    let taskStarted = false;
    let progress = 5;
    const setProgress = (next: number, message?: string) => {
      progress = Math.max(5, Math.min(95, next));
      this.#tim.setProgress?.({ id: taskId, progress, message: message?.trim() });
      callbacks.onProgress?.(progress);
    };
    try {
      this.#tim.startTask({ id: taskId, title: request.message.slice(0, 80), message: '正在连接 AI…' });
      taskStarted = true;
      const response = await this.#fetcher(this.#endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: abort.signal
      });
      if (!response.ok) throw await responseError(response);
      if (!response.body) throw new WorkbenchRequestError('AI response stream is unavailable');
      for await (const event of parseWorkbenchSse(response.body)) {
        if (event.type === 'state') {
          if (event.status === 'running' && progress < 10) setProgress(10, 'AI 开始处理…');
          callbacks.onStatus?.(event.status === 'running' ? 'AI 开始处理…' : event.status);
        } else if (event.type === 'message_start') {
          // Marker event only; no UI update required.
        } else if (event.type === 'message_delta') {
          text += event.text;
          if (progress < 85) setProgress(85, '正在整理回复…');
          callbacks.onDelta?.(event.text);
        } else if (event.type === 'needs_input') {
          this.#tim.requestInput({ id: taskId, question: event.question, options: event.options });
          callbacks.onNeedsInput?.(event.question, event.options);
          awaitingInput = true;
        } else if (event.type === 'tool_start') {
          const detail = event.command ?? (typeof event.query === 'string' ? event.query : '') ?? '';
          const status = event.tool === 'command_execution'
            ? `正在执行命令：${detail}`
            : event.tool === 'file_change'
              ? '正在修改文件…'
              : event.tool === 'web_search'
                ? '正在搜索…'
                : '正在处理…';
          setProgress(55, status);
          callbacks.onToolStart?.(event.tool, detail);
          callbacks.onStatus?.(status);
        } else if (event.type === 'tool_result') {
          setProgress(80, '命令执行完成，继续生成…');
          callbacks.onStatus?.('命令执行完成，继续生成…');
        } else if (event.type === 'reasoning_delta' || event.type === 'plan_delta') {
          setProgress(30, '正在深度思考…');
          callbacks.onStatus?.('正在深度思考…');
        } else if (event.type === 'file_patch') {
          setProgress(65, '正在应用文件修改…');
          callbacks.onStatus?.('正在应用文件修改…');
        } else if (event.type === 'tool_output_delta') {
          if (progress < 60) setProgress(60, '正在接收命令输出…');
          callbacks.onStatus?.('正在接收命令输出…');
        } else if (event.type === 'plan') {
          setProgress(25, '正在制定执行计划…');
          callbacks.onStatus?.('正在制定执行计划…');
        } else if (event.type === 'usage') {
          if (progress < 90) setProgress(90, '正在汇总用量…');
        } else if (event.type === 'completed') {
          if (awaitingInput) throw new WorkbenchRequestError('AI protocol completed while user input is still required', false);
          summary = event.summary;
          this.#tim.completeTask({ id: taskId, summary });
          completed = true;
        } else if (event.type === 'error') {
          throw new WorkbenchRequestError(event.message, event.retryable);
        }
      }
      if (!completed && !awaitingInput) throw new WorkbenchRequestError('AI 响应意外中断，请重试', true);
      return { taskId, text, summary, outcome: awaitingInput ? 'awaiting_input' : 'completed' };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        this.#tim.reset();
        throw error;
      }
      const normalized = error instanceof WorkbenchRequestError
        ? error
        : new WorkbenchRequestError(error instanceof Error ? error.message : 'AI request failed');
      if (taskStarted) this.#tim.blockTask({ id: taskId, reason: normalized.message, retryable: normalized.retryable });
      throw normalized;
    } finally {
      if (this.#active === abort) this.#active = undefined;
    }
  }
}
