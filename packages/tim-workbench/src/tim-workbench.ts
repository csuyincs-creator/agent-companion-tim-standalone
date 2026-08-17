import { MAX_HISTORY_ITEMS, type WorkbenchHistoryItem, type WorkbenchProvider, type CodexRunOptions } from './contracts.js';
import { shouldSubmitComposer } from './composer-input.js';
import { READY_TO_IDLE_DELAY_MS, WORKBENCH_STATE_LABELS, type WorkbenchVisualState } from './workbench-lifecycle.js';
import { parseSafeInlineMarkdown } from './safe-markdown.js';
import { DEFAULT_WORKBENCH_APPEARANCE, normalizeWorkbenchAppearance, workbenchAppearanceProperties } from './appearance.js';
import { TIM_WORKBENCH_STYLES } from './styles.js';
import { WORKBENCH_HEADER_ACTIONS, dispatchWorkbenchHostRequest } from './workbench-host-events.js';
import { TimWorkbenchController, WorkbenchBusyError, WorkbenchRequestError, type TimWorkbenchPet } from './workbench-controller.js';
import { defineTimAssistant, type TimAssistantElement } from '../../web-component/src/index.js';

const RANDOM_INTERACTIONS_STORAGE_KEY = 'tim-random-interactions';

function element<K extends keyof HTMLElementTagNameMap>(name: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(name);
  if (className) node.className = className;
  return node;
}

export class TimWorkbenchElement extends HTMLElement {
  static get observedAttributes(): string[] { return ['background-opacity', 'background-brightness']; }

  readonly #root: ShadowRoot;
  #controller?: TimWorkbenchController;
  #history: WorkbenchHistoryItem[] = [];
  #lastMessage = '';
  #awaitingFollowup = false;
  #retrying = false;
  #conversationGeneration = 0;
  #idleTimer?: ReturnType<typeof setTimeout>;
  #connected = false;
  #tim?: TimAssistantElement;
  #thread?: HTMLDivElement;
  #empty?: HTMLDivElement;
  #form?: HTMLFormElement;
  #input?: HTMLTextAreaElement;
  #send?: HTMLButtonElement;
  #stop?: HTMLButtonElement;
  #status?: HTMLDivElement;
  #retry?: HTMLButtonElement;
  #shell?: HTMLElement;
  #stateBadge?: HTMLSpanElement;
  #modeToggle?: HTMLButtonElement;
  #randomInteractionsToggle?: HTMLButtonElement;
  #randomInteractionsEnabled = true;
  #currentProvider: WorkbenchProvider = 'deepseek';

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    if (this.#connected) return;
    this.#connected = true;
    this.#render();
  }

  disconnectedCallback(): void {
    this.#cancelIdleReturn();
    this.#controller?.stop();
    this.#connected = false;
  }

  attributeChangedCallback(name: string, previous: string | null, current: string | null): void {
    if (previous === current || !['background-opacity', 'background-brightness'].includes(name)) return;
    this.#applyAppearance();
  }

  #render(): void {
    defineTimAssistant();
    const style = element('style');
    style.textContent = TIM_WORKBENCH_STYLES;
    const shell = element('section', 'shell');
    this.#shell = shell;
    shell.setAttribute('aria-label', 'Tim AI 工作台');

    const head = element('header', 'head');
    const titleLine = element('div', 'title-line');
    const title = element('div', 'title');
    title.textContent = 'Tim 工作台';
    this.#stateBadge = element('span', 'state-badge');
    this.#setVisualState('idle');
    titleLine.append(title, this.#stateBadge);
    const headActions = element('div', 'head-actions');
    for (const action of WORKBENCH_HEADER_ACTIONS) {
      const button = element('button', 'head-action');
      button.type = 'button';
      button.textContent = action.label;
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-haspopup', 'dialog');
      button.setAttribute('aria-controls', action.controls);
      button.addEventListener('click', () => dispatchWorkbenchHostRequest(button, action.eventType));
      headActions.append(button);
    }
    this.#randomInteractionsEnabled = this.#loadRandomInteractionsPreference();
    this.#randomInteractionsToggle = element('button', 'head-action random-interactions-toggle');
    this.#randomInteractionsToggle.type = 'button';
    this.#randomInteractionsToggle.setAttribute('role', 'switch');
    this.#randomInteractionsToggle.addEventListener('click', () => {
      this.#randomInteractionsEnabled = !this.#randomInteractionsEnabled;
      this.#persistRandomInteractionsPreference();
      this.#applyRandomInteractionsPreference();
    });
    headActions.append(this.#randomInteractionsToggle);
    const clear = element('button', 'head-action head-clear');
    clear.type = 'button';
    clear.textContent = '清空';
    clear.title = '清空当前对话';
    clear.setAttribute('aria-label', '清空当前对话');
    clear.addEventListener('click', () => this.#clearConversation());
    headActions.append(clear);
    head.append(titleLine, headActions);

    const stage = element('div', 'stage');
    this.#tim = document.createElement('tim-assistant') as TimAssistantElement;
    this.#tim.setAttribute('compact', '');
    this.#tim.setAttribute('aria-label', 'Tim 当前状态');
    this.#tim.addEventListener('tim-state-changed', (event) => {
      const status = (event as CustomEvent<{ current?: { status?: WorkbenchVisualState } }>).detail.current?.status;
      if (status && status in WORKBENCH_STATE_LABELS) this.#setVisualState(status);
    });
    const assetBase = this.getAttribute('asset-base');
    const effectsBase = this.getAttribute('effects-base');
    if (assetBase) this.#tim.setAttribute('asset-base', assetBase);
    if (effectsBase) this.#tim.setAttribute('effects-base', effectsBase);
    this.#applyRandomInteractionsPreference();

    this.#thread = element('div', 'thread');
    this.#thread.setAttribute('role', 'log');
    this.#thread.setAttribute('aria-live', 'polite');
    this.#empty = element('div', 'empty');
    this.#empty.textContent = '直接告诉 Tim 你想聊什么，或需要它帮你完成什么。';
    this.#thread.append(this.#empty);
    stage.append(this.#tim, this.#thread);

    this.#form = element('form', 'composer');
    this.#status = element('div', 'status');
    this.#status.setAttribute('role', 'status');
    this.#retry = element('button', 'retry');
    this.#retry.type = 'button';
    this.#retry.textContent = '重试';
    this.#retry.hidden = true;
    this.#retry.addEventListener('click', () => {
      if (!this.#lastMessage || this.#controller?.isRunning) return;
      this.#retrying = true;
      void this.#submit(this.#lastMessage);
    });
    this.#status.append(this.#retry);

    const composerSurface = element('div', 'composer-surface');
    const label = element('label', 'sr-only');
    label.htmlFor = 'tim-workbench-input';
    label.textContent = '给 Tim 的消息';
    this.#input = element('textarea');
    this.#input.id = 'tim-workbench-input';
    this.#input.name = 'message';
    this.#input.maxLength = 4000;
    this.#input.rows = 4;
    this.#input.placeholder = '给 Tim 发消息…';
    this.#input.required = true;
    const composerActions = element('div', 'composer-actions');
    this.#modeToggle = element('button', 'mode-toggle');
    this.#modeToggle.type = 'button';
    this.#modeToggle.title = '切换 AI 模式';
    this.#modeToggle.setAttribute('aria-label', '切换 AI 模式');
    this.#updateModeToggle();
    this.#modeToggle.addEventListener('click', () => {
      this.#currentProvider = this.#currentProvider === 'deepseek' ? 'codex' : 'deepseek';
      this.#updateModeToggle();
      this.#setStatus(this.#currentProvider === 'codex' ? '已切换到本地 AI 助手（Codex）' : '已切换到对话模式（DeepSeek）');
    });
    const actionSpacer = element('span', 'composer-spacer');
    this.#send = element('button', 'composer-submit');
    this.#send.type = 'submit';
    const sendIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    sendIcon.setAttribute('viewBox', '0 0 24 24');
    sendIcon.setAttribute('aria-hidden', 'true');
    const sendPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    sendPath.setAttribute('d', 'M12 19V5m0 0-5.5 5.5M12 5l5.5 5.5');
    sendIcon.append(sendPath);
    this.#send.append(sendIcon);
    this.#send.title = '发送';
    this.#send.setAttribute('aria-label', '发送');
    this.#stop = element('button', 'composer-stop');
    this.#stop.type = 'button';
    this.#stop.textContent = '■';
    this.#stop.title = '停止生成';
    this.#stop.setAttribute('aria-label', '停止生成');
    this.#stop.hidden = true;
    this.#stop.addEventListener('click', () => this.#controller?.stop());
    composerActions.append(this.#modeToggle, actionSpacer, this.#send, this.#stop);
    composerSurface.append(label, this.#input, composerActions);
    this.#form.append(this.#status, composerSurface);
    this.#form.addEventListener('submit', (event) => {
      event.preventDefault();
      const message = this.#input?.value.trim() ?? '';
      if (message) void this.#submit(message);
    });
    this.#input.addEventListener('keydown', (event) => {
      if (!shouldSubmitComposer(event)) return;
      event.preventDefault();
      this.#form?.requestSubmit();
    });

    shell.append(head, stage, this.#form);
    this.#root.replaceChildren(style, shell);
    this.#controller = new TimWorkbenchController({
      tim: this.#tim as unknown as TimWorkbenchPet,
      endpoint: this.getAttribute('endpoint') ?? '/api/ai/run'
    });
    this.#applyAppearance();
  }

  #loadRandomInteractionsPreference(): boolean {
    try { return localStorage.getItem(RANDOM_INTERACTIONS_STORAGE_KEY) !== 'off'; }
    catch { return true; }
  }

  #persistRandomInteractionsPreference(): void {
    try { localStorage.setItem(RANDOM_INTERACTIONS_STORAGE_KEY, this.#randomInteractionsEnabled ? 'on' : 'off'); }
    catch { /* Preference persistence is optional. */ }
  }

  #applyRandomInteractionsPreference(): void {
    const enabled = this.#randomInteractionsEnabled;
    this.#randomInteractionsToggle?.setAttribute('aria-checked', String(enabled));
    this.#randomInteractionsToggle?.setAttribute('aria-label', `随机互动：已${enabled ? '开启' : '关闭'}`);
    if (this.#randomInteractionsToggle) {
      this.#randomInteractionsToggle.dataset.enabled = String(enabled);
      this.#randomInteractionsToggle.textContent = `互动 ${enabled ? '开' : '关'}`;
      this.#randomInteractionsToggle.title = enabled ? '关闭自动随机互动' : '开启自动随机互动';
    }
    if (this.#tim) {
      if (enabled) this.#tim.removeAttribute('random-interactions');
      else this.#tim.setAttribute('random-interactions', 'off');
    }
  }

  #applyAppearance(): void {
    if (!this.#shell) return;
    const rawOpacityAttribute = this.getAttribute('background-opacity');
    const rawBrightnessAttribute = this.getAttribute('background-brightness');
    const opacityAttribute = rawOpacityAttribute?.trim() ? rawOpacityAttribute : null;
    const brightnessAttribute = rawBrightnessAttribute?.trim() ? rawBrightnessAttribute : null;
    const appearance = normalizeWorkbenchAppearance({
      opacity: opacityAttribute === null ? DEFAULT_WORKBENCH_APPEARANCE.opacity : Number(opacityAttribute),
      brightness: brightnessAttribute === null ? DEFAULT_WORKBENCH_APPEARANCE.brightness : Number(brightnessAttribute)
    });
    const properties = workbenchAppearanceProperties(appearance);
    if (opacityAttribute === null) {
      this.#shell.style.removeProperty('--tim-workbench-surface-opacity');
      this.#shell.style.removeProperty('--tim-workbench-surface-opacity-2');
    } else {
      this.#shell.style.setProperty('--tim-workbench-surface-opacity', properties['--tim-workbench-surface-opacity']);
      // The second panel keeps the host theme's depth ratio after a deliberate local adjustment.
      this.#shell.style.setProperty('--tim-workbench-surface-opacity-2', String(Math.min(.99, appearance.opacity + .08)));
    }
    if (brightnessAttribute === null) {
      this.#shell.style.removeProperty('--tim-workbench-surface-brightness');
    } else {
      this.#shell.style.setProperty('--tim-workbench-surface-brightness', properties['--tim-workbench-surface-brightness']);
    }
  }

  async #submit(message: string): Promise<void> {
    if (!this.#controller || this.#controller.isRunning) return;
    this.#cancelIdleReturn();
    if (this.#awaitingFollowup) {
      this.#tim?.reset();
      this.#awaitingFollowup = false;
    }
    this.#lastMessage = message;
    const generation = this.#conversationGeneration;
    this.#retry?.toggleAttribute('hidden', true);
    let assistantText = '';
    let assistant: HTMLDivElement;
    if (this.#retrying) {
      this.#retrying = false;
      const last = this.#thread?.lastElementChild as HTMLDivElement | undefined;
      if (last) {
        last.textContent = '';
        assistant = last;
      } else {
        assistant = this.#appendMessage('assistant', '');
      }
    } else {
      this.#appendMessage('user', message);
      assistant = this.#appendMessage('assistant', '');
    }
    this.#input!.value = '';
    this.#setStatus(this.#currentProvider === 'codex' ? 'Codex 正在处理…' : 'Tim 正在处理…');
    let pendingQuestion = '';
    const codexOptions: CodexRunOptions | undefined = undefined;
    try {
      const result = await this.#controller.run({
        conversationId: 'local-workbench',
        message,
        history: this.#history.slice(-MAX_HISTORY_ITEMS),
        provider: this.#currentProvider,
        codex: codexOptions
      }, {
        onDelta: (delta) => {
          if (generation !== this.#conversationGeneration) return;
          assistantText += delta;
          this.#renderAssistantText(assistant, assistantText);
          this.#thread?.scrollTo({ top: this.#thread.scrollHeight });
        },
        onNeedsInput: (question) => {
          if (generation !== this.#conversationGeneration) return;
          pendingQuestion = question;
          this.#setVisualState('needs_input');
          this.#setStatus(question);
        },
        onToolStart: (tool, _detail) => {
          if (generation !== this.#conversationGeneration) return;
          if (tool === 'command_execution') {
            this.#tim?.showEffect({ type: 'idea', priority: 'normal', durationMs: 1800 });
          } else if (tool === 'file_change') {
            this.#tim?.showEffect({ type: 'sparkle', priority: 'normal', durationMs: 1600 });
          } else if (tool === 'web_search') {
            this.#tim?.showEffect({ type: 'confusion', priority: 'normal', durationMs: 1600 });
          }
        },
        onStatus: (status) => {
          if (generation !== this.#conversationGeneration) return;
          this.#setStatus(status);
        },
        onProgress: (progress) => {
          if (generation !== this.#conversationGeneration) return;
          if (progress >= 30 && progress < 50) {
            this.#tim?.showEffect({ type: 'confusion', priority: 'low', durationMs: 1200 });
          }
        }
      });
      if (generation !== this.#conversationGeneration) return;
      if (result.outcome === 'awaiting_input') {
        if (!assistantText) {
          assistantText = '需要你确认或补充信息后才能继续。';
          this.#renderAssistantText(assistant, assistantText);
        }
        if (!this.#retrying) {
          this.#history.push({ role: 'user', content: message });
        }
        this.#history.push({ role: 'assistant', content: pendingQuestion || assistantText });
        this.#history = this.#history.slice(-MAX_HISTORY_ITEMS);
        this.#awaitingFollowup = true;
        this.#setVisualState('needs_input');
        this.#setStatus('等待你的确认/补充');
      } else {
        if (!this.#retrying) {
          this.#history.push({ role: 'user', content: message });
        }
        this.#history.push({ role: 'assistant', content: result.text });
        this.#history = this.#history.slice(-MAX_HISTORY_ITEMS);
        this.#setVisualState('ready');
        this.#setStatus('本轮已完成');
        this.#scheduleIdleReturn();
      }
    } catch (error) {
      if (generation !== this.#conversationGeneration) return;
      if (error instanceof DOMException && error.name === 'AbortError') {
        this.#renderAssistantText(assistant, '已停止本轮处理。');
        this.#setVisualState('idle');
        this.#setStatus('已停止');
      } else {
        const messageText = error instanceof Error ? error.message : 'AI 请求失败';
        this.#renderAssistantText(assistant, `暂时无法完成：${messageText}`);
        assistant.classList.add('message-error');
        this.#setVisualState('blocked');
        const retryable = !(error instanceof WorkbenchRequestError) || error.retryable;
        const configurationRequired = !retryable && /尚未配置|API key/u.test(messageText);
        this.#setStatus(retryable
          ? '请求失败，可重试'
          : configurationRequired
            ? '请打开 AI 设置完成配置'
            : '请求未发送，请检查输入或设置');
        this.#retry?.toggleAttribute('hidden', !retryable);
      }
      if (error instanceof WorkbenchBusyError || error instanceof WorkbenchRequestError) {
        // Known request errors are already reflected by Tim and the retry control.
      }
    } finally {
      if (generation === this.#conversationGeneration) this.#setRunning(false);
    }
  }

  #clearConversation(): void {
    this.#cancelIdleReturn();
    this.#conversationGeneration += 1;
    this.#controller?.reset();
    this.#history = [];
    this.#lastMessage = '';
    this.#awaitingFollowup = false;
    this.#retry?.toggleAttribute('hidden', true);
    if (this.#input) {
      this.#input.value = '';
      this.#input.disabled = false;
    }
    this.#setRunning(false);
    this.#setVisualState('idle');
    this.#setStatus('');
    this.#empty = element('div', 'empty');
    this.#empty.textContent = '直接告诉 Tim 你想聊什么，或需要它帮你完成什么。';
    this.#thread?.replaceChildren(this.#empty);
    this.#input?.focus();
  }

  #appendMessage(role: 'user' | 'assistant', text: string): HTMLDivElement {
    this.#empty?.remove();
    const message = element('div', `message message-${role}`);
    message.textContent = text;
    this.#thread?.append(message);
    this.#thread?.scrollTo({ top: this.#thread.scrollHeight });
    return message;
  }

  #renderAssistantText(target: HTMLDivElement, text: string): void {
    const nodes: Node[] = [];
    for (const token of parseSafeInlineMarkdown(text)) {
      if (token.kind === 'strong') {
        const strong = element('strong');
        strong.textContent = token.value;
        nodes.push(strong);
      } else {
        nodes.push(document.createTextNode(token.value));
      }
    }
    target.replaceChildren(...nodes);
  }

  #setRunning(running: boolean): void {
    if (this.#input) this.#input.disabled = running;
    if (this.#send) this.#send.hidden = running;
    if (this.#stop) this.#stop.hidden = !running;
  }

  #setStatus(value: string): void {
    if (!this.#status) return;
    const retry = this.#retry;
    this.#status.replaceChildren(document.createTextNode(value));
    if (retry) this.#status.append(retry);
  }

  #setVisualState(state: WorkbenchVisualState): void {
    if (!this.#stateBadge) return;
    this.#stateBadge.dataset.state = state;
    this.#stateBadge.textContent = WORKBENCH_STATE_LABELS[state];
  }

  #updateModeToggle(): void {
    if (!this.#modeToggle) return;
    this.#modeToggle.dataset.provider = this.#currentProvider;
    this.#modeToggle.textContent = this.#currentProvider === 'codex' ? '本地 AI 助手' : '对话模式';
  }

  #scheduleIdleReturn(): void {
    this.#cancelIdleReturn();
    this.#idleTimer = setTimeout(() => {
      this.#idleTimer = undefined;
      if (!this.#connected || this.#controller?.isRunning || this.#awaitingFollowup) return;
      this.#tim?.reset();
      this.#setVisualState('idle');
      this.#setStatus('');
    }, READY_TO_IDLE_DELAY_MS);
  }

  #cancelIdleReturn(): void {
    if (this.#idleTimer === undefined) return;
    clearTimeout(this.#idleTimer);
    this.#idleTimer = undefined;
  }

}

export function defineTimWorkbench(tagName = 'tim-workbench'): void {
  if (typeof customElements !== 'undefined' && !customElements.get(tagName)) {
    customElements.define(tagName, TimWorkbenchElement);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tim-workbench': TimWorkbenchElement;
  }
}
