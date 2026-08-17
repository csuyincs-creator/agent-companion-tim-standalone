import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, win32 } from 'node:path';

export const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash';
export const DEFAULT_DEEPSEEK_THINKING = 'disabled';

export const DEFAULT_CODEX_MODEL = 'gpt-5.4-mini';
export const DEFAULT_CODEX_EFFORT = 'high';
export const DEFAULT_CODEX_SAFE_MODE = 'workspaceWrite';
export const DEFAULT_CODEX_CWD = process.cwd();

const ALLOWED_UPDATE_FIELDS = new Set([
  'baseUrl',
  'model',
  'thinking',
  'apiKey',
  'codexModel',
  'codexEffort',
  'codexSafeMode',
  'codexCwd'
]);
const ALLOWED_PERSISTED_FIELDS = new Set([
  'version',
  'provider',
  'baseUrl',
  'model',
  'thinking',
  'protectedApiKey',
  'codexModel',
  'codexEffort',
  'codexSafeMode',
  'codexCwd'
]);
const THINKING_MODES = new Set(['enabled', 'disabled']);
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
const MAX_BASE_URL_CHARS = 200;
const MAX_API_KEY_CHARS = 512;
const MAX_PERSISTED_CONFIG_BYTES = 16 * 1024;
const MAX_PROTECTED_KEY_CHARS = 8 * 1024;
const CODEX_EFFORT_VALUES = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const CODEX_SAFE_MODE_VALUES = new Set(['readOnly', 'workspaceWrite', 'dangerFullAccess']);
const MAX_CODEX_CWD_CHARS = 4096;
const DPAPI_ENTROPY = 'TimAssistant/ai-config/v1';

const DPAPI_PROTECT_SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  '[void][Reflection.Assembly]::LoadWithPartialName("System.Security")',
  '$inputStream = [Console]::OpenStandardInput()',
  '$memory = New-Object IO.MemoryStream',
  '$inputStream.CopyTo($memory)',
  '$inputBytes = $memory.ToArray()',
  `$entropy = [Text.Encoding]::UTF8.GetBytes("${DPAPI_ENTROPY}")`,
  '$outputBytes = [System.Security.Cryptography.ProtectedData]::Protect($inputBytes, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '$outputStream = [Console]::OpenStandardOutput()',
  '$outputStream.Write($outputBytes, 0, $outputBytes.Length)'
].join('; ');

const DPAPI_UNPROTECT_SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  '[void][Reflection.Assembly]::LoadWithPartialName("System.Security")',
  '$inputStream = [Console]::OpenStandardInput()',
  '$memory = New-Object IO.MemoryStream',
  '$inputStream.CopyTo($memory)',
  '$inputBytes = $memory.ToArray()',
  `$entropy = [Text.Encoding]::UTF8.GetBytes("${DPAPI_ENTROPY}")`,
  '$outputBytes = [System.Security.Cryptography.ProtectedData]::Unprotect($inputBytes, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '$outputStream = [Console]::OpenStandardOutput()',
  '$outputStream.Write($outputBytes, 0, $outputBytes.Length)'
].join('; ');

export class AiConfigValidationError extends Error {
  constructor(publicMessage) {
    super(publicMessage);
    this.name = 'AiConfigValidationError';
    this.statusCode = 400;
    this.publicMessage = publicMessage;
  }
}

export class AiConfigPersistenceError extends Error {
  constructor() {
    super('AI configuration persistence failed');
    this.name = 'AiConfigPersistenceError';
  }
}

function powershellPath() {
  const systemRoot = process.env.SystemRoot;
  return systemRoot
    ? win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe';
}

function runCurrentUserDpapi(script, input) {
  if (process.platform !== 'win32') throw new AiConfigPersistenceError();
  const result = spawnSync(
    powershellPath(),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    {
      input,
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: MAX_PERSISTED_CONFIG_BYTES,
      stdio: ['pipe', 'pipe', 'pipe']
    }
  );
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    throw new AiConfigPersistenceError();
  }
  return result.stdout;
}

export const currentUserDpapiProtector = Object.freeze({
  protect(value) {
    const plaintext = Buffer.from(value, 'utf8');
    try {
      return runCurrentUserDpapi(DPAPI_PROTECT_SCRIPT, plaintext).toString('base64');
    } finally {
      plaintext.fill(0);
    }
  },
  unprotect(value) {
    let protectedBytes;
    try {
      protectedBytes = Buffer.from(value, 'base64');
    } catch {
      throw new AiConfigPersistenceError();
    }
    const plaintext = runCurrentUserDpapi(DPAPI_UNPROTECT_SCRIPT, protectedBytes);
    try {
      return plaintext.toString('utf8');
    } finally {
      protectedBytes.fill(0);
      plaintext.fill(0);
    }
  }
});

export function defaultAiConfigPath({ env = process.env, platform = process.platform } = {}) {
  if (platform !== 'win32') return undefined;
  const localAppData = typeof env?.LOCALAPPDATA === 'string' ? env.LOCALAPPDATA.trim() : '';
  if (!localAppData || !win32.isAbsolute(localAppData)) return undefined;
  return win32.join(localAppData, 'TimAssistant', 'ai-config.json');
}

function requirePlainObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AiConfigValidationError('AI 配置必须是对象');
  }
}

function validateBaseUrl(value) {
  if (typeof value !== 'string') throw new AiConfigValidationError('DeepSeek API 地址无效');
  const input = value.trim();
  if (!input || input.length > MAX_BASE_URL_CHARS) throw new AiConfigValidationError('DeepSeek API 地址无效');
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new AiConfigValidationError('DeepSeek API 地址无效');
  }
  if (
    url.protocol !== 'https:'
    || url.hostname !== 'api.deepseek.com'
    || url.port
    || url.username
    || url.password
    || url.search
    || url.hash
    || (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new AiConfigValidationError('只允许 DeepSeek 官方 HTTPS API 地址');
  }
  return DEFAULT_DEEPSEEK_BASE_URL;
}

function validateModel(value) {
  if (typeof value !== 'string') throw new AiConfigValidationError('模型号无效');
  const model = value.trim();
  if (!MODEL_PATTERN.test(model)) throw new AiConfigValidationError('模型号无效');
  return model;
}

function validateThinking(value) {
  if (typeof value !== 'string' || !THINKING_MODES.has(value)) {
    throw new AiConfigValidationError('思考模式无效');
  }
  return value;
}

function validateCodexModel(value) {
  if (typeof value !== 'string') throw new AiConfigValidationError('Codex 模型无效');
  const model = value.trim();
  if (!MODEL_PATTERN.test(model)) throw new AiConfigValidationError('Codex 模型无效');
  return model;
}

function validateCodexEffort(value) {
  if (typeof value !== 'string' || !CODEX_EFFORT_VALUES.has(value)) {
    throw new AiConfigValidationError('Codex 思考强度无效');
  }
  return value;
}

function validateCodexSafeMode(value) {
  if (typeof value !== 'string' || !CODEX_SAFE_MODE_VALUES.has(value)) {
    throw new AiConfigValidationError('Codex 安全模式无效');
  }
  return value;
}

function validateCodexCwd(value) {
  if (typeof value !== 'string') throw new AiConfigValidationError('Codex 工作目录无效');
  const cwd = value.trim();
  if (!cwd || cwd.length > MAX_CODEX_CWD_CHARS) throw new AiConfigValidationError('Codex 工作目录无效');
  return cwd;
}

function validateApiKey(value, { preserveBlank = false } = {}) {
  if (typeof value !== 'string') throw new AiConfigValidationError('API key 无效');
  const apiKey = value.trim();
  if (!apiKey && preserveBlank) return undefined;
  if (apiKey.length < 8 || apiKey.length > MAX_API_KEY_CHARS || /\s/u.test(apiKey)) {
    throw new AiConfigValidationError('API key 无效');
  }
  return apiKey;
}

function safeInitialValue(value, validator, fallback) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    return validator(value);
  } catch {
    return fallback;
  }
}

function safeEnvironmentKey(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    return validateApiKey(value);
  } catch {
    return undefined;
  }
}

function normalizedStoragePath(value) {
  if (value === false || value === null || value === undefined) return undefined;
  if (typeof value !== 'string' || !isAbsolute(value)) {
    throw new TypeError('AI config storagePath must be an absolute path');
  }
  return value;
}

function requireSecretProtector(value) {
  if (!value || typeof value.protect !== 'function' || typeof value.unprotect !== 'function') {
    throw new TypeError('AI config secretProtector must provide protect and unprotect');
  }
  return value;
}

function validateProtectedKey(value) {
  if (
    typeof value !== 'string'
    || !value
    || value.length > MAX_PROTECTED_KEY_CHARS
    || /[\0\r\n]/u.test(value)
  ) {
    throw new AiConfigPersistenceError();
  }
  return value;
}

function parsePersistedConfig(storagePath, secretProtector) {
  if (!storagePath) return undefined;
  try {
    const stats = statSync(storagePath);
    if (!stats.isFile() || stats.size > MAX_PERSISTED_CONFIG_BYTES) return undefined;
    const document = JSON.parse(readFileSync(storagePath, 'utf8'));
    requirePlainObject(document);
    if ((document.version !== 1 && document.version !== 2) || document.provider !== 'deepseek') return undefined;
    for (const key of Object.keys(document)) {
      if (!ALLOWED_PERSISTED_FIELDS.has(key)) return undefined;
    }
    const current = validateAiConfigUpdate({
      baseUrl: document.baseUrl,
      model: document.model,
      thinking: document.thinking,
      codexModel: document.codexModel,
      codexEffort: document.codexEffort,
      codexSafeMode: document.codexSafeMode,
      codexCwd: document.codexCwd
    });
    let apiKey;
    if (Object.hasOwn(document, 'protectedApiKey')) {
      apiKey = validateApiKey(secretProtector.unprotect(validateProtectedKey(document.protectedApiKey)));
    }
    return { current, apiKey };
  } catch {
    return undefined;
  }
}

function serializePersistedConfig(current, apiKey, secretProtector) {
  const document = {
    version: 2,
    provider: 'deepseek',
    baseUrl: current.baseUrl,
    model: current.model,
    thinking: current.thinking,
    codexModel: current.codexModel,
    codexEffort: current.codexEffort,
    codexSafeMode: current.codexSafeMode,
    codexCwd: current.codexCwd
  };
  if (apiKey !== undefined) {
    document.protectedApiKey = validateProtectedKey(secretProtector.protect(apiKey));
  }
  const serialized = `${JSON.stringify(document, null, 2)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > MAX_PERSISTED_CONFIG_BYTES) {
    throw new AiConfigPersistenceError();
  }
  return serialized;
}

function persistConfig(storagePath, current, apiKey, secretProtector) {
  if (!storagePath) return;
  const temporaryPath = `${storagePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    mkdirSync(dirname(storagePath), { recursive: true, mode: 0o700 });
    writeFileSync(
      temporaryPath,
      serializePersistedConfig(current, apiKey, secretProtector),
      { encoding: 'utf8', flag: 'wx', mode: 0o600 }
    );
    renameSync(temporaryPath, storagePath);
  } catch {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // The temporary file may not have been created or may already have been renamed.
    }
    throw new AiConfigPersistenceError();
  }
}

export function validateAiConfigUpdate(input) {
  requirePlainObject(input);
  for (const key of Object.keys(input)) {
    if (!ALLOWED_UPDATE_FIELDS.has(key)) throw new AiConfigValidationError('AI 配置包含不支持的字段');
  }
  const update = {};
  if (Object.hasOwn(input, 'baseUrl')) update.baseUrl = validateBaseUrl(input.baseUrl);
  if (Object.hasOwn(input, 'model')) update.model = validateModel(input.model);
  if (Object.hasOwn(input, 'thinking')) update.thinking = validateThinking(input.thinking);
  if (Object.hasOwn(input, 'apiKey')) update.apiKey = validateApiKey(input.apiKey, { preserveBlank: true });
  if (Object.hasOwn(input, 'codexModel')) update.codexModel = validateCodexModel(input.codexModel);
  if (Object.hasOwn(input, 'codexEffort')) update.codexEffort = validateCodexEffort(input.codexEffort);
  if (Object.hasOwn(input, 'codexSafeMode')) update.codexSafeMode = validateCodexSafeMode(input.codexSafeMode);
  if (Object.hasOwn(input, 'codexCwd')) update.codexCwd = validateCodexCwd(input.codexCwd);
  return update;
}

export function createAiConfigStore(options = {}) {
  const env = options.env ?? process.env;
  const storagePath = normalizedStoragePath(
    Object.hasOwn(options, 'storagePath') ? options.storagePath : defaultAiConfigPath({ env })
  );
  const secretProtector = requireSecretProtector(options.secretProtector ?? currentUserDpapiProtector);
  const initial = {
    baseUrl: safeInitialValue(env.DEEPSEEK_BASE_URL, validateBaseUrl, DEFAULT_DEEPSEEK_BASE_URL),
    model: safeInitialValue(env.DEEPSEEK_MODEL, validateModel, DEFAULT_DEEPSEEK_MODEL),
    thinking: safeInitialValue(env.DEEPSEEK_THINKING, validateThinking, DEFAULT_DEEPSEEK_THINKING),
    codexModel: safeInitialValue(env.CODEX_MODEL, validateCodexModel, DEFAULT_CODEX_MODEL),
    codexEffort: safeInitialValue(env.CODEX_EFFORT, validateCodexEffort, DEFAULT_CODEX_EFFORT),
    codexSafeMode: safeInitialValue(env.CODEX_SAFE_MODE, validateCodexSafeMode, DEFAULT_CODEX_SAFE_MODE),
    codexCwd: safeInitialValue(env.CODEX_CWD, validateCodexCwd, DEFAULT_CODEX_CWD)
  };
  const environmentKey = safeEnvironmentKey(env.DEEPSEEK_API_KEY);
  const persisted = parsePersistedConfig(storagePath, secretProtector);
  let current = persisted?.current ?? { ...initial };
  let memoryKey = persisted?.apiKey;

  function getProviderConfig() {
    return {
      ...current,
      apiKey: memoryKey ?? environmentKey
    };
  }

  function getPublicConfig() {
    return {
      provider: 'deepseek',
      baseUrl: current.baseUrl,
      model: current.model,
      thinking: current.thinking,
      configured: Boolean(memoryKey ?? environmentKey),
      codexModel: current.codexModel,
      codexEffort: current.codexEffort,
      codexSafeMode: current.codexSafeMode,
      codexCwd: current.codexCwd
    };
  }

  function update(input) {
    const validated = validateAiConfigUpdate(input);
    const { apiKey, ...publicUpdate } = validated;
    const nextCurrent = { ...current, ...publicUpdate };
    const nextMemoryKey = apiKey ?? memoryKey;
    persistConfig(storagePath, nextCurrent, nextMemoryKey, secretProtector);
    current = nextCurrent;
    memoryKey = nextMemoryKey;
    return getPublicConfig();
  }

  function resolveProviderConfig(input) {
    const validated = validateAiConfigUpdate(input);
    const { apiKey, ...publicUpdate } = validated;
    const draft = { ...getProviderConfig(), ...publicUpdate };
    if (apiKey !== undefined) draft.apiKey = apiKey;
    return draft;
  }

  return Object.freeze({ getProviderConfig, getPublicConfig, update, resolveProviderConfig });
}
