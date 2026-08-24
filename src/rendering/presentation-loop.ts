export interface PresentationLoopOptions {
  readonly cancelAnimationFrame?: (frameId: number) => void;
  readonly prefersReducedMotion: () => boolean;
  readonly render: (timestampMs: number, reducedMotion: boolean) => void;
  readonly requestAnimationFrame?: (callback: FrameRequestCallback) => number;
}

export interface PresentationLoop {
  readonly redraw: () => void;
  readonly stop: () => void;
  readonly syncMotionPreference: () => void;
}

export const createPresentationLoop = (
  options: PresentationLoopOptions,
): PresentationLoop => {
  let animationFrameId: number | undefined;
  let stopped = false;

  const cancelAnimation = (): void => {
    if (animationFrameId !== undefined) {
      options.cancelAnimationFrame?.(animationFrameId);
      animationFrameId = undefined;
    }
  };

  const requestNextFrame = (): void => {
    if (
      stopped ||
      options.prefersReducedMotion() ||
      animationFrameId !== undefined ||
      options.requestAnimationFrame === undefined
    ) {
      return;
    }

    animationFrameId = options.requestAnimationFrame((timestampMs) => {
      animationFrameId = undefined;
      if (stopped || options.prefersReducedMotion()) {
        return;
      }
      options.render(timestampMs, false);
      requestNextFrame();
    });
  };

  const syncMotionPreference = (): void => {
    if (stopped) {
      return;
    }
    if (options.prefersReducedMotion()) {
      cancelAnimation();
      options.render(0, true);
      return;
    }
    options.render(0, false);
    requestNextFrame();
  };

  const redraw = (): void => {
    if (stopped) {
      return;
    }
    if (options.prefersReducedMotion()) {
      options.render(0, true);
      return;
    }
    requestNextFrame();
  };

  const stop = (): void => {
    stopped = true;
    cancelAnimation();
  };

  syncMotionPreference();
  return { redraw, stop, syncMotionPreference };
};
