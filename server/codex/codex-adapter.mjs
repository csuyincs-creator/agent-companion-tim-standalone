// server/codex/codex-adapter.mjs
import { randomUUID } from 'node:crypto';
import { CodexSession } from './CodexSession.mjs';

export class CodexConfigurationError extends Error {
  constructor() {
    super('Codex is not configured');
    this.name = 'CodexConfigurationError';
  }
}

export class CodexProviderError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CodexProviderError';
  }
}

const MODEL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
const REASONING_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);

function publicModel(model) {
  if (!model || typeof model.model !== 'string' || !MODEL_NAME_PATTERN.test(model.model)) return undefined;
  const displayName = typeof model.displayName === 'string' && model.displayName.trim()
    ? model.displayName.trim().slice(0, 120)
    : model.model;
  const description = typeof model.description === 'string' ? model.description.trim().slice(0, 500) : '';
  const supportedReasoningEfforts = Array.isArray(model.supportedReasoningEfforts)
    ? model.supportedReasoningEfforts
      .map((option) => option?.reasoningEffort)
      .filter((effort) => REASONING_EFFORTS.has(effort))
    : [];
  return {
    model: model.model,
    displayName,
    description,
    isDefault: model.isDefault === true,
    supportedReasoningEfforts: [...new Set(supportedReasoningEfforts)]
  };
}

export async function listCodexModels({ cwd = process.cwd(), signal, includeHidden = false } = {}) {
  const session = new CodexSession();
  try {
    const catalog = await session.listModels({ cwd, signal, includeHidden });
    return catalog.map(publicModel).filter(Boolean);
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new CodexProviderError(error?.message || 'Codex 模型列表读取失败');
  } finally {
    await session.dispose().catch(() => {});
  }
}

/**
 * Stream Codex execution results as SSE events.
 * This is the main entry point for the Tim assistant.
 *
 * @param {object} options
 * @param {string} options.message - User's text message
 * @param {string} [options.model] - Model name (e.g. 'gpt-5-codex')
 * @param {string} [options.effort] - Reasoning effort: low/medium/high/xhigh/max
 * @param {string} [options.safeMode] - Sandbox mode: readOnly/workspaceWrite/dangerFullAccess
 * @param {string} [options.cwd] - Working directory
 * @param {AbortSignal} [options.signal] - Abort signal
 * @param {Function} options.onEvent - Callback: (event) => void
 * @param {Function} [options.onActivity] - Activity callback for timeout reset
 * @returns {Promise<void>}
 */
export async function streamCodex({
  message,
  model,
  effort = 'high',
  safeMode = 'workspaceWrite',
  cwd = process.cwd(),
  signal,
  onEvent,
  onActivity,
}) {
  const session = new CodexSession();
  const requestId = randomUUID();

  try {
    onEvent({ type: 'state', status: 'running', requestId, model: `codex:${model}` });

    await session.execute({
      message,
      model,
      effort,
      safeMode,
      cwd,
      signal,
    }, (event) => {
      onEvent(event);
    });

  } catch (error) {
    if (signal?.aborted) return;
    // Error event already sent by execute(), just propagate
    throw new CodexProviderError(error.message || 'Codex execution failed');
  } finally {
    await session.dispose().catch(() => {});
  }
}

/**
 * Test Codex connection by starting a process and checking the initialize handshake.
 * @param {object} options
 * @param {string} [options.cwd] - Working directory
 * @param {AbortSignal} [options.signal] - Abort signal
 * @returns {Promise<{ ok: boolean, model: string }>}
 */
export async function testCodexConnection({ model, cwd = process.cwd(), signal } = {}) {
  const models = await listCodexModels({ cwd, signal, includeHidden: true });
  const selected = models.find((candidate) => candidate.model === model);
  if (model && !selected) throw new CodexProviderError(`model is not supported: ${model}`);
  return { ok: true, model: selected?.model ?? models.find((candidate) => candidate.isDefault)?.model ?? models[0]?.model ?? 'codex' };
}
