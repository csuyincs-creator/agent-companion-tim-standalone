// server/codex/CodexAppServerSupport.mjs
import { CODEX_INITIALIZE_PARAMS } from './codexAppServerTypes.mjs';

/**
 * Build the launch spec for the Codex app-server process.
 * @param {object} options
 * @param {string} options.cwd - Working directory
 * @param {string} [options.codexCommand] - Path to codex CLI (default: 'codex')
 * @returns {{ command: string, args: string[], spawnCwd: string, env: Record<string, string> }}
 */
export function buildCodexAppServerLaunchSpec({ cwd, codexCommand = 'codex' }) {
  return {
    command: codexCommand,
    args: ['app-server'],
    spawnCwd: cwd,
    env: Object.fromEntries(
      Object.entries(process.env).filter(([, v]) => v !== undefined),
    ),
  };
}

/**
 * Initialize the Codex app-server transport.
 * Sends the initialize handshake and returns the server info.
 * @param {import('./CodexRpcTransport.mjs').CodexRpcTransport} transport
 * @returns {Promise<import('./codexAppServerTypes.mjs').InitializeResult>}
 */
export async function initializeCodexAppServerTransport(transport) {
  const result = await transport.request('initialize', CODEX_INITIALIZE_PARAMS);

  transport.notify('initialized');
  return result;
}

export async function listModels(transport, { cursor = null, limit = 100, includeHidden = false } = {}) {
  return transport.request('model/list', { cursor, limit, includeHidden });
}

/**
 * Start a thread with the given parameters.
 * @param {import('./CodexRpcTransport.mjs').CodexRpcTransport} transport
 * @param {object} options
 * @param {string} options.model
 * @param {string} options.cwd
 * @param {string} [options.baseInstructions]
 * @returns {Promise<import('./codexAppServerTypes.mjs').ThreadStartResult>}
 */
export async function startThread(transport, { model, cwd, baseInstructions }) {
  return transport.request('thread/start', {
    model,
    cwd,
    baseInstructions,
    experimentalRawEvents: true,
    persistExtendedHistory: false,
  });
}

/**
 * Start a turn (user message) in the given thread.
 * @param {import('./CodexRpcTransport.mjs').CodexRpcTransport} transport
 * @param {object} options
 * @param {string} options.threadId
 * @param {string} options.message - User's text message
 * @param {string} [options.model]
 * @param {string} [options.effort]
 * @param {string} [options.safeMode]
 * @param {string} [options.cwd]
 * @returns {Promise<import('./codexAppServerTypes.mjs').TurnStartResult>}
 */
export async function startTurn(transport, { threadId, message, model, effort, safeMode, cwd }) {
  const sandboxPolicy = buildSandboxPolicy(safeMode, cwd);
  return transport.request('turn/start', {
    threadId,
    input: [{ type: 'text', text: message }],
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    sandboxPolicy,
    summary: 'auto',
  });
}

/**
 * Build sandbox policy from safe mode string.
 * @param {string} safeMode - 'readOnly' | 'workspaceWrite' | 'dangerFullAccess'
 * @param {string} cwd - Working directory
 */
function buildSandboxPolicy(safeMode, cwd) {
  const cwd_ = cwd || process.cwd();

  switch (safeMode) {
    case 'readOnly':
      return {
        type: 'readOnly',
        access: { type: 'fullAccess' },
        networkAccess: false,
      };
    case 'workspaceWrite':
      return {
        type: 'workspaceWrite',
        writableRoots: [cwd_],
        readOnlyAccess: { type: 'fullAccess' },
        networkAccess: false,
        excludeTmpdirEnvVar: true,
        excludeSlashTmp: true,
      };
    case 'dangerFullAccess':
      return { type: 'dangerFullAccess' };
    default:
      // Default to workspaceWrite with a warning for invalid values
      if (safeMode && safeMode !== 'workspaceWrite') {
        console.warn(`[Codex] Unknown safeMode "${safeMode}", defaulting to workspaceWrite`);
      }
      return {
        type: 'workspaceWrite',
        writableRoots: [cwd_],
        readOnlyAccess: { type: 'fullAccess' },
        networkAccess: false,
        excludeTmpdirEnvVar: true,
        excludeSlashTmp: true,
      };
  }
}
