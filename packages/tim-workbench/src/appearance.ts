export type WorkbenchAppearance = {
  readonly opacity: number;
  readonly brightness: number;
};

export const DEFAULT_WORKBENCH_APPEARANCE: WorkbenchAppearance = Object.freeze({
  opacity: 0,
  brightness: 1
});

function finiteOr(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeWorkbenchAppearance(input: Partial<WorkbenchAppearance>): WorkbenchAppearance {
  return {
    opacity: Math.round(clamp(finiteOr(input.opacity, DEFAULT_WORKBENCH_APPEARANCE.opacity), 0, 0.96) * 100) / 100,
    brightness: Math.round(clamp(finiteOr(input.brightness, DEFAULT_WORKBENCH_APPEARANCE.brightness), 0.72, 1.16) * 100) / 100
  };
}

export function workbenchAppearanceProperties(input: Partial<WorkbenchAppearance>): Readonly<Record<string, string>> {
  const value = normalizeWorkbenchAppearance(input);
  return {
    '--tim-workbench-surface-opacity': String(value.opacity),
    '--tim-workbench-surface-brightness': String(value.brightness)
  };
}
