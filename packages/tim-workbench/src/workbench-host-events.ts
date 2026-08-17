export const TIM_AI_SETTINGS_REQUEST_EVENT = 'tim-ai-settings-request';

export type TimWorkbenchHostRequestEvent = typeof TIM_AI_SETTINGS_REQUEST_EVENT;

export const WORKBENCH_HEADER_ACTIONS: readonly Readonly<{
  label: string;
  eventType: TimWorkbenchHostRequestEvent;
  controls: string;
}>[] = Object.freeze([
  Object.freeze({ label: 'AI 设置', eventType: TIM_AI_SETTINGS_REQUEST_EVENT, controls: 'tim-ai-settings-region' })
]);

/**
 * Requests host-owned UI without making the workbench a second owner for
 * provider settings. The event crosses the component's shadow root
 * and remains cancelable so a host can signal that it handled the request.
 */
export function dispatchWorkbenchHostRequest(
  target: EventTarget,
  type: TimWorkbenchHostRequestEvent
): boolean {
  return target.dispatchEvent(new CustomEvent(type, {
    bubbles: true,
    composed: true,
    cancelable: true,
    detail: { trigger: target }
  }));
}
