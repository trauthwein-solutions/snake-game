import type { Direction } from '../engine/model';
import { listenForKeyboard } from './keyboard';
import { listenForSwipes } from './swipe';
import { listenForTouchControls, type TouchControls } from './touch-controls';

export interface InputControllerOptions {
  readonly keyboardTarget: Document;
  readonly arena: HTMLElement;
  readonly touchControls: TouchControls;
  readonly onDirection: (direction: Direction) => void;
  readonly onPauseToggle: () => void;
}

export function createInputController({
  keyboardTarget,
  arena,
  touchControls,
  onDirection,
  onPauseToggle,
}: InputControllerOptions): () => void {
  const teardowns = [
    listenForKeyboard(keyboardTarget, onDirection, onPauseToggle),
    listenForSwipes(arena, onDirection),
    listenForTouchControls(touchControls, onDirection),
  ];
  let active = true;

  return () => {
    if (!active) {
      return;
    }
    active = false;
    for (const teardown of teardowns) {
      teardown();
    }
  };
}
