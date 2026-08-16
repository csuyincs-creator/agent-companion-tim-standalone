import { TimStateError, TimValidationError } from './errors.js';
import type {
  BlockInput,
  CompletionInput,
  InputRequest,
  ProgressInput,
  StartTaskInput,
  TimStateChange,
  TimStateEvent,
  TimStateListener,
  TimTaskSnapshot,
  TimStableStatus
} from './types.js';

const EMPTY_STATE: TimTaskSnapshot = Object.freeze({ status: 'idle' });

function cloneState(state: TimTaskSnapshot): TimTaskSnapshot {
  return Object.freeze({
    ...state,
    inputOptions: state.inputOptions ? Object.freeze([...state.inputOptions]) : undefined
  });
}

function requireText(value: string | undefined, field: string): string {
  if (!value || !value.trim()) {
    throw new TimValidationError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function requireTaskId(expectedId: string | undefined, actualId: string, event: string): void {
  if (!expectedId || expectedId !== actualId) {
    throw new TimValidationError(`Task id mismatch for ${event}`);
  }
}

function requireProgress(progress: number): number {
  if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
    throw new TimValidationError('progress must be a finite number from 0 to 100');
  }
  return progress;
}

export class TimStateMachine {
  #state: TimTaskSnapshot = EMPTY_STATE;
  #listeners = new Set<TimStateListener>();

  getSnapshot(): TimTaskSnapshot {
    return this.#state;
  }

  subscribe(listener: TimStateListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispatch(event: TimStateEvent): TimTaskSnapshot {
    const previous = this.#state;
    const current = cloneState(this.#reduce(previous, event));
    this.#state = current;
    const change: TimStateChange = { previous, current, event: event.type };
    for (const listener of this.#listeners) listener(change);
    return current;
  }

  startTask(input: StartTaskInput): TimTaskSnapshot {
    return this.dispatch({ type: 'start', input });
  }

  setProgress(input: ProgressInput): TimTaskSnapshot {
    return this.dispatch({ type: 'progress', input });
  }

  requestInput(input: InputRequest): TimTaskSnapshot {
    return this.dispatch({ type: 'request_input', input });
  }

  submitInput(id: string, value: string): TimTaskSnapshot {
    return this.dispatch({ type: 'submit_input', id, value });
  }

  completeTask(input: CompletionInput): TimTaskSnapshot {
    return this.dispatch({ type: 'complete', input });
  }

  blockTask(input: BlockInput): TimTaskSnapshot {
    return this.dispatch({ type: 'block', input });
  }

  showExtras(input: import('./types.js').ExtrasInput = {}): TimTaskSnapshot {
    if (input.id && this.#state.id && input.id !== this.#state.id) {
      throw new TimValidationError('Task id mismatch for extras');
    }
    return this.dispatch({ type: 'extras', input });
  }

  restoreFromExtras(): TimTaskSnapshot {
    return this.dispatch({ type: 'restore' });
  }

  retryTask(id?: string): TimTaskSnapshot {
    return this.dispatch({ type: 'retry', id });
  }

  reset(): TimTaskSnapshot {
    return this.dispatch({ type: 'reset' });
  }

  #reduce(state: TimTaskSnapshot, event: TimStateEvent): TimTaskSnapshot {
    switch (event.type) {
      case 'start':
        if (!['idle', 'ready', 'blocked'].includes(state.status)) {
          throw new TimStateError(state.status, event.type, `Cannot start a new task from ${state.status}`);
        }
        return {
          id: requireText(event.input.id, 'id'),
          title: requireText(event.input.title, 'title'),
          status: 'running',
          message: event.input.message?.trim(),
          progress: 0
        };
      case 'progress':
        if (state.status !== 'running') {
          throw new TimStateError(state.status, event.type, `Cannot update progress from ${state.status}`);
        }
        requireTaskId(state.id, event.input.id, event.type);
        return { ...state, progress: requireProgress(event.input.progress), message: event.input.message?.trim() };
      case 'request_input':
        if (state.status !== 'running') {
          throw new TimStateError(state.status, event.type, `Cannot request input from ${state.status}`);
        }
        requireTaskId(state.id, event.input.id, event.type);
        return {
          ...state,
          status: 'needs_input',
          inputQuestion: requireText(event.input.question, 'question'),
          inputOptions: event.input.options?.map((option) => requireText(option, 'option')),
          message: undefined
        };
      case 'submit_input':
        if (state.status !== 'needs_input') {
          throw new TimStateError(state.status, event.type, `Cannot submit input from ${state.status}`);
        }
        requireTaskId(state.id, event.id, event.type);
        return { ...state, status: 'running', lastInput: requireText(event.value, 'value'), message: undefined };
      case 'complete':
        if (state.status !== 'running') {
          throw new TimStateError(state.status, event.type, `Cannot complete from ${state.status}`);
        }
        requireTaskId(state.id, event.input.id, event.type);
        return { ...state, status: 'ready', progress: 100, resultSummary: requireText(event.input.summary, 'summary'), message: undefined };
      case 'block':
        if (!['running', 'needs_input'].includes(state.status)) {
          throw new TimStateError(state.status, event.type, `Cannot block from ${state.status}`);
        }
        requireTaskId(state.id, event.input.id, event.type);
        return {
          ...state,
          status: 'blocked',
          blockReason: requireText(event.input.reason, 'reason'),
          retryable: event.input.retryable ?? true,
          message: undefined
        };
      case 'extras': {
        if (state.status === 'extras') {
          throw new TimStateError(state.status, event.type, 'Cannot show extras while already in extras');
        }
        const resumeStatus: TimStableStatus = state.status;
        return {
          ...state,
          status: 'extras',
          resumeStatus,
          message: event.input?.variant ? `Extra: ${event.input.variant}` : '随机动作'
        };
      }
      case 'restore':
        if (state.status !== 'extras') {
          throw new TimStateError(state.status, event.type, `Cannot restore from ${state.status}`);
        }
        return { ...state, status: state.resumeStatus ?? 'idle', resumeStatus: undefined, message: undefined };
      case 'retry':
        if (state.status !== 'blocked') {
          throw new TimStateError(state.status, event.type, `Cannot retry from ${state.status}`);
        }
        const retryId = event.id ?? state.id;
        if (!retryId) throw new TimValidationError('Task id is required for retry');
        requireTaskId(state.id, retryId, event.type);
        if (!state.retryable) throw new TimValidationError('This task is not retryable');
        return { ...state, status: 'running', message: 'Retrying…', blockReason: undefined, retryable: undefined };
      case 'reset':
        return EMPTY_STATE;
    }
  }
}
