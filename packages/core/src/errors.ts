import type { TimStatus, TimStateEvent } from './types.js';

export class TimStateError extends Error {
  readonly code = 'TIM_INVALID_STATE_TRANSITION';
  readonly from: TimStatus;
  readonly event: TimStateEvent['type'];

  constructor(from: TimStatus, event: TimStateEvent['type'], message: string) {
    super(message);
    this.name = 'TimStateError';
    this.from = from;
    this.event = event;
  }
}

export class TimValidationError extends Error {
  readonly code = 'TIM_INVALID_INPUT';

  constructor(message: string) {
    super(message);
    this.name = 'TimValidationError';
  }
}
