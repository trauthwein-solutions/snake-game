import type { Direction } from '../engine/model';

const DIRECTION_KEYS: Readonly<Record<string, Direction>> = {
  arrowup: 'up',
  arrowright: 'right',
  arrowdown: 'down',
  arrowleft: 'left',
  w: 'up',
  d: 'right',
  s: 'down',
  a: 'left',
};

const EDITABLE_CONTROL_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);

function shouldKeepKeyboardInputNative(target: EventTarget | null): boolean {
  if (target === null) {
    return false;
  }

  const element = target as EventTarget & {
    readonly tagName?: string;
    readonly isContentEditable?: boolean;
    closest?(selector: string): Element | null;
  };
  const openDialog = element.closest?.('dialog[open]');

  return (
    element.isContentEditable === true ||
    (element.tagName !== undefined &&
      EDITABLE_CONTROL_TAGS.has(element.tagName)) ||
    (openDialog !== undefined && openDialog !== null)
  );
}

export function listenForKeyboard(
  target: Document,
  onDirection: (direction: Direction) => void,
  onPauseToggle: () => void,
): () => void {
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      shouldKeepKeyboardInputNative(event.target)
    ) {
      return;
    }

    const normalizedKey = event.key.toLowerCase();
    const direction = DIRECTION_KEYS[normalizedKey];
    if (direction !== undefined) {
      event.preventDefault();
      onDirection(direction);
      return;
    }

    if ((normalizedKey === 'p' || event.key === 'Escape') && !event.repeat) {
      event.preventDefault();
      onPauseToggle();
    }
  };

  target.addEventListener('keydown', handleKeyDown);
  return () => target.removeEventListener('keydown', handleKeyDown);
}
