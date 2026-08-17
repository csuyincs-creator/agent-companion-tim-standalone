import type { WorkbenchEvent } from './contracts.js';

export class WorkbenchProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkbenchProtocolError';
  }
}

function parseEvent(payload: string): WorkbenchEvent {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    throw new WorkbenchProtocolError('SSE event contains invalid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WorkbenchProtocolError('SSE event must be an object');
  }
  const event = value as Record<string, unknown>;
  if (event.type === 'state' && ['running', 'needs_input', 'ready', 'blocked'].includes(String(event.status))) {
    return { type: 'state', status: event.status as 'running' | 'needs_input' | 'ready' | 'blocked' };
  }
  if (event.type === 'message_start') {
    return { type: 'message_start', itemId: typeof event.itemId === 'string' ? event.itemId : undefined };
  }
  if (event.type === 'message_delta' && typeof event.text === 'string') {
    return { type: 'message_delta', text: event.text };
  }
  if (event.type === 'needs_input' && typeof event.question === 'string') {
    const options = Array.isArray(event.options) ? event.options.filter((item): item is string => typeof item === 'string').slice(0, 12) : undefined;
    return { type: 'needs_input', question: event.question, options };
  }
  if (event.type === 'tool_start' && typeof event.tool === 'string') {
    return {
      type: 'tool_start',
      tool: event.tool,
      command: typeof event.command === 'string' ? event.command : undefined,
      query: typeof event.query === 'string' ? event.query : undefined,
      changes: event.changes
    };
  }
  if (event.type === 'tool_result' && typeof event.tool === 'string') {
    return {
      type: 'tool_result',
      tool: event.tool,
      output: typeof event.output === 'string' ? event.output : undefined,
      exitCode: typeof event.exitCode === 'number' ? event.exitCode : undefined,
      status: typeof event.status === 'string' ? event.status : undefined
    };
  }
  if (event.type === 'tool_output_delta' && typeof event.text === 'string') {
    return { type: 'tool_output_delta', text: event.text };
  }
  if (event.type === 'reasoning_delta' && typeof event.text === 'string') {
    return { type: 'reasoning_delta', text: event.text };
  }
  if (event.type === 'plan_delta' && typeof event.text === 'string') {
    return { type: 'plan_delta', text: event.text };
  }
  if (event.type === 'file_patch') {
    return { type: 'file_patch', changes: event.changes };
  }
  if (event.type === 'plan') {
    return { type: 'plan', steps: event.steps, explanation: typeof event.explanation === 'string' ? event.explanation : undefined };
  }
  if (event.type === 'usage') {
    return {
      type: 'usage',
      totalTokens: typeof event.totalTokens === 'number' ? event.totalTokens : undefined,
      inputTokens: typeof event.inputTokens === 'number' ? event.inputTokens : undefined,
      outputTokens: typeof event.outputTokens === 'number' ? event.outputTokens : undefined
    };
  }
  if (event.type === 'completed' && typeof event.summary === 'string') {
    return { type: 'completed', summary: event.summary };
  }
  if (event.type === 'error' && typeof event.message === 'string') {
    return { type: 'error', message: event.message, retryable: event.retryable !== false };
  }
  throw new WorkbenchProtocolError(`Unsupported SSE event type: ${String(event.type ?? 'missing')}`);
}

export async function* parseWorkbenchSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<WorkbenchEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const data = frame.split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (!data) continue;
        if (data.trim() === '[DONE]') return;
        yield parseEvent(data);
      }
      if (done) break;
    }
    const tail = buffer.trim();
    if (tail) {
      const data = tail.split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data && data.trim() !== '[DONE]') yield parseEvent(data);
    }
  } finally {
    reader.releaseLock();
  }
}
