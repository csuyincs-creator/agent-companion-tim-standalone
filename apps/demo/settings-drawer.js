const createElement = (name, className, text) => {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

const createField = (labelText, control) => {
  const field = createElement('label', 'tim-settings-field');
  field.append(createElement('span', 'tim-settings-label', labelText), control);
  return field;
};

const appendOptions = (select, options) => {
  for (const [value, label] of options) {
    const option = createElement('option', '', label);
    option.value = value;
    select.append(option);
  }
};

const responseBody = async (response) => {
  try { return await response.json(); } catch { return {}; }
};

const requestError = (response, body) => {
  if (typeof body?.error === 'string' && body.error.trim()) return body.error;
  return `请求失败（${response.status}）`;
};

export function mountAiSettingsDrawer({
  container,
  workbench,
  includeEffectSpread = false,
  onOpen,
  onClose
}) {
  if (!(container instanceof HTMLElement) || !(workbench instanceof HTMLElement)) {
    throw new TypeError('AI settings drawer requires container and workbench elements');
  }

  const region = createElement('section', 'tim-ai-settings');
  region.id = 'tim-ai-settings-region';
  region.hidden = true;
  region.setAttribute('role', 'dialog');
  region.setAttribute('aria-modal', 'true');
  region.setAttribute('aria-labelledby', 'tim-ai-settings-title');

  const chrome = createElement('header', 'tim-drawer-head');
  const title = createElement('h2', 'tim-drawer-title', 'AI 设置');
  title.id = 'tim-ai-settings-title';
  const closeButton = createElement('button', 'tim-drawer-close', '关闭');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', '关闭 AI 设置');
  chrome.append(title, closeButton);

  const form = createElement('form', 'tim-settings-form');
  const intro = createElement(
    'p',
    'tim-settings-intro',
    'DeepSeek 配置用于对话模式；Codex 配置用于本地 AI 助手。设置会在下次打开时恢复；API key 不保存在浏览器中，并由 Windows 当前用户加密后保存在本机。'
  );

  const baseUrl = createElement('input', 'tim-settings-input');
  baseUrl.type = 'url';
  baseUrl.name = 'baseUrl';
  baseUrl.required = true;
  baseUrl.autocomplete = 'url';
  baseUrl.placeholder = 'https://api.deepseek.com';

  const apiKey = createElement('input', 'tim-settings-input');
  apiKey.type = 'password';
  apiKey.name = 'apiKey';
  apiKey.autocomplete = 'off';
  apiKey.spellcheck = false;
  apiKey.placeholder = '留空则保留当前密钥';

  const model = createElement('input', 'tim-settings-input');
  model.type = 'text';
  model.name = 'model';
  model.required = true;
  model.maxLength = 100;
  model.autocomplete = 'off';
  model.spellcheck = false;
  model.setAttribute('list', 'tim-ai-model-suggestions');
  model.placeholder = '输入模型号';
  const modelSuggestions = createElement('datalist');
  modelSuggestions.id = 'tim-ai-model-suggestions';
  appendOptions(modelSuggestions, [
    ['deepseek-v4-flash', 'deepseek-v4-flash'],
    ['deepseek-v4-pro', 'deepseek-v4-pro']
  ]);

  const thinking = createElement('select', 'tim-settings-input');
  thinking.name = 'thinking';
  appendOptions(thinking, [['disabled', '关闭'], ['enabled', '开启']]);

  const codexModel = createElement('select', 'tim-settings-input');
  codexModel.name = 'codexModel';
  codexModel.required = true;
  appendOptions(codexModel, [['gpt-5.4-mini', '正在读取本机 Codex 模型…']]);
  const codexModelsStatus = createElement('p', 'tim-settings-model-status', '尚未读取本机模型列表');
  codexModelsStatus.setAttribute('role', 'status');

  const codexEffort = createElement('select', 'tim-settings-input');
  codexEffort.name = 'codexEffort';
  appendOptions(codexEffort, [
    ['low', '低'],
    ['medium', '中'],
    ['high', '高'],
    ['xhigh', '很高'],
    ['max', '最大'],
    ['ultra', '极限']
  ]);

  const codexSafeMode = createElement('select', 'tim-settings-input');
  codexSafeMode.name = 'codexSafeMode';
  appendOptions(codexSafeMode, [
    ['readOnly', '只读'],
    ['workspaceWrite', '可写工作区'],
    ['dangerFullAccess', '完全访问（危险）']
  ]);

  const codexCwd = createElement('input', 'tim-settings-input');
  codexCwd.type = 'text';
  codexCwd.name = 'codexCwd';
  codexCwd.required = true;
  codexCwd.maxLength = 4096;
  codexCwd.autocomplete = 'off';
  codexCwd.spellcheck = false;
  codexCwd.placeholder = 'C:\\path\\to\\project';

  const configured = createElement('p', 'tim-settings-configured', '正在载入配置…');
  configured.setAttribute('role', 'status');
  const status = createElement('p', 'tim-settings-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const fields = [
    intro,
    createElement('h3', 'tim-settings-heading', 'DeepSeek'),
    createField('API 地址', baseUrl),
    createField('API key', apiKey),
    createField('模型', model),
    modelSuggestions,
    createField('思考模式', thinking),
    createElement('h3', 'tim-settings-heading', 'Codex'),
    createField('模型', codexModel),
    codexModelsStatus,
    createField('思考强度', codexEffort),
    createField('读写权限', codexSafeMode),
    createField('工作目录', codexCwd)
  ];

  if (includeEffectSpread) {
    const spread = createElement('input', 'tim-settings-input tim-settings-range');
    spread.type = 'range';
    spread.name = 'fx-spread';
    spread.id = 'fx-spread';
    spread.min = '-10';
    spread.max = '40';
    spread.step = '2';
    spread.value = '0';
    const spreadValue = createElement('output', 'tim-settings-value', '0');
    spreadValue.setAttribute('for', spread.id);
    const spreadLabel = createElement('span', 'tim-settings-label');
    spreadLabel.append('特效距离 ', spreadValue, 'px');
    const spreadField = createElement('label', 'tim-settings-field');
    spreadField.append(spreadLabel, spread);
    fields.push(spreadField);

    const storageKey = 'tim-effect-spread';
    try {
      const saved = Number(localStorage.getItem(storageKey));
      if (!Number.isNaN(saved)) spread.value = String(Math.round(saved / 2) * 2);
    } catch { /* Effect spread persistence is optional. */ }
    spreadValue.textContent = spread.value;
    container.style.setProperty('--tim-effect-spread', `${spread.value}px`);
    spread.addEventListener('input', () => {
      spreadValue.textContent = spread.value;
      container.style.setProperty('--tim-effect-spread', `${spread.value}px`);
      try { localStorage.setItem(storageKey, spread.value); } catch { /* Effect spread persistence is optional. */ }
    });
  }

  const actions = createElement('div', 'tim-settings-actions');
  const reload = createElement('button', 'tim-settings-secondary', '载入配置');
  reload.type = 'button';
  const testDeepSeek = createElement('button', 'tim-settings-secondary', '测试 DeepSeek');
  testDeepSeek.type = 'button';
  const testCodex = createElement('button', 'tim-settings-secondary', '测试 Codex');
  testCodex.type = 'button';
  const save = createElement('button', 'tim-settings-primary', '保存');
  save.type = 'submit';
  actions.append(reload, testDeepSeek, testCodex, save);
  form.append(...fields, configured, status, actions);
  region.append(chrome, form);
  container.append(region);

  const setBusy = (busy) => {
    reload.disabled = busy;
    testDeepSeek.disabled = busy;
    testCodex.disabled = busy;
    save.disabled = busy;
  };

  const validateControls = (controls) => {
    const invalid = controls.find((control) => !control.checkValidity());
    if (!invalid) return true;
    invalid.reportValidity();
    return false;
  };

  let loadVersion = 0;
  let loadController;

  const keepCurrentCodexModel = (modelName, label = modelName) => {
    codexModel.replaceChildren();
    const option = createElement('option', '', label);
    option.value = modelName;
    codexModel.append(option);
    codexModel.value = modelName;
  };

  const populateCodexModels = (models, selectedModel) => {
    codexModel.replaceChildren();
    for (const item of models) {
      const option = createElement('option');
      option.value = item.model;
      option.textContent = item.displayName && item.displayName !== item.model
        ? `${item.displayName}（${item.model}）${item.isDefault ? ' · 默认' : ''}`
        : `${item.model}${item.isDefault ? ' · 默认' : ''}`;
      option.title = item.description || '';
      codexModel.append(option);
    }
    const available = models.some((item) => item.model === selectedModel);
    if (!available && selectedModel) {
      const unavailable = createElement('option', '', `${selectedModel}（当前不可用，请重新选择）`);
      unavailable.value = selectedModel;
      codexModel.prepend(unavailable);
      codexModel.setCustomValidity('已保存的 Codex 模型当前不可用，请重新选择');
      codexModel.value = selectedModel;
      return;
    }
    codexModel.setCustomValidity('');
    const defaultModel = models.find((item) => item.isDefault)?.model ?? models[0]?.model ?? selectedModel;
    codexModel.value = available ? selectedModel : defaultModel;
  };

  async function loadCodexModels(selectedModel, signal, version) {
    codexModelsStatus.textContent = '正在读取本机 Codex 模型…';
    try {
      const response = await fetch('/api/ai/codex/models', {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        signal
      });
      const body = await responseBody(response);
      if (!response.ok) throw new Error(requestError(response, body));
      if (version !== loadVersion || region.hidden) return;
      const models = Array.isArray(body.models)
        ? body.models.filter((item) => item && typeof item.model === 'string' && item.model)
        : [];
      if (!models.length) throw new Error('本机 Codex 没有返回可用模型');
      populateCodexModels(models, selectedModel);
      codexModelsStatus.textContent = `已读取 ${models.length} 个本机可用模型`;
    } catch (error) {
      if (signal.aborted || version !== loadVersion) return;
      keepCurrentCodexModel(selectedModel, `${selectedModel}（模型列表读取失败）`);
      codexModel.setCustomValidity('');
      codexModelsStatus.textContent = error instanceof Error ? error.message : '无法读取本机 Codex 模型';
    }
  }

  async function loadConfiguration() {
    loadController?.abort();
    const version = ++loadVersion;
    const controller = new AbortController();
    loadController = controller;
    setBusy(true);
    status.textContent = '正在载入配置…';
    try {
      const response = await fetch('/api/ai/config', {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        signal: controller.signal
      });
      const body = await responseBody(response);
      if (!response.ok) throw new Error(requestError(response, body));
      if (version !== loadVersion || region.hidden) return;
      baseUrl.value = typeof body.baseUrl === 'string' ? body.baseUrl : '';
      model.value = typeof body.model === 'string' ? body.model : 'deepseek-v4-flash';
      thinking.value = body.thinking === 'enabled' ? 'enabled' : 'disabled';
      const selectedCodexModel = typeof body.codexModel === 'string' ? body.codexModel : 'gpt-5.4-mini';
      keepCurrentCodexModel(selectedCodexModel);
      codexEffort.value = typeof body.codexEffort === 'string' ? body.codexEffort : 'high';
      codexSafeMode.value = typeof body.codexSafeMode === 'string' ? body.codexSafeMode : 'workspaceWrite';
      codexCwd.value = typeof body.codexCwd === 'string' ? body.codexCwd : '';
      configured.textContent = body.configured ? 'API key 已配置' : 'API key 尚未配置';
      await loadCodexModels(selectedCodexModel, controller.signal, version);
      if (version !== loadVersion || region.hidden) return;
      status.textContent = '配置已载入';
    } catch (error) {
      if (controller.signal.aborted || version !== loadVersion) return;
      status.textContent = error instanceof Error ? error.message : '无法载入配置';
    } finally {
      if (version === loadVersion) {
        loadController = undefined;
        setBusy(false);
      }
    }
  }

  codexModel.addEventListener('change', () => codexModel.setCustomValidity(''));

  async function saveConfiguration() {
    if (!form.reportValidity()) return;
    setBusy(true);
    status.textContent = '正在保存…';
    const payload = {
      baseUrl: baseUrl.value.trim(),
      model: model.value.trim(),
      thinking: thinking.value,
      codexModel: codexModel.value.trim(),
      codexEffort: codexEffort.value,
      codexSafeMode: codexSafeMode.value,
      codexCwd: codexCwd.value.trim()
    };
    const key = apiKey.value.trim();
    if (key) payload.apiKey = key;
    try {
      const response = await fetch('/api/ai/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
      });
      const body = await responseBody(response);
      if (!response.ok) throw new Error(requestError(response, body));
      apiKey.value = '';
      configured.textContent = body.configured ? 'API key 已配置' : 'API key 尚未配置';
      status.textContent = '已保存，下次打开仍会沿用。可继续测试连接。';
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : '保存失败';
    } finally {
      setBusy(false);
    }
  }

  async function testDeepSeekConnection() {
    if (!validateControls([baseUrl, model, thinking])) return;
    setBusy(true);
    status.textContent = '正在测试 DeepSeek 连接…';
    const payload = {
      baseUrl: baseUrl.value.trim(),
      model: model.value.trim(),
      thinking: thinking.value
    };
    const key = apiKey.value.trim();
    if (key) payload.apiKey = key;
    try {
      const response = await fetch('/api/ai/config/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
      });
      const body = await responseBody(response);
      if (!response.ok) throw new Error(requestError(response, body));
      status.textContent = `DeepSeek 连接成功（${body.model || 'DeepSeek'}）`;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'DeepSeek 连接测试失败';
    } finally {
      setBusy(false);
    }
  }

  async function testCodexConnection() {
    if (!validateControls([codexModel, codexEffort, codexSafeMode, codexCwd])) return;
    setBusy(true);
    status.textContent = '正在测试 Codex 连接…';
    try {
      const response = await fetch('/api/ai/config/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          provider: 'codex',
          codexModel: codexModel.value.trim(),
          codexEffort: codexEffort.value,
          codexSafeMode: codexSafeMode.value,
          codexCwd: codexCwd.value.trim()
        })
      });
      const body = await responseBody(response);
      if (!response.ok) throw new Error(requestError(response, body));
      status.textContent = `Codex 连接成功（${body.model || 'Codex'}）`;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Codex 连接测试失败';
    } finally {
      setBusy(false);
    }
  }

  let invoker = null;
  let inertState = [];

  const setBackgroundInert = (inert) => {
    if (inert) {
      inertState = [...container.children]
        .filter((child) => child !== region)
        .map((child) => [child, child.inert]);
      for (const [child] of inertState) child.inert = true;
      return;
    }
    for (const [child, wasInert] of inertState) child.inert = wasInert;
    inertState = [];
  };

  const close = (returnFocus = true) => {
    if (region.hidden) return;
    loadController?.abort();
    loadController = undefined;
    loadVersion += 1;
    setBusy(false);
    region.hidden = true;
    apiKey.value = '';
    invoker?.setAttribute('aria-expanded', 'false');
    onClose?.();
    setBackgroundInert(false);
    if (returnFocus) invoker?.focus({ preventScroll: true });
  };

  const open = (event) => {
    if (!region.hidden) close(false);
    const requested = event.detail?.trigger;
    invoker = requested instanceof HTMLElement ? requested : workbench;
    invoker.setAttribute('aria-controls', region.id);
    invoker.setAttribute('aria-haspopup', 'dialog');
    invoker.setAttribute('aria-expanded', 'true');
    region.hidden = false;
    setBackgroundInert(true);
    onOpen?.(region);
    closeButton.focus({ preventScroll: true });
    void loadConfiguration();
  };

  closeButton.addEventListener('click', () => close());
  reload.addEventListener('click', () => void loadConfiguration());
  testDeepSeek.addEventListener('click', () => void testDeepSeekConnection());
  testCodex.addEventListener('click', () => void testCodexConnection());
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveConfiguration();
  });
  form.addEventListener('input', () => {
    if (loadController) {
      loadController.abort();
      loadController = undefined;
      loadVersion += 1;
      setBusy(false);
    }
    status.textContent = '配置已修改，尚未保存';
  });
  workbench.addEventListener('tim-ai-settings-request', open);
  container.addEventListener('keydown', (event) => {
    if (region.hidden) return;
    if (event.key === 'Escape') {
      if (event.target instanceof HTMLElement && event.target.matches('select, input[type="date"]')) return;
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...region.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((node) => node instanceof HTMLElement && node.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  return Object.freeze({ region, open, close, load: loadConfiguration });
}
