export const READY_TO_IDLE_DELAY_MS = 4000;

export type WorkbenchVisualState = 'idle' | 'running' | 'needs_input' | 'ready' | 'blocked' | 'extras';

export const WORKBENCH_STATE_LABELS: Readonly<Record<WorkbenchVisualState, string>> = Object.freeze({
  idle: '待机',
  running: '工作中',
  needs_input: '等待确认',
  ready: '已完成',
  blocked: '遇到问题',
  extras: '随机互动'
});
