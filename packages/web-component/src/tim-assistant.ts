import { TimStateMachine } from '../../core/src/state-machine.js';
import type { TimStateChange, TimTaskSnapshot } from '../../core/src/types.js';
import { TimEffectsController, timEffectAssetUrl, type TimEffectRequest } from './effects.js';
import {
  TIM_IDLE_SLEEP_DURATION_MS,
  completeSpriteLoopDuration,
  pickDifferentIndex,
  pickIdleRandomInteraction,
  randomIdleInteractionDelay,
  shouldAnimateTimStatus,
  shouldRotateTimClip,
  shouldScheduleIdleInteraction
} from './sprite-motion.js';

const STATUS_LABEL: Record<TimTaskSnapshot['status'], string> = {
  idle: 'Idle', running: 'Running', needs_input: 'Needs Input', ready: 'Ready', blocked: 'Blocked', extras: 'Extras'
};
const STATUS_MESSAGE: Record<TimTaskSnapshot['status'], string> = {
  idle: '在呢，随时叫我～', running: '正在处理，请稍等一下', needs_input: '这里需要你确认一下哦',
  ready: '搞定啦！请审阅结果', blocked: '哎呀，遇到问题了…', extras: '来个随机小动作～'
};
const EFFECT_POOLS: Record<TimTaskSnapshot['status'], readonly TimEffectRequest[]> = {
  idle: [],
  running: [
    { type: 'idea', priority: 'low', durationMs: 1400 },
    { type: 'confusion', priority: 'low', durationMs: 1400 },
    { type: 'music', priority: 'low', durationMs: 1200 }
  ],
  needs_input: [
    { type: 'question', priority: 'high', persistent: true },
    { type: 'exclamation', priority: 'high', persistent: true }
  ],
  ready: [
    { type: 'star', priority: 'normal', durationMs: 1400 },
    { type: 'heart', priority: 'normal', durationMs: 1200 },
    { type: 'confetti', priority: 'normal', durationMs: 1500 },
    { type: 'sparkle', priority: 'normal', durationMs: 1400 }
  ],
  blocked: [
    { type: 'alert', priority: 'critical', persistent: true },
    { type: 'siren', priority: 'critical', persistent: true },
    { type: 'anger', priority: 'high', persistent: true },
    { type: 'tear', priority: 'high', persistent: true }
  ],
  extras: [
    { type: 'sparkle', priority: 'low', durationMs: 1200 },
    { type: 'music', priority: 'low', durationMs: 1200 }
  ]
};

const INTERACTION_EFFECTS: readonly TimEffectRequest[] = [
  { type: 'heart', priority: 'normal', durationMs: 1000 },
  { type: 'star', priority: 'normal', durationMs: 1100 },
  { type: 'sparkle', priority: 'normal', durationMs: 1000 },
  { type: 'music', priority: 'normal', durationMs: 1100 }
];

type SpriteClip = { id: string; frames: number[]; frameDurationsMs: number[]; label: string };
const SPRITE_CLIPS: Record<TimTaskSnapshot['status'], readonly SpriteClip[]> = {
  idle: [
    { id: 'idle-breathe', frames: [0, 1, 2, 3, 4, 5, 6, 7], frameDurationsMs: [520, 420, 360, 320, 300, 280, 260, 1600], label: '从休眠缓慢苏醒' },
    { id: 'idle-review', frames: [0, 1, 2, 4, 5], frameDurationsMs: [300, 160, 170, 180, 340], label: '轻微观察' }
  ],
  running: [
    { id: 'running-tablet', frames: [0, 1, 2, 3, 4, 5], frameDurationsMs: [180, 140, 120, 180, 140, 240], label: '平板专注处理' },
    { id: 'running-side-right', frames: [0, 1, 2, 3, 4, 5, 6, 7], frameDurationsMs: [160, 130, 120, 150, 140, 130, 160, 260], label: '向右侧向工作' },
    { id: 'running-side-left', frames: [0, 1, 2, 3, 4, 5, 6, 7], frameDurationsMs: [160, 130, 120, 150, 140, 130, 160, 260], label: '向左侧向工作' }
  ],
  needs_input: [
    { id: 'waiting-ask', frames: [0, 1, 2, 3, 4, 5], frameDurationsMs: [220, 140, 180, 150, 180, 260], label: '举手与等待确认' },
    { id: 'waiting-review', frames: [0, 1, 2, 3, 4, 5], frameDurationsMs: [240, 150, 170, 160, 170, 280], label: '期待回应' }
  ],
  ready: [
    { id: 'ready-review', frames: [0, 1, 2, 3, 4, 5], frameDurationsMs: [240, 140, 180, 150, 180, 280], label: '满意点头' },
    { id: 'ready-wave', frames: [0, 1, 2, 3], frameDurationsMs: [200, 150, 180, 300], label: '挥手庆祝' }
  ],
  blocked: [
    { id: 'blocked-failed', frames: [0, 1, 2, 3, 4, 5, 6, 7], frameDurationsMs: [220, 140, 140, 160, 160, 180, 200, 320], label: '低头与无助' },
    { id: 'blocked-review', frames: [0, 1, 2, 3, 4, 5], frameDurationsMs: [240, 150, 160, 150, 170, 300], label: '困惑复盘' }
  ],
  extras: [
    { id: 'extras-wave', frames: [0, 1, 2, 3], frameDurationsMs: [200, 150, 180, 300], label: '随机挥手' },
    { id: 'extras-jump', frames: [0, 1, 2, 3, 4], frameDurationsMs: [180, 140, 150, 140, 300], label: '轻跳一下' },
    { id: 'extras-look-a', frames: [0, 1, 2, 3, 4, 5, 6, 7], frameDurationsMs: [150, 130, 130, 140, 150, 140, 150, 260], label: '左右观察' },
    { id: 'extras-look-b', frames: [0, 1, 2, 3, 4, 5, 6, 7], frameDurationsMs: [150, 130, 130, 140, 150, 140, 150, 260], label: '回头观察' },
    { id: 'extras-waiting', frames: [0, 1, 2, 3, 4, 5], frameDurationsMs: [200, 150, 170, 150, 170, 300], label: '俏皮摊手' }
  ]
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char] ?? char));
}

export class TimAssistantElement extends HTMLElement {
  static get observedAttributes(): string[] { return ['effects', 'collapsed', 'compact', 'effects-base', 'random-interactions']; }

  readonly machine = new TimStateMachine();
  readonly effects = new TimEffectsController();
  #root: ShadowRoot;
  #unsubscribeState?: () => void;
  #unsubscribeEffects?: () => void;
  #mediaQuery?: MediaQueryList;
  #mediaListener?: (event: MediaQueryListEvent) => void;
  #extrasMinimumDurationMs = 0;
  #extrasPlaybackDurationMs = 0;
  #reducedExtrasTimer?: ReturnType<typeof setTimeout>;
  #spriteTimer?: ReturnType<typeof setTimeout>;
  #spriteFrame = 0;
  #spriteClip?: SpriteClip;
  #completedSpriteLoops = 0;
  #idleAwake = false;
  #idleWakeTimer?: ReturnType<typeof setTimeout>;
  #idleInteractionTimer?: ReturnType<typeof setTimeout>;
  #idleEffectClearTimer?: ReturnType<typeof setTimeout>;
  #automaticExtrasActive = false;
  #actionsBound = false;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: 'open' });
    this.#render();
  }

  attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null): void {
    if (name === 'effects' && this.isConnected) this.effects.setEnabled(newValue !== 'off');
    if (['collapsed', 'compact', 'effects-base'].includes(name) && this.isConnected) this.#render();
    if (name === 'random-interactions' && this.isConnected) {
      this.#clearIdleInteractionTimers();
      if (!this.randomInteractionsEnabled) {
        if (this.machine.getSnapshot().status === 'idle') this.effects.clear();
        if (this.#automaticExtrasActive && this.machine.getSnapshot().status === 'extras') this.restoreFromExtras();
        return;
      }
      this.#scheduleIdleInteraction();
    }
  }

  get randomInteractionsEnabled(): boolean { return this.getAttribute('random-interactions') !== 'off'; }

  connectedCallback(): void {
    this.#spriteClip = this.#pickClip(this.machine.getSnapshot().status);
    this.#unsubscribeState = this.machine.subscribe((change) => this.#onStateChange(change));
    this.#unsubscribeEffects = this.effects.subscribe(() => this.#render());
    this.#mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.#mediaListener = (event) => {
      this.effects.setReducedMotion(event.matches);
      clearTimeout(this.#spriteTimer);
      this.#spriteTimer = undefined;
      this.#clearIdleInteractionTimers();
      if (this.machine.getSnapshot().status === 'idle') this.effects.clear();
      if (!event.matches) this.#scheduleSpriteFrame();
      this.#scheduleIdleInteraction();
    };
    this.effects.setReducedMotion(this.#mediaQuery.matches);
    this.effects.setEnabled(this.getAttribute('effects') !== 'off');
    const initialEffect = this.#pickEffect(this.machine.getSnapshot().status);
    if (initialEffect) this.effects.show(initialEffect);
    this.#mediaQuery.addEventListener?.('change', this.#mediaListener);
    this.#bindActions();
    this.#scheduleSpriteFrame();
    this.#scheduleIdleInteraction();
    this.#render();
  }

  disconnectedCallback(): void {
    this.#unsubscribeState?.();
    this.#unsubscribeEffects?.();
    if (this.#mediaQuery && this.#mediaListener) this.#mediaQuery.removeEventListener?.('change', this.#mediaListener);
    if (this.#spriteTimer) clearTimeout(this.#spriteTimer);
    if (this.#idleWakeTimer) clearTimeout(this.#idleWakeTimer);
    if (this.#reducedExtrasTimer) clearTimeout(this.#reducedExtrasTimer);
    this.#clearIdleInteractionTimers();
    this.effects.clear();
  }

  startTask(input: { id: string; title: string; message?: string }): void {
    if (this.machine.getSnapshot().status === 'extras') {
      this.machine.restoreFromExtras();
    }
    this.machine.startTask(input);
  }
  setProgress(input: { id: string; progress: number; message?: string }): void { this.machine.setProgress(input); }
  setTaskMessage(input: { id: string; message: string }): void {
    const snapshot = this.machine.getSnapshot();
    this.machine.setProgress({ id: input.id, progress: snapshot.progress ?? 0, message: input.message });
  }
  requestInput(input: { id: string; question: string; options?: readonly string[] }): void { this.machine.requestInput(input); }
  submitInput(id: string, value: string): void { this.machine.submitInput(id, value); }
  completeTask(input: { id: string; summary: string }): void { this.machine.completeTask(input); }
  blockTask(input: { id: string; reason: string; retryable?: boolean }): void { this.machine.blockTask(input); }
  showExtras(input: { id?: string; variant?: string; durationMs?: number } = {}): void {
    this.#startExtras(input, false);
  }
  #startExtras(input: { id?: string; variant?: string; durationMs?: number }, automatic: boolean): void {
    this.#automaticExtrasActive = automatic;
    this.#extrasMinimumDurationMs = Math.max(0, input.durationMs ?? 0);
    this.machine.showExtras(input);
    if (this.#mediaQuery?.matches) {
      if (this.#reducedExtrasTimer) clearTimeout(this.#reducedExtrasTimer);
      this.#reducedExtrasTimer = setTimeout(() => {
        this.#reducedExtrasTimer = undefined;
        if (this.machine.getSnapshot().status === 'extras') this.restoreFromExtras();
      }, this.#extrasMinimumDurationMs);
    }
  }
  restoreFromExtras(): void { this.machine.restoreFromExtras(); }
  retryTask(id?: string): void { this.machine.retryTask(id); }
  reset(): void { this.machine.reset(); }
  showEffect(request: TimEffectRequest): string { return this.effects.show(request); }
  setEffectsEnabled(enabled: boolean): void { this.effects.setEnabled(enabled); }

  #onStateChange(change: TimStateChange): void {
    const statusChanged = change.previous.status !== change.current.status;
    if (statusChanged) {
      this.#clearIdleInteractionTimers();
      this.#completedSpriteLoops = 0;
      this.#idleAwake = false;
      this.#spriteClip = this.#pickClip(change.current.status);
      this.#spriteFrame = 0;
      this.#extrasPlaybackDurationMs = change.current.status === 'extras'
        ? completeSpriteLoopDuration(this.#spriteClip.frameDurationsMs, this.#extrasMinimumDurationMs)
        : 0;
      if (change.current.status !== 'extras') this.#extrasMinimumDurationMs = 0;
      if (change.current.status !== 'extras') this.#automaticExtrasActive = false;
      if (this.#spriteTimer) clearTimeout(this.#spriteTimer);
    }
    this.dispatchEvent(new CustomEvent('tim-state-changed', { detail: change, bubbles: true, composed: true }));
    this.effects.clear();
    const request = this.#pickEffect(change.current.status);
    if (request) this.effects.show(request);
    this.#render();
    if (statusChanged) this.#scheduleSpriteFrame();
    if (statusChanged) this.#scheduleIdleInteraction();
  }

  #bindActions(): void {
    if (this.#actionsBound) return;
    this.#actionsBound = true;
    this.#root.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const action = target.closest<HTMLElement>('[data-tim-action]')?.dataset.timAction;
      const state = this.machine.getSnapshot();
      if (target.closest<HTMLElement>('[data-tim-pet-interaction]')) this.#wakePet('click');
      if (action === 'cancel') this.dispatchEvent(new CustomEvent('tim-task-cancelled', { detail: state, bubbles: true, composed: true }));
      if (action === 'retry') { this.retryTask(state.id); this.dispatchEvent(new CustomEvent('tim-task-retry-requested', { detail: state, bubbles: true, composed: true })); }
      if (action === 'result') this.dispatchEvent(new CustomEvent('tim-result-opened', { detail: state, bubbles: true, composed: true }));
      if (action === 'reset') {
        this.reset();
        this.dispatchEvent(new CustomEvent('tim-task-reset', { detail: state, bubbles: true, composed: true }));
      }
      if (action === 'collapse') {
        const collapsed = !this.hasAttribute('collapsed');
        this.toggleAttribute('collapsed', collapsed);
        this.dispatchEvent(new CustomEvent('tim-panel-toggled', {
          detail: { collapsed }, bubbles: true, composed: true
        }));
      }
      if (action === 'restore-extras') this.restoreFromExtras();
    });
    this.#root.addEventListener('pointerover', (event) => {
      const pointerEvent = event as PointerEvent;
      const target = event.target as HTMLElement;
      const stage = target.closest<HTMLElement>('[data-tim-pet-interaction]');
      if (!stage || stage.contains(pointerEvent.relatedTarget as Node | null)) return;
      this.#wakePet('hover');
    });
    this.#root.addEventListener('pointerout', (event) => {
      const pointerEvent = event as PointerEvent;
      const target = event.target as HTMLElement;
      const stage = target.closest<HTMLElement>('[data-tim-pet-interaction]');
      if (!stage || stage.contains(pointerEvent.relatedTarget as Node | null)) return;
      if (this.#idleWakeTimer) { clearTimeout(this.#idleWakeTimer); this.#idleWakeTimer = undefined; }
      this.#sleepPet();
    });
    this.#root.addEventListener('keydown', (event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (!['Enter', ' '].includes(keyboardEvent.key)) return;
      const target = event.target as HTMLElement;
      if (!target.closest<HTMLElement>('[data-tim-pet-interaction]')) return;
      event.preventDefault();
      this.#wakePet('keyboard');
    });
    this.#root.addEventListener('submit', (event) => {
      const form = event.target as HTMLFormElement;
      if (!form.matches('[data-tim-input-form]')) return;
      event.preventDefault();
      const value = new FormData(form).get('value')?.toString().trim() ?? '';
      const state = this.machine.getSnapshot();
      if (!state.id || !value) return;
      this.submitInput(state.id, value);
      this.dispatchEvent(new CustomEvent('tim-input-submitted', { detail: { id: state.id, value }, bubbles: true, composed: true }));
    });
  }

  #render(): void {
    const activeField = this.#root.activeElement as HTMLInputElement | HTMLSelectElement | null;
    const activeFieldName = activeField?.name;
    const activeFieldValue = activeField?.value;
    const state = this.machine.getSnapshot();
    const effects = this.effects.getSnapshot();
    const effectsMarkup = effects.map((effect) => `<img class="effect effect-${effect.priority}" data-effect-type="${escapeHtml(effect.type)}" src="${escapeHtml(this.#effectUrl(effect.type))}" alt="" aria-hidden="true" />`).join('');
    const inputControl = state.inputOptions?.length
      ? `<select name="value" required autofocus>${state.inputOptions.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('')}</select>`
      : '<input name="value" required autofocus />';
    const inputMarkup = state.status === 'needs_input' ? `<form data-tim-input-form class="input-form"><label>${escapeHtml(state.inputQuestion ?? '请补充信息')}${inputControl}</label><button class="primary" type="submit">提交</button></form>` : '';
    const resultMarkup = state.status === 'ready' ? `<button data-tim-action="result" class="primary">查看结果</button>` : '';
    const retryMarkup = state.status === 'blocked' && state.retryable ? `<button data-tim-action="retry" class="primary">重试</button>` : '';
    const resetMarkup = ['ready', 'blocked'].includes(state.status) ? '<button data-tim-action="reset">结束并新建</button>' : '';
    const cancelMarkup = ['running', 'needs_input'].includes(state.status) ? '<button data-tim-action="cancel">取消任务</button>' : '';
    const extrasMarkup = state.status === 'extras' ? `<button data-tim-action="restore-extras" class="primary">返回任务状态</button>` : '';
    const spriteStatus = state.status;
    const compact = this.hasAttribute('compact');
    const collapsedMarkup = this.hasAttribute('collapsed') ? ' collapsed' : '';
    if (compact) {
      this.#root.innerHTML = `<style>${this.#styles()}</style><section class="panel compact${collapsedMarkup}" aria-label="Tim AI 助手" data-status="${state.status}">
        <div class="pet-stage" data-tim-pet-interaction role="button" tabindex="0" aria-label="和 Tim 互动"><div class="pet-sprite-wrapper"><img class="pet-sprite" src="${escapeHtml(this.#spriteUrl(spriteStatus))}" alt="半身 Tim 角色" /><div class="effects">${effectsMarkup}</div></div></div>
        <span class="sr-only" aria-live="polite">${escapeHtml(`${STATUS_LABEL[state.status]}：${state.message ?? state.blockReason ?? state.resultSummary ?? STATUS_MESSAGE[state.status]}`)}</span>
      </section>`;
      return;
    }
    this.#root.innerHTML = `<style>${this.#styles()}</style><section class="panel${collapsedMarkup}" aria-label="Tim AI 助手" data-status="${state.status}">
      <header><div><span class="status-label">${STATUS_LABEL[state.status]}</span><h2>${escapeHtml(state.title ?? 'Tim Assistant')}</h2></div><button class="icon" data-tim-action="collapse" aria-label="收起助手">−</button></header>
      <div class="body"><div class="pet-stage" data-tim-pet-interaction role="button" tabindex="0" aria-label="和 Tim 互动"><div class="pet-sprite-wrapper"><img class="pet-sprite" src="${escapeHtml(this.#spriteUrl(spriteStatus))}" alt="半身 Tim 角色" /><div class="effects">${effectsMarkup}</div></div></div>
      <div class="content"><div class="bubble" aria-live="polite"><strong>${STATUS_MESSAGE[state.status]}</strong><span>${escapeHtml(state.message ?? state.blockReason ?? state.resultSummary ?? '')}</span></div>
      ${state.progress !== undefined && state.status === 'running' ? `<div class="progress"><span style="width:${state.progress}%"></span></div><small>${state.progress}%</small>` : ''}
      ${inputMarkup}${state.status === 'blocked' ? `<div class="reason" role="alert">${escapeHtml(state.blockReason ?? '')}</div>` : ''}
      <div class="actions">${resultMarkup}${retryMarkup}${resetMarkup}${extrasMarkup}${cancelMarkup}</div></div></div></section>`;
    if (activeFieldName === 'value') {
      const nextField = this.#root.querySelector<HTMLInputElement | HTMLSelectElement>('[name="value"]');
      if (nextField) {
        if (activeFieldValue !== undefined) nextField.value = activeFieldValue;
        nextField.focus();
      }
    }
  }

  #pickClip(status: TimTaskSnapshot['status']): SpriteClip {
    const clips = SPRITE_CLIPS[status];
    if (status === 'idle') return clips[0];
    return clips[Math.floor(Math.random() * clips.length)] ?? clips[0];
  }

  #pickDifferentClip(status: TimTaskSnapshot['status']): SpriteClip {
    const clips = SPRITE_CLIPS[status];
    const currentIndex = Math.max(0, clips.indexOf(this.#spriteClip as SpriteClip));
    return clips[pickDifferentIndex(currentIndex, clips.length)] ?? clips[0];
  }

  #pickEffect(status: TimTaskSnapshot['status']): TimEffectRequest | undefined {
    const effects = EFFECT_POOLS[status];
    return effects[Math.floor(Math.random() * effects.length)];
  }

  #frameCount(status: TimTaskSnapshot['status']): number {
    return this.#spriteClip?.frames.length ?? SPRITE_CLIPS[status][0]?.frames.length ?? 1;
  }

  #frameDuration(status: TimTaskSnapshot['status'], frame: number): number {
    const clip = this.#spriteClip ?? SPRITE_CLIPS[status][0];
    return clip?.frameDurationsMs[frame % clip.frameDurationsMs.length] ?? 160;
  }

  #scheduleSpriteFrame(): void {
    if (!this.isConnected) return;
    const status = this.machine.getSnapshot().status;
    const reduced = this.#mediaQuery?.matches ?? false;
    if (reduced || !shouldAnimateTimStatus(status, this.#idleAwake)) return;
    if (status === 'idle' && this.#spriteFrame >= this.#frameCount(status) - 1) return;
    if (this.#spriteTimer) { clearTimeout(this.#spriteTimer); this.#spriteTimer = undefined; }
    this.#spriteTimer = setTimeout(() => {
      const currentStatus = this.machine.getSnapshot().status;
      this.#spriteFrame += 1;
      if (this.#spriteFrame >= this.#frameCount(currentStatus)) {
        this.#spriteFrame = 0;
        this.#completedSpriteLoops += 1;
        if (currentStatus === 'extras') {
          const loopDuration = completeSpriteLoopDuration(
            (this.#spriteClip ?? SPRITE_CLIPS.extras[0]).frameDurationsMs
          );
          if (loopDuration * this.#completedSpriteLoops >= this.#extrasPlaybackDurationMs) {
            this.restoreFromExtras();
            return;
          }
        }
        if (shouldRotateTimClip(currentStatus, this.#completedSpriteLoops)) {
          this.#spriteClip = this.#pickDifferentClip(currentStatus);
          const effect = this.#pickEffect(currentStatus);
          if (effect && !effect.persistent) this.effects.show(effect);
        }
      }
      this.effects.tick();
      this.#updateSpriteElement();
      this.#scheduleSpriteFrame();
    }, this.#frameDuration(status, this.#spriteFrame));
  }

  #scheduleIdleInteraction(): void {
    this.#clearIdleInteractionTimers();
    const status = this.machine.getSnapshot().status;
    if (!shouldScheduleIdleInteraction(
      status,
      this.#mediaQuery?.matches ?? false,
      this.isConnected,
      this.#idleAwake,
      this.randomInteractionsEnabled
    )) return;
    this.#idleInteractionTimer = setTimeout(() => {
      this.#idleInteractionTimer = undefined;
      if (!shouldScheduleIdleInteraction(
        this.machine.getSnapshot().status,
        this.#mediaQuery?.matches ?? false,
        this.isConnected,
        this.#idleAwake,
        this.randomInteractionsEnabled
      )) return;
      if (pickIdleRandomInteraction() === 'extras') {
        this.#startExtras({ variant: '空闲随机互动', durationMs: 2500 }, true);
        return;
      }
      const effectId = this.effects.show({ type: 'sleep', priority: 'low', durationMs: TIM_IDLE_SLEEP_DURATION_MS });
      if (!effectId) {
        this.#scheduleIdleInteraction();
        return;
      }
      this.#idleEffectClearTimer = setTimeout(() => {
        this.#idleEffectClearTimer = undefined;
        this.effects.hide(effectId);
        this.#scheduleIdleInteraction();
      }, TIM_IDLE_SLEEP_DURATION_MS);
    }, randomIdleInteractionDelay());
  }

  #clearIdleInteractionTimers(): void {
    if (this.#idleInteractionTimer !== undefined) clearTimeout(this.#idleInteractionTimer);
    if (this.#idleEffectClearTimer !== undefined) clearTimeout(this.#idleEffectClearTimer);
    this.#idleInteractionTimer = undefined;
    this.#idleEffectClearTimer = undefined;
  }

  #wakePet(source: 'hover' | 'click' | 'keyboard'): void {
    const status = this.machine.getSnapshot().status;
    const effect = INTERACTION_EFFECTS[Math.floor(Math.random() * INTERACTION_EFFECTS.length)];
    if (status === 'idle') {
      this.#clearIdleInteractionTimers();
      this.effects.clear();
      if (this.#mediaQuery?.matches) return;
    }
    if (effect) this.effects.show(effect);
    if (status !== 'idle') return;
    this.#idleAwake = true;
    this.#spriteFrame = 0;
    if (this.#spriteTimer) { clearTimeout(this.#spriteTimer); this.#spriteTimer = undefined; }
    this.#scheduleSpriteFrame();
    if (this.#idleWakeTimer) clearTimeout(this.#idleWakeTimer);
    if (source !== 'hover') {
      this.#idleWakeTimer = setTimeout(() => this.#sleepPet(), 3200);
    }
  }

  #sleepPet(): void {
    if (this.machine.getSnapshot().status !== 'idle') return;
    this.#idleAwake = false;
    if (this.#spriteTimer) { clearTimeout(this.#spriteTimer); this.#spriteTimer = undefined; }
    this.#spriteFrame = 0;
    this.#updateSpriteElement();
    this.effects.clear();
    this.#scheduleIdleInteraction();
  }

  #spriteStatus(status: TimTaskSnapshot['status']): string {
    return ({ needs_input: 'needs-input', ready: 'ready', extras: 'extras' } as Record<string, string>)[status] ?? status;
  }

  #spriteUrl(status: TimTaskSnapshot['status']): string {
    const base = this.getAttribute('asset-base') ?? '/packages/web-component/assets/tim-six-state';
    const clip = this.#spriteClip ?? SPRITE_CLIPS[status][0];
    const frameIndex = this.#spriteFrame % (clip?.frames.length ?? 1);
    const frame = String(clip?.frames[frameIndex] ?? 0).padStart(2, '0');
    const clipPath = clip?.id === 'running-side-right' ? 'shared/running-right'
      : clip?.id === 'running-side-left' ? 'shared/running-left'
      : clip?.id === 'extras-look-a' ? 'shared/look-000-157'
      : clip?.id === 'extras-look-b' ? 'shared/look-180-337'
      : clip?.id === 'extras-wave' || clip?.id === 'ready-wave' ? 'shared/waving'
      : clip?.id === 'extras-jump' ? 'shared/jumping'
      : clip?.id === 'extras-waiting' ? 'shared/waiting'
      : clip?.id === 'idle-breathe' ? 'shared/idle'
      : clip?.id === 'running-tablet' ? this.#spriteStatus(status)
      : clip?.id === 'waiting-ask' || clip?.id === 'waiting-review' ? 'shared/waiting'
      : clip?.id === 'ready-review' ? 'shared/review'
      : clip?.id === 'blocked-failed' ? 'shared/failed'
      : clip?.id === 'idle-review' || clip?.id === 'blocked-review' ? 'shared/review'
      : this.#spriteStatus(status);
    return `${base.replace(/\/$/, '')}/${clipPath}/${frame}.png`;
  }

  #updateSpriteElement(): void {
    const sprite = this.#root.querySelector<HTMLImageElement>('.pet-sprite');
    if (sprite) sprite.src = this.#spriteUrl(this.machine.getSnapshot().status);
  }

  #effectUrl(type: TimEffectRequest['type']): string {
    const base = this.getAttribute('effects-base') ?? '/assets/effects/generated-v2';
    return timEffectAssetUrl(type, base);
  }

  #styles(): string {
    return `:host{display:block;color:#eaf4ff;font-family:Segoe UI,system-ui,sans-serif}.panel{box-sizing:border-box;width:min(560px,100%);border:1px solid #31527d;border-radius:20px;background:#0b1b32;box-shadow:0 18px 50px #0005;padding:18px}.panel[data-status="blocked"]{border-color:#a23f55}.panel.collapsed .body{display:none}.panel.compact{width:100%;min-width:0;border:0;border-radius:0;background:transparent;box-shadow:none;padding:0}.panel.compact.collapsed{display:none}.panel.compact .pet-stage{height:118px;min-height:118px}.panel.compact .pet-sprite{width:108px;height:117px;object-fit:contain}header{display:flex;justify-content:space-between;align-items:start}h2{margin:10px 0 0;font-size:18px}.status-label{display:inline-block;padding:6px 10px;border-radius:8px;background:#2389ff;font-weight:700}.icon,button{border:0;border-radius:9px;padding:9px 12px;color:#fff;background:#234d7c;cursor:pointer}.primary{background:#2389ff}.body{display:grid;grid-template-columns:180px 1fr;gap:18px;margin-top:18px}.pet-stage{position:relative;display:grid;place-items:center;min-height:208px;border-radius:18px;cursor:pointer;outline:none}.pet-stage:focus-visible{box-shadow:0 0 0 2px #7bb7ff66}.pet-sprite{width:192px;height:208px;object-fit:contain;image-rendering:auto;transition:filter 160ms ease}.pet-sprite-wrapper{position:relative;display:inline-block;line-height:0}.pet-stage:hover .pet-sprite,.pet-stage:focus-visible .pet-sprite{filter:brightness(1.06)}.effects{position:absolute;inset:0;pointer-events:none;overflow:visible}.effect{position:absolute;width:48px;height:48px;object-fit:contain;filter:drop-shadow(0 5px 9px #0006);animation:tim-effect-pop 260ms ease-out both}.effect-critical{width:56px;height:56px}.effect-high{width:52px;height:52px}.effect-low{opacity:.72}.effect:nth-child(1){top:calc(50px - var(--tim-effect-spread, 0px));left:calc(-14px - var(--tim-effect-spread, 0px))}.effect:nth-child(2){top:calc(-10px - var(--tim-effect-spread, 0px));right:calc(-10px - var(--tim-effect-spread, 0px))}.effect:nth-child(3){bottom:calc(20px - var(--tim-effect-spread, 0px));right:calc(-10px - var(--tim-effect-spread, 0px))}.compact .effect{width:36px;height:36px}.compact .effect-critical{width:42px;height:42px}.compact .effect-high{width:39px;height:39px}.compact .effect:nth-child(1){top:calc(28px - var(--tim-effect-spread, 0px));left:calc(-10px - var(--tim-effect-spread, 0px))}.compact .effect:nth-child(2){top:calc(-6px - var(--tim-effect-spread, 0px));right:calc(-6px - var(--tim-effect-spread, 0px))}.compact .effect:nth-child(3){bottom:calc(10px - var(--tim-effect-spread, 0px));right:calc(-6px - var(--tim-effect-spread, 0px))}.bubble,.reason,.input-form{border:1px solid #31527d;border-radius:13px;padding:12px;background:#102541}.bubble strong{display:block;margin-bottom:5px}.bubble span{color:#a9bfd8}.progress{height:8px;background:#17345b;border-radius:99px;margin-top:14px;overflow:hidden}.progress span{display:block;height:100%;background:#45c982}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.input-form{margin-top:12px}.input-form label{display:grid;gap:7px;color:#c8dbef}.input-form input,.input-form select{padding:9px;border-radius:8px;border:1px solid #587da7;background:#09182d;color:#fff}.reason{margin-top:12px;color:#ffbec2}small{color:#9fb7d2}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@keyframes tim-effect-pop{from{opacity:0;transform:translateY(5px) scale(.78)}to{opacity:1;transform:translateY(0) scale(1)}}@media(max-width:560px){.body{grid-template-columns:1fr}}@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}`;
  }
}

export function defineTimAssistant(tagName = 'tim-assistant'): void {
  if (typeof customElements !== 'undefined' && !customElements.get(tagName)) customElements.define(tagName, TimAssistantElement);
}
