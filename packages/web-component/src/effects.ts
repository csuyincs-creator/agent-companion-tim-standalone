export const TIM_EFFECT_ASSET_IDS = [
  'sleep', 'question', 'exclamation', 'star', 'heart', 'confetti', 'sparkle',
  'idea', 'music', 'confusion', 'anger', 'tear', 'alert', 'siren'
] as const;

export type TimEffectAssetId = typeof TIM_EFFECT_ASSET_IDS[number];
export type TimEffectLegacyAlias = 'thought' | 'warning' | 'water';
export type TimEffectType = TimEffectAssetId | TimEffectLegacyAlias;

const EFFECT_TYPE_ALIASES: Record<TimEffectLegacyAlias, TimEffectAssetId> = {
  thought: 'confusion',
  warning: 'alert',
  water: 'tear'
};

export function resolveTimEffectType(type: TimEffectType): TimEffectAssetId {
  return EFFECT_TYPE_ALIASES[type as TimEffectLegacyAlias] ?? type as TimEffectAssetId;
}

export function timEffectAssetUrl(
  type: TimEffectType,
  base = '/assets/effects/generated-v2'
): string {
  return `${base.replace(/\/$/, '')}/${resolveTimEffectType(type)}.png`;
}

export type TimEffectPriority = 'low' | 'normal' | 'high' | 'critical';
export type TimEffectAnchor = 'top-left' | 'top-right' | 'left' | 'right' | 'above' | 'auto';

export interface TimEffectRequest {
  type: TimEffectType;
  durationMs?: number;
  priority?: TimEffectPriority;
  anchor?: TimEffectAnchor;
  label?: string;
  persistent?: boolean;
}

export interface TimEffectInstance extends Required<Pick<TimEffectRequest, 'type' | 'priority' | 'anchor'>> {
  id: string;
  label?: string;
  expiresAt?: number;
  persistent: boolean;
}

export type TimEffectListener = (effects: readonly TimEffectInstance[]) => void;

const PRIORITY: Record<TimEffectPriority, number> = { low: 0, normal: 1, high: 2, critical: 3 };

export class TimEffectsController {
  #effects = new Map<string, TimEffectInstance>();
  #listeners = new Set<TimEffectListener>();
  #enabled = true;
  #reducedMotion = false;
  #sequence = 0;
  #lastShown = new Map<TimEffectType, number>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  subscribe(listener: TimEffectListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  show(request: TimEffectRequest): string {
    const priority = request.priority ?? 'normal';
    const anchor = request.anchor ?? 'auto';
    const cooldown = request.persistent ? 0 : 250;
    const last = this.#lastShown.get(request.type) ?? -Infinity;
    if (!this.#enabled || this.now() - last < cooldown) return '';
    const id = `effect-${++this.#sequence}`;
    const durationMs = this.#reducedMotion ? 0 : Math.max(0, request.durationMs ?? 1400);
    const instance: TimEffectInstance = {
      id,
      type: request.type,
      priority,
      anchor,
      label: request.label,
      persistent: request.persistent ?? false,
      expiresAt: request.persistent || durationMs === 0 ? undefined : this.now() + durationMs
    };
    this.#lastShown.set(request.type, this.now());
    this.#effects.set(id, instance);
    this.#trim();
    this.#emit();
    return id;
  }

  hide(id: string): void {
    if (this.#effects.delete(id)) this.#emit();
  }

  clear(): void {
    if (this.#effects.size > 0) {
      this.#effects.clear();
      this.#emit();
    }
  }

  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
    if (!enabled) this.clear();
  }

  setReducedMotion(reduced: boolean): void {
    this.#reducedMotion = reduced;
  }

  getSnapshot(): readonly TimEffectInstance[] {
    this.#expire();
    return this.#ordered();
  }

  tick(): void {
    if (this.#expire()) this.#emit();
  }

  #expire(): boolean {
    const now = this.now();
    let changed = false;
    for (const [id, effect] of this.#effects) {
      if (effect.expiresAt !== undefined && effect.expiresAt <= now) {
        this.#effects.delete(id);
        changed = true;
      }
    }
    return changed;
  }

  #trim(): void {
    const ordered = this.#ordered();
    const keep = ordered.filter((effect, index) => index === 0 || index < 3);
    this.#effects = new Map(keep.map((effect) => [effect.id, effect]));
  }

  #ordered(): TimEffectInstance[] {
    return [...this.#effects.values()].sort((a, b) => PRIORITY[b.priority] - PRIORITY[a.priority]);
  }

  #emit(): void {
    const snapshot = Object.freeze([...this.#ordered()]);
    for (const listener of this.#listeners) listener(snapshot);
  }
}
