import type { Direction } from '../engine/model';

export interface TouchControls {
  readonly element: HTMLElement;
  readonly buttons: Readonly<Record<Direction, HTMLButtonElement>>;
}

const BUTTON_LABELS: Readonly<Record<Direction, string>> = {
  up: 'Move up',
  right: 'Move right',
  down: 'Move down',
  left: 'Move left',
};

const BUTTON_SYMBOLS: Readonly<Record<Direction, string>> = {
  up: '↑',
  right: '→',
  down: '↓',
  left: '←',
};

const DIRECTIONS: readonly Direction[] = ['up', 'right', 'down', 'left'];

export function createTouchControls(ownerDocument: Document): TouchControls {
  const element = ownerDocument.createElement('div');
  element.className = 'dpad';
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', 'Directional controls');

  const buttons = {} as Record<Direction, HTMLButtonElement>;
  for (const direction of DIRECTIONS) {
    const button = ownerDocument.createElement('button');
    button.className = `dpad__button dpad__button--${direction}`;
    button.type = 'button';
    button.dataset.direction = direction;
    button.setAttribute('aria-label', BUTTON_LABELS[direction]);
    button.textContent = BUTTON_SYMBOLS[direction];
    buttons[direction] = button;
    element.append(button);
  }

  return { element, buttons };
}

export function listenForTouchControls(
  touchControls: TouchControls,
  onDirection: (direction: Direction) => void,
): () => void {
  const listeners = DIRECTIONS.map((direction) => {
    const button = touchControls.buttons[direction];
    const handleClick = (event: MouseEvent): void => {
      event.preventDefault();
      onDirection(direction);
    };
    button.addEventListener('click', handleClick);
    return { button, handleClick };
  });

  return () => {
    for (const { button, handleClick } of listeners) {
      button.removeEventListener('click', handleClick);
    }
  };
}
