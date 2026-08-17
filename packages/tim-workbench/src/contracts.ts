export const MAX_MESSAGE_CHARS = 4_000;
export const MAX_HISTORY_ITEMS = 12;
export const MAX_HISTORY_MESSAGE_CHARS = 4_000;
export const MAX_HISTORY_TOTAL_CHARS = 32_000;
export const MAX_REQUEST_UTF8_BYTES = 60 * 1024;

export type WorkbenchHistoryItem = {
  readonly role: 'user' | 'assistant';
  readonly content: string;
};

export type WorkbenchProvider = 'deepseek' | 'codex';

export type CodexRunOptions = {
  readonly model?: string;
  readonly effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
  readonly safeMode?: 'readOnly' | 'workspaceWrite' | 'dangerFullAccess';
  readonly cwd?: string;
};

export type WorkbenchRequest = {
  readonly conversationId: string;
  readonly message: string;
  readonly history: readonly WorkbenchHistoryItem[];
  readonly provider?: WorkbenchProvider;
  readonly codex?: CodexRunOptions;
};

export type WorkbenchRunInput = {
  readonly conversationId: string;
  readonly message: string;
  readonly history?: readonly WorkbenchHistoryItem[];
  readonly provider?: WorkbenchProvider;
  readonly codex?: CodexRunOptions;
};

export type WorkbenchEvent =
  | { readonly type: 'state'; readonly status: 'running' | 'needs_input' | 'ready' | 'blocked' }
  | { readonly type: 'message_start'; readonly itemId?: string }
  | { readonly type: 'message_delta'; readonly text: string }
  | { readonly type: 'needs_input'; readonly question: string; readonly options?: readonly string[] }
  | { readonly type: 'tool_start'; readonly tool: string; readonly command?: string; readonly changes?: unknown; readonly query?: string }
  | { readonly type: 'tool_result'; readonly tool: string; readonly output?: string; readonly exitCode?: number; readonly status?: string }
  | { readonly type: 'tool_output_delta'; readonly text: string }
  | { readonly type: 'reasoning_delta'; readonly text: string }
  | { readonly type: 'plan_delta'; readonly text: string }
  | { readonly type: 'file_patch'; readonly changes: unknown }
  | { readonly type: 'plan'; readonly steps: unknown; readonly explanation?: string }
  | { readonly type: 'usage'; readonly totalTokens?: number; readonly inputTokens?: number; readonly outputTokens?: number }
  | { readonly type: 'completed'; readonly summary: string }
  | { readonly type: 'error'; readonly message: string; readonly retryable: boolean };

function boundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

export function buildWorkbenchRequest(input: WorkbenchRunInput): WorkbenchRequest {
  const message = boundedString(input.message, MAX_MESSAGE_CHARS);
  if (!message) throw new TypeError('message is required');
  const candidates = (input.history ?? [])
    .filter((item): item is WorkbenchHistoryItem => item?.role === 'user' || item?.role === 'assistant')
    .map((item) => ({ role: item.role, content: boundedString(item.content, MAX_HISTORY_MESSAGE_CHARS) }))
    .filter((item): item is WorkbenchHistoryItem => Boolean(item.content))
    .slice(-MAX_HISTORY_ITEMS);
  const history: WorkbenchHistoryItem[] = [];
  let historyChars = 0;
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const item = candidates[index];
    if (!item || historyChars + item.content.length > MAX_HISTORY_TOTAL_CHARS) continue;
    history.unshift(item);
    historyChars += item.content.length;
  }
  const request = {
    conversationId: boundedString(input.conversationId, 128) ?? 'local',
    message,
    history,
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.codex ? { codex: input.codex } : {})
  };
  const encoder = new TextEncoder();
  while (request.history.length && encoder.encode(JSON.stringify(request)).byteLength > MAX_REQUEST_UTF8_BYTES) {
    (request.history as WorkbenchHistoryItem[]).shift();
  }
  return request;
}
