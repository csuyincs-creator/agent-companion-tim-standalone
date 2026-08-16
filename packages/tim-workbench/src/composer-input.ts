export type ComposerKeyInput = Readonly<{
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
}>;

export function shouldSubmitComposer(input: ComposerKeyInput): boolean {
  return input.key === 'Enter' && !input.shiftKey && !input.isComposing;
}
