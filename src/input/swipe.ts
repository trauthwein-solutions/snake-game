import type { Direction, GridPosition } from '../engine/model';

export const DEFAULT_SWIPE_MINIMUM_DISTANCE = 32;
export const DEFAULT_SWIPE_DOMINANCE_RATIO = 1.25;

interface SwipeOptions {
  readonly minimumDistance?: number;
  readonly dominanceRatio?: number;
}

interface ActivePointerGesture {
  readonly pointerId: number;
  readonly start: GridPosition;
}

interface ActiveTouchGesture {
  readonly identifier: number;
  readonly start: GridPosition;
}

function findTouch(touches: TouchList, identifier: number): Touch | null {
  for (let index = 0; index < touches.length; index += 1) {
    const touch = touches[index];
    if (touch?.identifier === identifier) {
      return touch;
    }
  }
  return null;
}

export function classifySwipe(
  start: GridPosition,
  end: GridPosition,
  {
    minimumDistance = DEFAULT_SWIPE_MINIMUM_DISTANCE,
    dominanceRatio = DEFAULT_SWIPE_DOMINANCE_RATIO,
  }: SwipeOptions = {},
): Direction | null {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const absoluteX = Math.abs(deltaX);
  const absoluteY = Math.abs(deltaY);

  if (absoluteX >= minimumDistance && absoluteX >= absoluteY * dominanceRatio) {
    return deltaX > 0 ? 'right' : 'left';
  }

  if (absoluteY >= minimumDistance && absoluteY >= absoluteX * dominanceRatio) {
    return deltaY > 0 ? 'down' : 'up';
  }

  return null;
}

export function listenForSwipes(
  arena: HTMLElement,
  onDirection: (direction: Direction) => void,
  options: SwipeOptions = {},
): () => void {
  const touchLifecycleTarget = arena.ownerDocument;
  let activePointerGesture: ActivePointerGesture | null = null;
  let activeTouchGesture: ActiveTouchGesture | null = null;
  let blockedTouchSequence = false;

  const releaseCapture = (pointerId: number): void => {
    if (arena.hasPointerCapture(pointerId)) {
      arena.releasePointerCapture(pointerId);
    }
  };

  const clearPointerGesture = (release = true): void => {
    const gesture = activePointerGesture;
    activePointerGesture = null;
    if (gesture !== null && release) {
      releaseCapture(gesture.pointerId);
    }
  };

  const handlePointerDown = (event: PointerEvent): void => {
    if (
      event.pointerType === 'touch' ||
      activePointerGesture !== null ||
      !event.isPrimary ||
      event.button !== 0
    ) {
      return;
    }

    activePointerGesture = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
    };
    arena.setPointerCapture(event.pointerId);
  };

  const handlePointerUp = (event: PointerEvent): void => {
    if (
      event.pointerType === 'touch' ||
      activePointerGesture?.pointerId !== event.pointerId
    ) {
      return;
    }

    const direction = classifySwipe(
      activePointerGesture.start,
      { x: event.clientX, y: event.clientY },
      options,
    );
    const pointerId = activePointerGesture.pointerId;
    activePointerGesture = null;
    releaseCapture(pointerId);

    if (direction !== null) {
      onDirection(direction);
    }
  };

  const handlePointerCancel = (event: PointerEvent): void => {
    if (
      event.pointerType !== 'touch' &&
      activePointerGesture?.pointerId === event.pointerId
    ) {
      clearPointerGesture();
    }
  };

  const handleLostPointerCapture = (event: PointerEvent): void => {
    if (
      event.pointerType !== 'touch' &&
      activePointerGesture?.pointerId === event.pointerId
    ) {
      clearPointerGesture(false);
    }
  };

  const blockTouchSequence = (touchesRemain: boolean): void => {
    activeTouchGesture = null;
    blockedTouchSequence = touchesRemain;
  };

  const handleTouchStart = (event: TouchEvent): void => {
    if (blockedTouchSequence) {
      return;
    }

    if (
      activeTouchGesture !== null ||
      event.touches.length !== 1 ||
      event.changedTouches.length !== 1
    ) {
      blockTouchSequence(event.touches.length > 0);
      return;
    }

    const touch = event.changedTouches[0];
    if (
      touch === undefined ||
      findTouch(event.touches, touch.identifier) === null
    ) {
      blockTouchSequence(event.touches.length > 0);
      return;
    }

    activeTouchGesture = {
      identifier: touch.identifier,
      start: { x: touch.clientX, y: touch.clientY },
    };
  };

  const handleTouchMove = (event: TouchEvent): void => {
    const gesture = activeTouchGesture;
    if (blockedTouchSequence || gesture === null) {
      return;
    }

    if (event.touches.length !== 1) {
      blockTouchSequence(event.touches.length > 0);
      return;
    }

    if (findTouch(event.touches, gesture.identifier) === null) {
      blockTouchSequence(event.touches.length > 0);
    }
  };

  const handleTouchEnd = (event: TouchEvent): void => {
    if (blockedTouchSequence) {
      if (event.touches.length === 0) {
        blockedTouchSequence = false;
      }
      return;
    }

    const gesture = activeTouchGesture;
    if (gesture === null) {
      return;
    }

    if (event.touches.length !== 0) {
      blockTouchSequence(true);
      return;
    }

    const endedTouch = findTouch(event.changedTouches, gesture.identifier);
    activeTouchGesture = null;
    if (endedTouch !== null) {
      const direction = classifySwipe(
        gesture.start,
        { x: endedTouch.clientX, y: endedTouch.clientY },
        options,
      );
      if (direction !== null) {
        onDirection(direction);
      }
    }
  };

  const handleTouchCancel = (event: TouchEvent): void => {
    if (activeTouchGesture !== null || blockedTouchSequence) {
      blockTouchSequence(event.touches.length > 0);
    }
  };

  const handleGlobalTouchCompletion = (event: TouchEvent): void => {
    if (blockedTouchSequence && event.touches.length === 0) {
      blockedTouchSequence = false;
    }
  };

  arena.addEventListener('pointerdown', handlePointerDown);
  arena.addEventListener('pointerup', handlePointerUp);
  arena.addEventListener('pointercancel', handlePointerCancel);
  arena.addEventListener('lostpointercapture', handleLostPointerCapture);
  arena.addEventListener('touchstart', handleTouchStart);
  arena.addEventListener('touchmove', handleTouchMove);
  arena.addEventListener('touchend', handleTouchEnd);
  arena.addEventListener('touchcancel', handleTouchCancel);
  touchLifecycleTarget.addEventListener(
    'touchend',
    handleGlobalTouchCompletion,
    true,
  );
  touchLifecycleTarget.addEventListener(
    'touchcancel',
    handleGlobalTouchCompletion,
    true,
  );

  return () => {
    clearPointerGesture();
    activeTouchGesture = null;
    blockedTouchSequence = false;
    arena.removeEventListener('pointerdown', handlePointerDown);
    arena.removeEventListener('pointerup', handlePointerUp);
    arena.removeEventListener('pointercancel', handlePointerCancel);
    arena.removeEventListener('lostpointercapture', handleLostPointerCapture);
    arena.removeEventListener('touchstart', handleTouchStart);
    arena.removeEventListener('touchmove', handleTouchMove);
    arena.removeEventListener('touchend', handleTouchEnd);
    arena.removeEventListener('touchcancel', handleTouchCancel);
    touchLifecycleTarget.removeEventListener(
      'touchend',
      handleGlobalTouchCompletion,
      true,
    );
    touchLifecycleTarget.removeEventListener(
      'touchcancel',
      handleGlobalTouchCompletion,
      true,
    );
  };
}
