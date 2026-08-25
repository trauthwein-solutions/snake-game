import { describe, expect, it, vi } from 'vitest';

import type { Direction } from '../../src/engine/model';
import { createInputController } from '../../src/input/input-controller';
import { listenForKeyboard } from '../../src/input/keyboard';
import { classifySwipe, listenForSwipes } from '../../src/input/swipe';
import type { TouchControls } from '../../src/input/touch-controls';

type Listener = (event: unknown) => void;
type ListenerOptions = boolean | { readonly capture?: boolean };

function usesCapture(options: ListenerOptions | undefined): boolean {
  return typeof options === 'boolean' ? options : options?.capture === true;
}

class FakeEventTarget {
  readonly listeners = new Map<string, Map<Listener, boolean>>();

  addEventListener(
    type: string,
    listener: EventListener,
    options?: ListenerOptions,
  ): void {
    const listeners = this.listeners.get(type) ?? new Map<Listener, boolean>();
    listeners.set(listener as Listener, usesCapture(options));
    this.listeners.set(type, listeners);
  }

  removeEventListener(
    type: string,
    listener: EventListener,
    options?: ListenerOptions,
  ): void {
    const listeners = this.listeners.get(type);
    if (listeners?.get(listener as Listener) === usesCapture(options)) {
      listeners.delete(listener as Listener);
    }
  }

  dispatch(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type)?.keys() ?? []) {
      listener(event);
    }
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce(
      (count, listeners) => count + listeners.size,
      0,
    );
  }

  captureListenerCount(type: string): number {
    return [...(this.listeners.get(type)?.values() ?? [])].filter(Boolean)
      .length;
  }
}

class FakePointerTarget extends FakeEventTarget {
  readonly capturedPointers = new Set<number>();

  constructor(readonly ownerDocument = new FakeEventTarget()) {
    super();
  }

  setPointerCapture(pointerId: number): void {
    this.capturedPointers.add(pointerId);
  }

  releasePointerCapture(pointerId: number): void {
    this.capturedPointers.delete(pointerId);
  }

  hasPointerCapture(pointerId: number): boolean {
    return this.capturedPointers.has(pointerId);
  }
}

interface KeyboardEventOptions {
  key: string;
  repeat?: boolean;
  target?: unknown;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

function keyboardEvent({
  key,
  repeat = false,
  target = { tagName: 'BODY', isContentEditable: false },
  ctrlKey = false,
  metaKey = false,
  altKey = false,
}: KeyboardEventOptions) {
  return {
    key,
    repeat,
    target,
    ctrlKey,
    metaKey,
    altKey,
    preventDefault: vi.fn(),
  };
}

interface PointerEventOptions {
  pointerId?: number;
  clientX?: number;
  clientY?: number;
  button?: number;
  isPrimary?: boolean;
  pointerType?: string;
}

function pointerEvent({
  pointerId = 1,
  clientX = 0,
  clientY = 0,
  button = 0,
  isPrimary = true,
  pointerType = 'mouse',
}: PointerEventOptions = {}) {
  return {
    pointerId,
    clientX,
    clientY,
    button,
    isPrimary,
    pointerType,
    preventDefault: vi.fn(),
  };
}

interface FakeTouch {
  readonly identifier: number;
  readonly clientX: number;
  readonly clientY: number;
}

function touch(
  identifier: number,
  clientX: number,
  clientY: number,
): FakeTouch {
  return { identifier, clientX, clientY };
}

function touchEvent(
  touches: readonly FakeTouch[],
  changedTouches: readonly FakeTouch[],
) {
  return {
    touches,
    changedTouches,
    cancelable: true,
    preventDefault: vi.fn(),
  };
}

function fakeTouchControls(): {
  controls: TouchControls;
  buttons: Record<Direction, FakeEventTarget>;
} {
  const buttons = {
    up: new FakeEventTarget(),
    right: new FakeEventTarget(),
    down: new FakeEventTarget(),
    left: new FakeEventTarget(),
  };

  return {
    buttons,
    controls: {
      element: new FakeEventTarget() as unknown as HTMLElement,
      buttons: buttons as unknown as Record<Direction, HTMLButtonElement>,
    },
  };
}

describe('keyboard input', () => {
  it.each([
    ['ArrowUp', 'up'],
    ['ArrowRight', 'right'],
    ['ArrowDown', 'down'],
    ['ArrowLeft', 'left'],
    ['w', 'up'],
    ['D', 'right'],
    ['S', 'down'],
    ['a', 'left'],
  ] as const)('maps %s to the %s direction', (key, expectedDirection) => {
    const target = new FakeEventTarget();
    const onDirection = vi.fn();
    listenForKeyboard(target as unknown as Document, onDirection, vi.fn());
    const event = keyboardEvent({ key });

    target.dispatch('keydown', event);

    expect(onDirection).toHaveBeenCalledOnce();
    expect(onDirection).toHaveBeenCalledWith(expectedDirection);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it.each(['p', 'P', 'Escape'])('maps %s to pause intent', (key) => {
    const target = new FakeEventTarget();
    const onPauseToggle = vi.fn();
    listenForKeyboard(target as unknown as Document, vi.fn(), onPauseToggle);
    const event = keyboardEvent({ key });

    target.dispatch('keydown', event);

    expect(onPauseToggle).toHaveBeenCalledOnce();
    expect(onPauseToggle).toHaveBeenCalledWith(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it('accepts repeated direction keys but rejects repeated pause toggles', () => {
    const target = new FakeEventTarget();
    const onDirection = vi.fn();
    const onPauseToggle = vi.fn();
    listenForKeyboard(
      target as unknown as Document,
      onDirection,
      onPauseToggle,
    );
    const directionEvent = keyboardEvent({ key: 'ArrowUp', repeat: true });
    const pauseEvent = keyboardEvent({ key: 'p', repeat: true });

    target.dispatch('keydown', directionEvent);
    target.dispatch('keydown', pauseEvent);

    expect(onDirection).toHaveBeenCalledOnce();
    expect(directionEvent.preventDefault).toHaveBeenCalledOnce();
    expect(onPauseToggle).not.toHaveBeenCalled();
    expect(pauseEvent.preventDefault).not.toHaveBeenCalled();
  });

  it.each([
    ['input', { tagName: 'INPUT', isContentEditable: false }],
    ['textarea', { tagName: 'TEXTAREA', isContentEditable: false }],
    ['select', { tagName: 'SELECT', isContentEditable: false }],
    ['contenteditable', { tagName: 'DIV', isContentEditable: true }],
  ])(
    'leaves recognized keys native inside %s controls',
    (_name, focusTarget) => {
      const target = new FakeEventTarget();
      const onDirection = vi.fn();
      const onPauseToggle = vi.fn();
      listenForKeyboard(
        target as unknown as Document,
        onDirection,
        onPauseToggle,
      );
      const event = keyboardEvent({ key: ' ', target: focusTarget });
      const gameKeyEvent = keyboardEvent({
        key: 'ArrowRight',
        target: focusTarget,
      });

      target.dispatch('keydown', event);
      target.dispatch('keydown', gameKeyEvent);

      expect(onDirection).not.toHaveBeenCalled();
      expect(onPauseToggle).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(gameKeyEvent.preventDefault).not.toHaveBeenCalled();
    },
  );

  it.each(['game action', 'D-pad'])(
    'accepts mapped keys when an ordinary %s button retains focus',
    () => {
      const target = new FakeEventTarget();
      const onDirection = vi.fn();
      const onPauseToggle = vi.fn();
      listenForKeyboard(
        target as unknown as Document,
        onDirection,
        onPauseToggle,
      );
      const focusTarget = {
        tagName: 'BUTTON',
        isContentEditable: false,
        closest: vi.fn(() => null),
      };
      const directionEvent = keyboardEvent({
        key: 'ArrowRight',
        target: focusTarget,
      });
      const pauseEvent = keyboardEvent({ key: 'p', target: focusTarget });

      target.dispatch('keydown', directionEvent);
      target.dispatch('keydown', pauseEvent);

      expect(onDirection).toHaveBeenCalledOnce();
      expect(onDirection).toHaveBeenCalledWith('right');
      expect(directionEvent.preventDefault).toHaveBeenCalledOnce();
      expect(onPauseToggle).toHaveBeenCalledOnce();
      expect(pauseEvent.preventDefault).toHaveBeenCalledOnce();
    },
  );

  it('leaves mapped keys native on a button inside an open dialog', () => {
    const target = new FakeEventTarget();
    const onDirection = vi.fn();
    const onPauseToggle = vi.fn();
    listenForKeyboard(
      target as unknown as Document,
      onDirection,
      onPauseToggle,
    );
    const focusTarget = {
      tagName: 'BUTTON',
      isContentEditable: false,
      closest: vi.fn((selector: string) =>
        selector === 'dialog[open]' ? { tagName: 'DIALOG' } : null,
      ),
    };
    const directionEvent = keyboardEvent({
      key: 'ArrowLeft',
      target: focusTarget,
    });
    const pauseEvent = keyboardEvent({ key: 'Escape', target: focusTarget });

    target.dispatch('keydown', directionEvent);
    target.dispatch('keydown', pauseEvent);

    expect(onDirection).not.toHaveBeenCalled();
    expect(onPauseToggle).not.toHaveBeenCalled();
    expect(directionEvent.preventDefault).not.toHaveBeenCalled();
    expect(pauseEvent.preventDefault).not.toHaveBeenCalled();
  });

  it('ignores unrecognized keys without preventing their defaults', () => {
    const target = new FakeEventTarget();
    const onDirection = vi.fn();
    const onPauseToggle = vi.fn();
    listenForKeyboard(
      target as unknown as Document,
      onDirection,
      onPauseToggle,
    );
    const event = keyboardEvent({ key: 'Enter' });

    target.dispatch('keydown', event);

    expect(onDirection).not.toHaveBeenCalled();
    expect(onPauseToggle).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it.each([
    ['Control', { ctrlKey: true }],
    ['Meta', { metaKey: true }],
    ['Alt', { altKey: true }],
  ] as const)(
    'leaves %s-modified direction and pause shortcuts native',
    (_modifier, modifierState) => {
      const target = new FakeEventTarget();
      const onDirection = vi.fn();
      const onPauseToggle = vi.fn();
      listenForKeyboard(
        target as unknown as Document,
        onDirection,
        onPauseToggle,
      );
      const directionEvent = keyboardEvent({
        key: 'ArrowLeft',
        ...modifierState,
      });
      const pauseEvent = keyboardEvent({ key: 'p', ...modifierState });

      target.dispatch('keydown', directionEvent);
      target.dispatch('keydown', pauseEvent);

      expect(onDirection).not.toHaveBeenCalled();
      expect(onPauseToggle).not.toHaveBeenCalled();
      expect(directionEvent.preventDefault).not.toHaveBeenCalled();
      expect(pauseEvent.preventDefault).not.toHaveBeenCalled();
    },
  );
});

describe('swipe input', () => {
  it.each([
    [50, 4, 'right'],
    [-50, 4, 'left'],
    [3, 50, 'down'],
    [3, -50, 'up'],
  ] as const)('classifies (%s, %s) as %s', (deltaX, deltaY, direction) => {
    expect(
      classifySwipe({ x: 10, y: 10 }, { x: 10 + deltaX, y: 10 + deltaY }),
    ).toBe(direction);
  });

  it.each([
    [0, 0],
    [20, 0],
    [40, 38],
    [-50, 45],
  ])('rejects short or ambiguous movement (%s, %s)', (deltaX, deltaY) => {
    expect(classifySwipe({ x: 0, y: 0 }, { x: deltaX, y: deltaY })).toBeNull();
  });

  it.each(['mouse', 'pen'])(
    'emits one final-endpoint direction for a primary %s gesture',
    (pointerType) => {
      const arena = new FakePointerTarget();
      const onDirection = vi.fn();
      listenForSwipes(arena as unknown as HTMLElement, onDirection);
      const down = pointerEvent({ clientX: 20, clientY: 30, pointerType });
      const misleadingMove = pointerEvent({
        clientX: 70,
        clientY: 34,
        pointerType,
      });
      const up = pointerEvent({ clientX: 22, clientY: 90, pointerType });

      arena.dispatch('pointerdown', down);
      expect(arena.capturedPointers).toEqual(new Set([1]));
      arena.dispatch('pointermove', misleadingMove);
      arena.dispatch('pointerup', up);
      arena.dispatch('pointerup', up);

      expect(misleadingMove.preventDefault).not.toHaveBeenCalled();
      expect(up.preventDefault).not.toHaveBeenCalled();
      expect(onDirection).toHaveBeenCalledOnce();
      expect(onDirection).toHaveBeenCalledWith('down');
      expect(arena.capturedPointers.size).toBe(0);
    },
  );

  it('tracks one touch identifier and emits exactly once from the final endpoint', () => {
    const arena = new FakePointerTarget();
    const onDirection = vi.fn();
    listenForSwipes(arena as unknown as HTMLElement, onDirection);
    const start = touch(7, 20, 30);
    const short = touch(7, 30, 32);
    const endpoint = touch(7, 70, 34);
    const shortMove = touchEvent([short], [short]);
    const end = touchEvent([], [endpoint]);

    arena.dispatch('touchstart', touchEvent([start], [start]));
    arena.dispatch('touchmove', shortMove);
    arena.dispatch('touchend', end);
    arena.dispatch('touchend', end);

    expect(shortMove.preventDefault).not.toHaveBeenCalled();
    expect(end.preventDefault).not.toHaveBeenCalled();
    expect(onDirection).toHaveBeenCalledOnce();
    expect(onDirection).toHaveBeenCalledWith('right');
  });

  it('uses a matching final touch endpoint instead of an earlier directional move', () => {
    const arena = new FakePointerTarget();
    const onDirection = vi.fn();
    listenForSwipes(arena as unknown as HTMLElement, onDirection);
    const start = touch(8, 20, 30);
    const earlyDirection = touch(8, 70, 34);
    const endpoint = touch(8, 22, 90);
    const earlyMove = touchEvent([earlyDirection], [earlyDirection]);
    const end = touchEvent([], [endpoint]);

    arena.dispatch('touchstart', touchEvent([start], [start]));
    arena.dispatch('touchmove', earlyMove);
    arena.dispatch('touchend', end);

    expect(earlyMove.preventDefault).not.toHaveBeenCalled();
    expect(end.preventDefault).not.toHaveBeenCalled();
    expect(onDirection).toHaveBeenCalledOnce();
    expect(onDirection).toHaveBeenCalledWith('down');
  });

  it('leaves short and ambiguous touch moves native and emits no direction', () => {
    const arena = new FakePointerTarget();
    const onDirection = vi.fn();
    listenForSwipes(arena as unknown as HTMLElement, onDirection);
    const short = touch(3, 3, -24);
    const ambiguous = touch(4, 35, -40);
    const shortMove = touchEvent([short], [short]);
    const ambiguousMove = touchEvent([ambiguous], [ambiguous]);

    arena.dispatch(
      'touchstart',
      touchEvent([touch(3, 0, 0)], [touch(3, 0, 0)]),
    );
    arena.dispatch('touchmove', shortMove);
    arena.dispatch('touchend', touchEvent([], [short]));
    arena.dispatch(
      'touchstart',
      touchEvent([touch(4, 0, 0)], [touch(4, 0, 0)]),
    );
    arena.dispatch('touchmove', ambiguousMove);
    arena.dispatch('touchend', touchEvent([], [ambiguous]));

    expect(shortMove.preventDefault).not.toHaveBeenCalled();
    expect(ambiguousMove.preventDefault).not.toHaveBeenCalled();
    expect(onDirection).not.toHaveBeenCalled();
  });

  it('cancels touch state for touchcancel, stale identifiers, and multi-touch', () => {
    const arena = new FakePointerTarget();
    const onDirection = vi.fn();
    listenForSwipes(arena as unknown as HTMLElement, onDirection);

    const first = touch(10, 0, 0);
    const firstCommitted = touch(10, 60, 0);
    const firstStart = touchEvent([first], [first]);
    const firstMove = touchEvent([firstCommitted], [firstCommitted]);
    const firstCancel = touchEvent([], [firstCommitted]);
    arena.dispatch('touchstart', firstStart);
    arena.dispatch('touchmove', firstMove);
    arena.dispatch('touchcancel', firstCancel);
    arena.dispatch('touchend', touchEvent([], [firstCommitted]));

    const primary = touch(11, 0, 0);
    const secondary = touch(12, 10, 10);
    const multiStart = touchEvent([primary, secondary], [secondary]);
    const multiMove = touchEvent(
      [touch(11, 60, 0), secondary],
      [touch(11, 60, 0)],
    );
    arena.dispatch('touchstart', touchEvent([primary], [primary]));
    arena.dispatch('touchstart', multiStart);
    arena.dispatch('touchmove', multiMove);
    arena.dispatch('touchend', touchEvent([secondary], [touch(11, 60, 0)]));
    arena.dispatch('touchend', touchEvent([], [secondary]));

    const stale = touch(13, 0, 0);
    arena.dispatch('touchstart', touchEvent([stale], [stale]));
    arena.dispatch(
      'touchmove',
      touchEvent([touch(99, 60, 0)], [touch(99, 60, 0)]),
    );
    arena.dispatch('touchend', touchEvent([], [touch(13, 60, 0)]));

    expect(onDirection).not.toHaveBeenCalled();
    expect(firstStart.preventDefault).not.toHaveBeenCalled();
    expect(firstMove.preventDefault).not.toHaveBeenCalled();
    expect(firstCancel.preventDefault).not.toHaveBeenCalled();
    expect(multiStart.preventDefault).not.toHaveBeenCalled();
    expect(multiMove.preventDefault).not.toHaveBeenCalled();

    const fresh = touch(14, 0, 0);
    const freshCommitted = touch(14, 0, 60);
    arena.dispatch('touchstart', touchEvent([fresh], [fresh]));
    arena.dispatch('touchmove', touchEvent([freshCommitted], [freshCommitted]));
    arena.dispatch('touchend', touchEvent([], [freshCommitted]));
    expect(onDirection).toHaveBeenCalledOnce();
    expect(onDirection).toHaveBeenCalledWith('down');
  });

  it('unblocks only after a mixed-target touch sequence globally ends', () => {
    const ownerDocument = new FakeEventTarget();
    const arena = new FakePointerTarget(ownerDocument);
    const onDirection = vi.fn();
    listenForSwipes(arena as unknown as HTMLElement, onDirection);
    const arenaTouch = touch(15, 0, 0);
    const outsideTouch = touch(16, 10, 10);
    const multiMove = touchEvent(
      [touch(15, 20, 0), outsideTouch],
      [touch(15, 20, 0)],
    );
    const arenaEnd = touchEvent([outsideTouch], [touch(15, 60, 0)]);
    const outsideEnd = touchEvent([], [outsideTouch]);

    arena.dispatch('touchstart', touchEvent([arenaTouch], [arenaTouch]));
    arena.dispatch('touchmove', multiMove);
    arena.dispatch('touchend', arenaEnd);
    ownerDocument.dispatch('touchend', outsideEnd);

    expect(onDirection).not.toHaveBeenCalled();
    expect(multiMove.preventDefault).not.toHaveBeenCalled();
    expect(arenaEnd.preventDefault).not.toHaveBeenCalled();
    expect(outsideEnd.preventDefault).not.toHaveBeenCalled();

    const freshStart = touch(17, 0, 0);
    const freshEnd = touch(17, 60, 0);
    arena.dispatch('touchstart', touchEvent([freshStart], [freshStart]));
    arena.dispatch('touchend', touchEvent([], [freshEnd]));

    expect(onDirection).toHaveBeenCalledOnce();
    expect(onDirection).toHaveBeenCalledWith('right');
  });

  it('emits once when real touch events have compatibility pointer events', () => {
    const arena = new FakePointerTarget();
    const onDirection = vi.fn();
    listenForSwipes(arena as unknown as HTMLElement, onDirection);

    arena.dispatch(
      'pointerdown',
      pointerEvent({ pointerType: 'touch', clientX: 0, clientY: 0 }),
    );
    arena.dispatch(
      'pointermove',
      pointerEvent({ pointerType: 'touch', clientX: 60, clientY: 0 }),
    );
    arena.dispatch(
      'pointerup',
      pointerEvent({ pointerType: 'touch', clientX: 60, clientY: 0 }),
    );
    const start = touch(20, 0, 0);
    const endpoint = touch(20, 60, 0);
    arena.dispatch('touchstart', touchEvent([start], [start]));
    arena.dispatch('touchmove', touchEvent([endpoint], [endpoint]));
    arena.dispatch('touchend', touchEvent([], [endpoint]));

    expect(onDirection).toHaveBeenCalledOnce();
    expect(onDirection).toHaveBeenCalledWith('right');
    expect(arena.capturedPointers.size).toBe(0);
  });

  it.each(['pointercancel', 'lostpointercapture'])(
    'emits nothing and clears gesture state after %s',
    (cancelType) => {
      const arena = new FakePointerTarget();
      const onDirection = vi.fn();
      listenForSwipes(arena as unknown as HTMLElement, onDirection);

      arena.dispatch('pointerdown', pointerEvent({ clientX: 0, clientY: 0 }));
      arena.dispatch('pointermove', pointerEvent({ clientX: 60, clientY: 0 }));
      arena.dispatch(cancelType, pointerEvent());
      arena.dispatch('pointerup', pointerEvent({ clientX: 60, clientY: 0 }));

      expect(onDirection).not.toHaveBeenCalled();

      arena.dispatch(
        'pointerdown',
        pointerEvent({ pointerId: 2, clientX: 0, clientY: 0 }),
      );
      arena.dispatch(
        'pointerup',
        pointerEvent({ pointerId: 2, clientX: 0, clientY: 60 }),
      );
      expect(onDirection).toHaveBeenCalledOnce();
      expect(onDirection).toHaveBeenCalledWith('down');
    },
  );

  it('ignores secondary pointers and non-primary mouse buttons', () => {
    const arena = new FakePointerTarget();
    const onDirection = vi.fn();
    listenForSwipes(arena as unknown as HTMLElement, onDirection);

    arena.dispatch(
      'pointerdown',
      pointerEvent({ isPrimary: false, clientX: 0, clientY: 0 }),
    );
    arena.dispatch('pointerup', pointerEvent({ clientX: 60, clientY: 0 }));
    arena.dispatch(
      'pointerdown',
      pointerEvent({ pointerId: 2, button: 2, clientX: 0, clientY: 0 }),
    );
    arena.dispatch(
      'pointerup',
      pointerEvent({ pointerId: 2, clientX: 60, clientY: 0 }),
    );

    expect(onDirection).not.toHaveBeenCalled();
    expect(arena.capturedPointers.size).toBe(0);
  });
});

describe('input controller lifecycle', () => {
  it('forwards the original pause keyboard event through the controller', () => {
    const keyboardTarget = new FakeEventTarget();
    const arena = new FakePointerTarget(keyboardTarget);
    const { controls } = fakeTouchControls();
    const onPauseToggle = vi.fn();
    createInputController({
      keyboardTarget: keyboardTarget as unknown as Document,
      arena: arena as unknown as HTMLElement,
      touchControls: controls,
      onDirection: vi.fn(),
      onPauseToggle,
    });
    const event = keyboardEvent({ key: 'P' });

    keyboardTarget.dispatch('keydown', event);

    expect(onPauseToggle).toHaveBeenCalledWith(event);
  });

  it('normalizes D-pad activation and tears down every listener', () => {
    const keyboardTarget = new FakeEventTarget();
    const arena = new FakePointerTarget(keyboardTarget);
    const { controls, buttons } = fakeTouchControls();
    const onDirection = vi.fn();
    const teardown = createInputController({
      keyboardTarget: keyboardTarget as unknown as Document,
      arena: arena as unknown as HTMLElement,
      touchControls: controls,
      onDirection,
      onPauseToggle: vi.fn(),
    });

    const click = { preventDefault: vi.fn() };
    buttons.left.dispatch('click', click);
    expect(onDirection).toHaveBeenCalledOnce();
    expect(onDirection).toHaveBeenCalledWith('left');
    expect(click.preventDefault).toHaveBeenCalledOnce();

    expect(keyboardTarget.listenerCount()).toBe(3);
    expect(keyboardTarget.captureListenerCount('touchend')).toBe(1);
    expect(keyboardTarget.captureListenerCount('touchcancel')).toBe(1);
    expect(arena.listenerCount()).toBe(8);
    expect(
      Object.values(buttons).reduce(
        (count, button) => count + button.listenerCount(),
        0,
      ),
    ).toBeGreaterThan(0);

    arena.dispatch('pointerdown', pointerEvent({ pointerId: 42 }));
    expect(arena.capturedPointers).toEqual(new Set([42]));

    teardown();

    expect(keyboardTarget.listenerCount()).toBe(0);
    expect(arena.listenerCount()).toBe(0);
    expect(arena.capturedPointers.size).toBe(0);
    expect(
      Object.values(buttons).reduce(
        (count, button) => count + button.listenerCount(),
        0,
      ),
    ).toBe(0);

    buttons.left.dispatch('click', { preventDefault: vi.fn() });
    keyboardTarget.dispatch('keydown', keyboardEvent({ key: 'ArrowUp' }));
    const start = touch(21, 0, 0);
    const committed = touch(21, 60, 0);
    arena.dispatch('touchstart', touchEvent([start], [start]));
    arena.dispatch('touchmove', touchEvent([committed], [committed]));
    arena.dispatch('touchend', touchEvent([], [committed]));
    expect(onDirection).toHaveBeenCalledOnce();

    const teardownRemount = createInputController({
      keyboardTarget: keyboardTarget as unknown as Document,
      arena: arena as unknown as HTMLElement,
      touchControls: controls,
      onDirection,
      onPauseToggle: vi.fn(),
    });
    expect(keyboardTarget.listenerCount()).toBe(3);
    expect(keyboardTarget.captureListenerCount('touchend')).toBe(1);
    expect(keyboardTarget.captureListenerCount('touchcancel')).toBe(1);

    teardownRemount();

    expect(keyboardTarget.listenerCount()).toBe(0);
    expect(arena.listenerCount()).toBe(0);
  });
});
