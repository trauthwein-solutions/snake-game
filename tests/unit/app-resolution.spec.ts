import { afterEach, describe, expect, it, vi } from 'vitest';

const presentationLoop = vi.hoisted(() => ({
  redraw: vi.fn(),
  stop: vi.fn(),
  syncMotionPreference: vi.fn(),
}));

const inputController = vi.hoisted(() => ({
  teardown: vi.fn(),
}));

vi.mock('../../src/rendering/canvas-renderer', () => ({
  renderGameFrame: vi.fn(),
}));

vi.mock('../../src/rendering/presentation-loop', () => ({
  createPresentationLoop: vi.fn(() => presentationLoop),
}));

vi.mock('../../src/input/input-controller', () => ({
  createInputController: vi.fn(() => inputController.teardown),
}));

import { mountApp } from '../../src/app';

type EventListener = () => void;

class FakeMediaQueryList {
  readonly listeners = new Set<EventListener>();
  matches: boolean;

  constructor(
    readonly media: string,
    matches = false,
  ) {
    this.matches = matches;
  }

  addEventListener(type: string, listener: EventListener): void {
    if (type === 'change') {
      this.listeners.add(listener);
    }
  }

  removeEventListener(type: string, listener: EventListener): void {
    if (type === 'change') {
      this.listeners.delete(listener);
    }
  }

  dispatchChange(): void {
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

class FakeElement {
  className = '';
  dataset: Record<string, string> = {};
  id = '';
  innerHTML = '';
  readonly children: FakeElement[] = [];
  readonly eventListeners = new Map<string, Set<EventListener>>();

  constructor(
    readonly tagName: string,
    readonly ownerDocument: FakeDocument,
  ) {}

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.eventListeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.eventListeners.set(type, listeners);
  }

  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  close(): void {}

  focus(): void {}

  querySelector(selector: string): FakeElement | null {
    if (this.tagName === 'main') {
      if (selector === '[data-hud]') {
        return this.ownerDocument.hudMount;
      }
      if (selector === '[data-action="settings"]') {
        return this.ownerDocument.settingsButton;
      }
      if (selector === '[data-render-target="arena"]') {
        return this.ownerDocument.canvas;
      }
      if (selector === '[data-touch-controls]') {
        return this.ownerDocument.touchControlsMount;
      }
    }
    if (this.tagName === 'dialog') {
      if (selector === '.icon-button') {
        return this.ownerDocument.closeButton;
      }
      if (selector === 'input') {
        return this.ownerDocument.firstControl;
      }
    }
    return null;
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.splice(0, this.children.length, ...children);
  }

  replaceWith(): void {}

  setAttribute(): void {}

  showModal(): void {}
}

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly disconnect = vi.fn();
  readonly observe = vi.fn();

  constructor(readonly callback: EventListener) {
    FakeResizeObserver.instances.push(this);
  }
}

class FakeView {
  devicePixelRatio = 1;
  readonly eventListeners = new Map<string, Set<EventListener>>();
  readonly mediaQueries: FakeMediaQueryList[] = [];
  readonly ResizeObserver = FakeResizeObserver;
  readonly cancelAnimationFrame = vi.fn();
  readonly requestAnimationFrame = vi.fn();

  readonly matchMedia = vi.fn((media: string) => {
    const query = new FakeMediaQueryList(
      media,
      media === '(prefers-reduced-motion: reduce)',
    );
    this.mediaQueries.push(query);
    return query;
  });

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.eventListeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.eventListeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.eventListeners.get(type)?.delete(listener);
  }

  dispatch(type: string): void {
    for (const listener of [...(this.eventListeners.get(type) ?? [])]) {
      listener();
    }
  }
}

class FakeDocument {
  readonly defaultView = new FakeView();
  readonly hudMount = new FakeElement('div', this);
  readonly settingsButton = new FakeElement('button', this);
  readonly canvas = new FakeElement('canvas', this);
  readonly touchControlsMount = new FakeElement('div', this);
  readonly closeButton = new FakeElement('button', this);
  readonly firstControl = new FakeElement('input', this);

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName, this);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  FakeResizeObserver.instances = [];
});

describe('mountApp resolution lifecycle', () => {
  it('redraws and re-arms for DPR changes, without duplicating or leaking listeners', () => {
    const document = new FakeDocument();
    const root = new FakeElement('div', document);
    vi.stubGlobal('document', document);

    const unmount = mountApp(root as unknown as HTMLElement);
    const reducedMotionQuery = document.defaultView.mediaQueries.find(
      (query) => query.media === '(prefers-reduced-motion: reduce)',
    );
    const resolutionQuery = document.defaultView.mediaQueries.find((query) =>
      query.media.startsWith('(resolution:'),
    );

    expect(reducedMotionQuery?.listeners.size).toBe(1);
    expect(resolutionQuery?.media).toBe('(resolution: 1dppx)');
    expect(document.defaultView.eventListeners.get('resize')?.size).toBe(1);

    document.defaultView.devicePixelRatio = 2;
    document.defaultView.dispatch('resize');
    expect(presentationLoop.redraw).toHaveBeenCalledTimes(1);

    const rearmedQuery = document.defaultView.mediaQueries.at(-1);
    expect(rearmedQuery?.media).toBe('(resolution: 2dppx)');
    expect(resolutionQuery?.listeners.size).toBe(0);
    expect(document.defaultView.eventListeners.get('resize')?.size).toBe(1);

    document.defaultView.devicePixelRatio = 3;
    rearmedQuery?.dispatchChange();
    expect(presentationLoop.redraw).toHaveBeenCalledTimes(2);
    expect(rearmedQuery?.listeners.size).toBe(0);
    expect(document.defaultView.mediaQueries.at(-1)?.media).toBe(
      '(resolution: 3dppx)',
    );

    document.defaultView.dispatch('resize');
    expect(presentationLoop.redraw).toHaveBeenCalledTimes(3);

    const activeResolutionQuery = document.defaultView.mediaQueries.at(-1);
    unmount();
    document.defaultView.dispatch('resize');
    activeResolutionQuery?.dispatchChange();

    expect(presentationLoop.redraw).toHaveBeenCalledTimes(3);
    expect(document.defaultView.eventListeners.get('resize')?.size).toBe(0);
    expect(activeResolutionQuery?.listeners.size).toBe(0);
    expect(reducedMotionQuery?.listeners.size).toBe(0);
    expect(FakeResizeObserver.instances[0]?.disconnect).toHaveBeenCalledOnce();
    expect(presentationLoop.stop).toHaveBeenCalledOnce();
    expect(inputController.teardown).toHaveBeenCalledOnce();
  });
});
