import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DeepSeekConfigurationError,
  DeepSeekProviderError,
  streamDeepSeek,
  testDeepSeekConnection
} from './deepseek-adapter.mjs';
import {
  CodexConfigurationError,
  CodexProviderError,
  listCodexModels,
  streamCodex,
  testCodexConnection
} from './codex/codex-adapter.mjs';
import {
  AiConfigValidationError,
  createAiConfigStore
} from './ai-config-store.mjs';

export const MAX_REQUEST_BYTES = 64 * 1024;
export const DEFAULT_TIMEOUT_MS = 45_000;
export const DEFAULT_CONFIG_TEST_TIMEOUT_MS = 10_000;
const MAX_MESSAGE_CHARS = 12_000;
const MAX_HISTORY_ITEMS = 12;
const MAX_HISTORY_CHARS = 32_000;
const HISTORY_ROLES = new Set(['user', 'assistant']);
const PROVIDER_VALUES = new Set(['deepseek', 'codex']);
const CODEX_EFFORT_VALUES = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const CODEX_SAFE_MODE_VALUES = new Set(['readOnly', 'workspaceWrite', 'dangerFullAccess']);
const MAX_CWD_CHARS = 4096;

export class AiRunRequestError extends Error {
  constructor(statusCode, publicMessage) {
    super(publicMessage);
    this.name = 'AiRunRequestError';
    this.statusCode = statusCode;
    this.publicMessage = publicMessage;
  }
}

function json(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  response.end(JSON.stringify(body));
}

function assertSameOrigin(request) {
  const origin = request.headers?.origin;
  if (!origin) return;
  const host = request.headers?.host;
  if (!host || origin !== `http://${host}`) {
    throw new AiRunRequestError(403, '拒绝跨来源 AI 请求');
  }
}

export function readJsonBody(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    request.on('data', (chunk) => {
      if (settled) return;
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += value.byteLength;
      if (bytes > MAX_REQUEST_BYTES) {
        fail(new AiRunRequestError(413, '请求内容过大'));
        return;
      }
      chunks.push(value);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new AiRunRequestError(400, '请求不是有效的 JSON'));
      }
    });
    request.on('aborted', () => fail(new AiRunRequestError(400, '请求已中断')));
    request.on('error', () => fail(new AiRunRequestError(400, '无法读取请求')));
  });
}

export function validateAiRunBody(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AiRunRequestError(400, '请求体必须是对象');
  if (typeof input.message !== 'string' || !input.message.trim()) throw new AiRunRequestError(400, 'message 不能为空');
  const message = input.message.trim();
  if (message.length > MAX_MESSAGE_CHARS) throw new AiRunRequestError(400, 'message 超出长度限制');

  const sourceHistory = input.history === undefined ? [] : input.history;
  if (!Array.isArray(sourceHistory)) throw new AiRunRequestError(400, 'history 必须是数组');
  if (sourceHistory.length > MAX_HISTORY_ITEMS) throw new AiRunRequestError(400, 'history 条目过多');
  let historyChars = 0;
  const history = sourceHistory.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new AiRunRequestError(400, 'history 条目无效');
    if (!HISTORY_ROLES.has(item.role)) throw new AiRunRequestError(400, 'history 包含不支持的角色');
    if (typeof item.content !== 'string' || !item.content.trim()) throw new AiRunRequestError(400, 'history 内容不能为空');
    const content = item.content.trim();
    historyChars += content.length;
    if (content.length > MAX_MESSAGE_CHARS || historyChars > MAX_HISTORY_CHARS) throw new AiRunRequestError(400, 'history 超出长度限制');
    return { role: item.role, content };
  });

  const provider = typeof input.provider === 'string' && PROVIDER_VALUES.has(input.provider) ? input.provider : 'deepseek';
  const codex = {};
  if (provider === 'codex' && input.codex && typeof input.codex === 'object' && !Array.isArray(input.codex)) {
    if (typeof input.codex.model === 'string' && input.codex.model.trim()) codex.model = input.codex.model.trim();
    if (typeof input.codex.effort === 'string' && CODEX_EFFORT_VALUES.has(input.codex.effort)) codex.effort = input.codex.effort;
    if (typeof input.codex.safeMode === 'string' && CODEX_SAFE_MODE_VALUES.has(input.codex.safeMode)) codex.safeMode = input.codex.safeMode;
    if (typeof input.codex.cwd === 'string' && input.codex.cwd.trim() && input.codex.cwd.trim().length <= MAX_CWD_CHARS) codex.cwd = input.codex.cwd.trim();
  }

  return { message, history, provider, codex };
}

function publicFailure(error) {
  if (error instanceof AiRunRequestError) return { status: error.statusCode, message: error.publicMessage, retryable: false };
  if (error instanceof AiConfigValidationError) return { status: error.statusCode, message: error.publicMessage, retryable: false };
  if (error instanceof DeepSeekConfigurationError) return { status: 503, message: 'AI 服务尚未配置，请在服务端设置新的 API key', retryable: false };
  if (error instanceof DeepSeekProviderError) {
    if (error.status === 401) return { status: 502, message: 'DeepSeek API key 无效，请检查 AI 设置', retryable: false };
    if (error.status === 402) return { status: 502, message: 'DeepSeek 账户余额不足，请检查账户', retryable: false };
    if (error.status === 422) return { status: 502, message: 'DeepSeek 模型或请求配置无效，请检查 AI 设置', retryable: false };
    if (error.status === 429) return { status: 429, message: 'DeepSeek 请求过于频繁，请稍后重试', retryable: true };
    return { status: 502, message: 'AI 服务暂时不可用，请稍后重试', retryable: true };
  }
  if (error instanceof CodexConfigurationError) return { status: 503, message: 'Codex 尚未配置或无法启动', retryable: false };
  if (error instanceof CodexProviderError) {
    if (/model is not supported|model.*not supported/u.test(error.message)) return { status: 502, message: 'Codex 模型不可用，请检查模型配置', retryable: false };
    if (/rate limit|too many requests/u.test(error.message)) return { status: 429, message: 'Codex 请求过于频繁，请稍后重试', retryable: true };
    return { status: 502, message: 'Codex 请求失败，请重试', retryable: true };
  }
  if (error?.name === 'TimeoutError') return { status: 504, message: 'AI 请求超时，请重试', retryable: true };
  if (error?.name === 'AbortError') return { status: 499, message: 'AI 请求已取消', retryable: true };
  return { status: 500, message: 'AI 请求失败，请重试', retryable: true };
}

function sendSse(response, event) {
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function openSse(response) {
  if (response.headersSent) return;
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    'x-content-type-options': 'nosniff'
  });
}

export function createAiRunHandler({
  configStore = createAiConfigStore(),
  streamProvider = streamDeepSeek,
  streamCodexProvider = streamCodex,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  return async function handleAiRun(request, response) {
    if (request.method !== 'POST' || new URL(request.url || '/', 'http://localhost').pathname !== '/api/ai/run') {
      json(response, 404, { error: 'Not found' });
      return;
    }

    try {
      assertSameOrigin(request);
    } catch (error) {
      const failure = publicFailure(error);
      json(response, failure.status, { error: failure.message, retryable: failure.retryable });
      return;
    }

    const abort = new AbortController();
    let clientDisconnected = false;
    const abortFromClient = () => {
      clientDisconnected = true;
      abort.abort(new DOMException('Client disconnected', 'AbortError'));
    };
    request.once?.('aborted', abortFromClient);
    response.once?.('close', () => {
      if (!response.writableEnded) abortFromClient();
    });
    let timer;
    const resetTimeout = () => {
      clearTimeout(timer);
      timer = setTimeout(() => abort.abort(new DOMException('Provider timeout', 'TimeoutError')), timeoutMs);
    };
    resetTimeout();

    try {
      const payload = validateAiRunBody(await readJsonBody(request));
      if (payload.provider === 'codex') {
        const saved = configStore.getProviderConfig();
        await streamCodexProvider({
          message: payload.message,
          model: payload.codex.model ?? saved.codexModel,
          effort: payload.codex.effort ?? saved.codexEffort,
          safeMode: payload.codex.safeMode ?? saved.codexSafeMode,
          cwd: payload.codex.cwd ?? saved.codexCwd,
          signal: abort.signal,
          onActivity: resetTimeout,
          onEvent: (event) => {
            resetTimeout();
            openSse(response);
            sendSse(response, event);
          }
        });
      } else {
        await streamProvider({
          message: payload.message,
          history: payload.history,
          config: configStore.getProviderConfig(),
          signal: abort.signal,
          onActivity: resetTimeout,
          onEvent: (event) => {
            resetTimeout();
            openSse(response);
            sendSse(response, event);
          }
        });
      }
      openSse(response);
      if (!response.writableEnded) response.end();
    } catch (error) {
      if (clientDisconnected) return;
      const failure = publicFailure(error);
      if (!response.headersSent) {
        json(response, failure.status, { error: failure.message, retryable: failure.retryable });
      } else if (!response.writableEnded) {
        sendSse(response, { type: 'error', message: failure.message, retryable: failure.retryable });
        response.end();
      }
    } finally {
      clearTimeout(timer);
    }
  };
}

export function createAiConfigHandler({
  configStore = createAiConfigStore(),
  testProvider = testDeepSeekConnection,
  codexTester = testCodexConnection,
  codexModelLister = listCodexModels,
  testTimeoutMs = DEFAULT_CONFIG_TEST_TIMEOUT_MS
} = {}) {
  return async function handleAiConfig(request, response) {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    try {
      if (request.method !== 'GET') assertSameOrigin(request);
      if (pathname === '/api/ai/config' && request.method === 'GET') {
        json(response, 200, configStore.getPublicConfig());
        return;
      }
      if (pathname === '/api/ai/config' && request.method === 'PUT') {
        const payload = await readJsonBody(request);
        json(response, 200, configStore.update(payload));
        return;
      }
      if (pathname === '/api/ai/codex/models' && request.method === 'GET') {
        const abort = new AbortController();
        const timer = setTimeout(
          () => abort.abort(new DOMException('Provider timeout', 'TimeoutError')),
          testTimeoutMs
        );
        try {
          const config = configStore.getProviderConfig();
          const models = await codexModelLister({ cwd: config.codexCwd, includeHidden: false, signal: abort.signal });
          json(response, 200, { models });
        } finally {
          clearTimeout(timer);
        }
        return;
      }
      if (pathname === '/api/ai/config/test' && request.method === 'POST') {
        const payload = await readJsonBody(request);
        const abort = new AbortController();
        const timer = setTimeout(
          () => abort.abort(new DOMException('Provider timeout', 'TimeoutError')),
          testTimeoutMs
        );
        try {
          const provider = typeof payload.provider === 'string' && PROVIDER_VALUES.has(payload.provider) ? payload.provider : 'deepseek';
          const { provider: _provider, ...draft } = payload;
          if (provider === 'codex') {
            const config = configStore.resolveProviderConfig(draft);
            await codexTester({ model: config.codexModel, cwd: config.codexCwd, signal: abort.signal });
            json(response, 200, { ok: true, model: config.codexModel });
          } else {
            const config = configStore.resolveProviderConfig(draft);
            await testProvider({ config, signal: abort.signal });
            json(response, 200, { ok: true, model: config.model });
          }
        } finally {
          clearTimeout(timer);
        }
        return;
      }
      json(response, 404, { error: 'Not found' });
    } catch (error) {
      const failure = publicFailure(error);
      if (!response.headersSent) json(response, failure.status, { error: failure.message, retryable: failure.retryable });
    }
  };
}

export function createAiApiHandler(options = {}) {
  const configStore = options.configStore ?? createAiConfigStore();
  const runHandler = createAiRunHandler({ ...options, configStore });
  const configHandler = createAiConfigHandler({ ...options, configStore });
  return async function handleAiApi(request, response) {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    if (pathname === '/api/ai/run') return runHandler(request, response);
    if (pathname === '/api/ai/config' || pathname === '/api/ai/config/test' || pathname === '/api/ai/codex/models') return configHandler(request, response);
    json(response, 404, { error: 'Not found' });
  };
}

export function createAiRunServer(options) {
  return createServer(createAiApiHandler(options));
}

function configuredTimeout() {
  const requested = Number(process.env.TIM_AI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return Number.isFinite(requested) ? Math.min(60_000, Math.max(30_000, requested)) : DEFAULT_TIMEOUT_MS;
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isEntrypoint) {
  const server = createAiRunServer({ timeoutMs: configuredTimeout() });
  const port = Number(process.env.TIM_AI_PORT || 4174);
  server.listen(port, '127.0.0.1', () => console.log(`Tim AI gateway: http://127.0.0.1:${port}/api/ai/run`));
}
