export const TIM_STATUSES = [
  'idle',
  'running',
  'needs_input',
  'ready',
  'blocked',
  'extras'
] as const;

export type TimStatus = (typeof TIM_STATUSES)[number];
export type TimStableStatus = Exclude<TimStatus, 'extras'>;
export type TimProgress = number;

export interface TimTaskSnapshot {
  readonly id?: string;
  readonly title?: string;
  readonly status: TimStatus;
  readonly message?: string;
  readonly progress?: TimProgress;
  readonly resultSummary?: string;
  readonly blockReason?: string;
  readonly retryable?: boolean;
  readonly inputQuestion?: string;
  readonly inputOptions?: readonly string[];
  readonly lastInput?: string;
  /** The task state to resume after the transient extras presentation. */
  readonly resumeStatus?: TimStableStatus;
}

export interface StartTaskInput {
  id: string;
  title: string;
  message?: string;
}

export interface ProgressInput {
  id: string;
  progress: TimProgress;
  message?: string;
}

export interface InputRequest {
  id: string;
  question: string;
  options?: readonly string[];
}

export interface CompletionInput {
  id: string;
  summary: string;
}

export interface BlockInput {
  id: string;
  reason: string;
  retryable?: boolean;
}

export interface ExtrasInput {
  id?: string;
  variant?: string;
  durationMs?: number;
}

export interface TimStateChange {
  readonly previous: TimTaskSnapshot;
  readonly current: TimTaskSnapshot;
  readonly event: TimStateEvent['type'];
}

export type TimStateEvent =
  | { type: 'start'; input: StartTaskInput }
  | { type: 'progress'; input: ProgressInput }
  | { type: 'request_input'; input: InputRequest }
  | { type: 'submit_input'; id: string; value: string }
  | { type: 'complete'; input: CompletionInput }
  | { type: 'block'; input: BlockInput }
  | { type: 'extras'; input?: ExtrasInput }
  | { type: 'restore' }
  | { type: 'retry'; id?: string }
  | { type: 'reset' };

export type TimStateListener = (change: TimStateChange) => void;
