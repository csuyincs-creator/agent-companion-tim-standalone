import { randomUUID } from 'node:crypto';

import { createAiConfigStore } from './ai-config-store.mjs';

export class DeepSeekConfigurationError extends Error {
  constructor() {
    super('DeepSeek API key is not configured');
    this.name = 'DeepSeekConfigurationError';
  }
}

export class DeepSeekProviderError extends Error {
  constructor(status) {
    super('DeepSeek provider request failed');
    this.name = 'DeepSeekProviderError';
    this.status = Number.isInteger(status) ? status : 0;
  }
}

function requireKey(config) {
  const key = config.apiKey;
  if (!key) throw new DeepSeekConfigurationError();
  return key;
}

function validatedProviderConfig(config) {
  if (!config) return createAiConfigStore().getProviderConfig();
  const store = createAiConfigStore({ env: {} });
  const update = {
    baseUrl: config.baseUrl,
    model: config.model,
    thinking: config.thinking
  };
  if (config.apiKey !== undefined) update.apiKey = config.apiKey;
  store.update(update);
  return store.getProviderConfig();
}

function emitDataLine(line, onEvent) {
  if (!line.startsWith('data:')) return { validChoice: false, done: false };
  const payload = line.slice(5).trim();
  if (!payload) return { validChoice: false, done: false };
  if (payload === '[DONE]') return { validChoice: false, done: true };
  let chunk;
  try {
    chunk = JSON.parse(payload);
  } catch {
    throw new DeepSeekProviderError(0);
  }
  const choice = chunk.choices?.[0];
  if (!choice || typeof choice !== 'object') return { validChoice: false, done: false };
  if (choice.finish_reason !== null && choice.finish_reason !== undefined && choice.finish_reason !== 'stop') {
    throw new DeepSeekProviderError(0);
  }
  const delta = choice.delta?.content;
  if (typeof delta === 'string' && delta) onEvent({ type: 'message_delta', text: delta });
  return {
    validChoice: true,
    done: false
  };
}

export async function streamDeepSeek({ message, history = [], config, signal, onEvent, onActivity }) {
  const providerConfig = validatedProviderConfig(config);
  const key = requireKey(providerConfig);
  const { baseUrl, model, thinking } = providerConfig;
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    signal,
    body: JSON.stringify({
      model,
      stream: true,
      max_tokens: 4096,
      thinking: { type: thinking },
      messages: [
        {
          role: 'system',
          content: `你是 Tim，一个通用个人 AI 工作助手。当前实际使用的模型是 ${model}。优先直接回答用户当前问题，不要假设你能访问用户的页面、文件或电脑。只有系统明确提供内容时才能分析该内容。本阶段只允许生成文本；不得声称已经写入、移动、删除、发送或发布任何内容。`
        },
        ...history,
        { role: 'user', content: message }
      ]
    })
  });

  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new DeepSeekProviderError(response.status);
  }

  onEvent({ type: 'state', status: 'running', requestId: randomUUID(), model });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sawValidChoice = false;
  let sawDone = false;
  const consume = (line) => {
    const result = emitDataLine(line, onEvent);
    sawValidChoice ||= result.validChoice;
    sawDone ||= result.done;
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      onActivity?.();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) consume(line);
    }
    buffer += decoder.decode();
    if (buffer) consume(buffer);
  } finally {
    reader.releaseLock();
  }
  if (!sawValidChoice || !sawDone) throw new DeepSeekProviderError(0);
  onEvent({ type: 'completed', summary: 'DeepSeek 已完成本轮回复。' });
}

export async function testDeepSeekConnection({ config, signal }) {
  const providerConfig = validatedProviderConfig(config);
  const key = requireKey(providerConfig);
  const { baseUrl, model, thinking } = providerConfig;
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    signal,
    body: JSON.stringify({
      model,
      stream: false,
      max_tokens: 1,
      thinking: { type: thinking },
      messages: [{ role: 'user', content: 'Reply with OK.' }]
    })
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new DeepSeekProviderError(response.status);
  }
  await response.body?.cancel().catch(() => {});
  return { ok: true, model };
}
