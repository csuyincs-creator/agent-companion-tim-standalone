import type { TimStatus } from '../../core/src/types.js';

export const TIM_IDLE_INTERACTION_MIN_DELAY_MS = 8_000;
export const TIM_IDLE_INTERACTION_MAX_DELAY_MS = 14_000;
export const TIM_IDLE_SLEEP_DURATION_MS = 1_800;
export type TimIdleRandomInteraction = 'sleep' | 'extras';

export function randomIdleInteractionDelay(random = Math.random): number {
  const normalized = Math.min(.999999, Math.max(0, random()));
  return Math.round(TIM_IDLE_INTERACTION_MIN_DELAY_MS
    + normalized * (TIM_IDLE_INTERACTION_MAX_DELAY_MS - TIM_IDLE_INTERACTION_MIN_DELAY_MS));
}

export function pickIdleRandomInteraction(random = Math.random): TimIdleRandomInteraction {
  return Math.min(.999999, Math.max(0, random())) < .45 ? 'sleep' : 'extras';
}

export function shouldScheduleIdleInteraction(
  status: TimStatus,
  reducedMotion: boolean,
  connected: boolean,
  idleAwake = false,
  enabled = true
): boolean {
  return enabled && connected && status === 'idle' && !reducedMotion && !idleAwake;
}

export const TIM_CLIP_ROTATION_LOOPS: Readonly<Record<TimStatus, number>> = Object.freeze({
  idle: Number.POSITIVE_INFINITY,
  running: 3,
  needs_input: 3,
  ready: 2,
  blocked: 4,
  extras: 1
});

export function shouldAnimateTimStatus(status: TimStatus, idleAwake = false): boolean {
  return status !== 'idle' || idleAwake;
}

export function shouldRotateTimClip(status: TimStatus, completedLoops: number): boolean {
  const threshold = TIM_CLIP_ROTATION_LOOPS[status];
  return status !== 'extras' && Number.isFinite(threshold) && completedLoops > 0 && completedLoops % threshold === 0;
}

export function completeSpriteLoopDuration(frameDurationsMs: readonly number[], minimumDurationMs = 0): number {
  const loopDuration = frameDurationsMs.reduce((total, duration) => total + Math.max(0, duration), 0);
  if (loopDuration <= 0) return 0;
  return loopDuration * Math.max(1, Math.ceil(Math.max(0, minimumDurationMs) / loopDuration));
}

export function pickDifferentIndex(currentIndex: number, length: number, random = Math.random): number {
  if (length <= 1) return 0;
  const offset = 1 + Math.floor(Math.min(.999999, Math.max(0, random())) * (length - 1));
  return (Math.max(0, currentIndex) + offset) % length;
}
