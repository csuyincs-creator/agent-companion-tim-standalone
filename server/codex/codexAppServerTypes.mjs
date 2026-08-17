// server/codex/codexAppServerTypes.mjs
// Codex app-server stdio JSON-RPC protocol types.
// Field names match the wire format (camelCase).
// Validated against codex-cli 0.144.5 schema on 2026-07-16.

// All types are defined as JSDoc typedefs and re-exported as module constants.
// This file serves as documentation for the protocol shapes.

export const CODEX_APP_SERVER_CLIENT_INFO = Object.freeze({
  name: 'tim-assistant',
  version: '1.0.0',
});

export const CODEX_INITIALIZE_PARAMS = Object.freeze({
  clientInfo: CODEX_APP_SERVER_CLIENT_INFO,
  capabilities: { experimentalApi: true },
  version: '2025-03-01',
});

// Sandbox policy presets
export const SANDBOX_POLICY = Object.freeze({
  readOnly(cwd) {
    return {
      type: 'readOnly',
      access: { type: 'fullAccess' },
      networkAccess: false,
    };
  },
  workspaceWrite(cwd) {
    return {
      type: 'workspaceWrite',
      writableRoots: [cwd],
      readOnlyAccess: { type: 'fullAccess' },
      networkAccess: false,
      excludeTmpdirEnvVar: true,
      excludeSlashTmp: true,
    };
  },
  workspaceWriteWithNetwork(cwd) {
    return {
      type: 'workspaceWrite',
      writableRoots: [cwd],
      readOnlyAccess: { type: 'fullAccess' },
      networkAccess: true,
      excludeTmpdirEnvVar: true,
      excludeSlashTmp: true,
    };
  },
  dangerFullAccess() {
    return { type: 'dangerFullAccess' };
  },
});

export const REASONING_EFFORT_VALUES = Object.freeze([
  'low', 'medium', 'high', 'xhigh', 'max', 'ultra',
]);

export const DEFAULT_REASONING_EFFORT = 'high';