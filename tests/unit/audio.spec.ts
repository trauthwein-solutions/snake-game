import { describe, expect, it, vi } from 'vitest';

import type { GameAudioSnapshot } from '../../src/audio/game-audio';
import { synthesizeGameAudio } from '../../src/audio/synthesis';
import { createWebGameAudio } from '../../src/audio/web-audio';

describe('procedural audio synthesis', () => {
  it('is deterministic, finite, restrained, and silent at every boundary', () => {
    const first = synthesizeGameAudio(8_000);
    const second = synthesizeGameAudio(8_000);

    expect(Object.keys(first)).toEqual([
      'music',
      'food',
      'pause',
      'resume',
      'gameOver',
      'completed',
    ]);
    for (const name of Object.keys(first) as (keyof typeof first)[]) {
      const samples = first[name];
      expect(samples).toEqual(second[name]);
      expect(samples.length).toBeGreaterThan(100);
      expect(samples[0]).toBe(0);
      expect(samples.at(-1)).toBe(0);
      expect(samples.every(Number.isFinite)).toBe(true);
      expect(Math.max(...samples.map(Math.abs))).toBeLessThanOrEqual(0.35);
    }
  });

  it('gives every cue a distinct waveform', () => {
    const synthesized = synthesizeGameAudio(8_000);
    const signatures = (
      ['food', 'pause', 'resume', 'gameOver', 'completed'] as const
    ).map((cue) => Array.from(synthesized[cue].slice(0, 256)).join(','));

    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it('rejects unusable sample rates rather than producing invalid samples', () => {
    expect(() => synthesizeGameAudio(0)).toThrow(RangeError);
    expect(() => synthesizeGameAudio(Number.NaN)).toThrow(RangeError);
  });
});

class FakeGain {
  readonly gain = { value: 0 };
  readonly connect = vi.fn();
  readonly disconnect = vi.fn();
}

class FakeSource {
  buffer: AudioBuffer | null = null;
  loop = false;
  onended: (() => void) | null = null;
  readonly connect = vi.fn();
  readonly disconnect = vi.fn();
  readonly start = vi.fn();
  readonly stop = vi.fn();
}

class FakeBuffer {
  readonly samples: Float32Array;

  constructor(length: number) {
    this.samples = new Float32Array(length);
  }

  copyToChannel(source: Float32Array): void {
    this.samples.set(source);
  }
}

class FakeContext {
  state: AudioContextState = 'running';
  sampleRate = 8_000;
  currentTime = 0;
  readonly destination = {} as AudioDestinationNode;
  onstatechange: (() => void) | null = null;
  readonly gains: FakeGain[] = [];
  readonly sources: FakeSource[] = [];
  readonly createBuffer = vi.fn(
    (_channels: number, length: number) => new FakeBuffer(length),
  );
  readonly createGain = vi.fn(() => {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  });
  readonly createBufferSource = vi.fn(() => {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  });
  readonly close = vi.fn(() => Promise.resolve());
  resume = vi.fn(() => Promise.resolve());
}

const snapshot = (
  overrides: Partial<GameAudioSnapshot> = {},
): GameAudioSnapshot => ({
  status: 'ready',
  runId: 0,
  musicEnabled: true,
  soundEffectsEnabled: true,
  ...overrides,
});

const trustedActivation = (type = 'click'): Event =>
  ({ type, isTrusted: true }) as Event;
const untrustedActivation = (type = 'click'): Event =>
  ({ type, isTrusted: false }) as Event;

function audioHarness(
  options: {
    readonly state?: AudioContextState;
    readonly userActivation?: boolean | 'absent';
    readonly resume?: () => Promise<void>;
  } = {},
) {
  const contexts: FakeContext[] = [];
  const AudioContext = class extends FakeContext {
    constructor() {
      super();
      this.state = options.state ?? 'running';
      if (options.resume !== undefined) {
        this.resume.mockImplementation(options.resume);
      }
      contexts.push(this);
    }
  };
  const navigator =
    options.userActivation === 'absent'
      ? {}
      : { userActivation: { isActive: options.userActivation ?? true } };
  const audio = createWebGameAudio({
    AudioContext: AudioContext as unknown as typeof window.AudioContext,
    navigator: navigator as Navigator,
  });
  return { audio, contexts };
}

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('Web Audio lifecycle', () => {
  it('creates no context or nodes before eligible trusted activation', () => {
    const inactive = audioHarness({ userActivation: false });

    inactive.audio.sync(snapshot({ status: 'running' }));
    inactive.audio.play('food');
    inactive.audio.play('gameOver');
    inactive.audio.sync(snapshot({ status: 'running' }), untrustedActivation());
    inactive.audio.sync(snapshot({ status: 'running' }), trustedActivation());

    expect(inactive.contexts).toHaveLength(0);

    const fallback = audioHarness({ userActivation: 'absent' });
    fallback.audio.sync(snapshot({ status: 'running' }), trustedActivation());
    expect(fallback.contexts).toHaveLength(1);
    expect(fallback.contexts[0]?.sources).toHaveLength(1);
  });

  it('creates one context and one looping music source under rapid transitions', () => {
    const { audio, contexts } = audioHarness();
    const activation = trustedActivation();

    audio.sync(snapshot({ status: 'running', runId: 1 }), activation);
    audio.sync(snapshot({ status: 'paused', runId: 1 }), activation);
    audio.sync(snapshot({ status: 'running', runId: 1 }), activation);
    audio.sync(snapshot({ status: 'running', runId: 2 }), activation);

    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.sources).toHaveLength(1);
    expect(contexts[0]?.sources[0]).toMatchObject({ loop: true });
    expect(contexts[0]?.sources[0]?.start).toHaveBeenCalledOnce();
  });

  it('deduplicates suspended resumes and cannot unmute after delayed pause/music-off', async () => {
    let resolveResume!: () => void;
    const resumeResult = new Promise<void>((resolve) => {
      resolveResume = resolve;
    });
    const { audio, contexts } = audioHarness({
      state: 'suspended',
      resume: () => resumeResult,
    });

    audio.sync(snapshot({ status: 'running', runId: 1 }), trustedActivation());
    const context = contexts[0];
    if (context === undefined) throw new Error('Expected an AudioContext.');
    audio.sync(snapshot({ status: 'running', runId: 1 }), trustedActivation());
    audio.sync(
      snapshot({ status: 'paused', runId: 1, musicEnabled: false }),
      trustedActivation(),
    );

    expect(context.resume).toHaveBeenCalledOnce();
    expect(context.gains[0]?.gain.value).toBe(0);

    context.state = 'running';
    resolveResume();
    await flushMicrotasks();

    expect(context.gains[0]?.gain.value).toBe(0);
  });

  it('swallows resume rejection and retries the same context on later activation', async () => {
    const resume = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('blocked'))
      .mockResolvedValue(undefined);
    const { audio, contexts } = audioHarness({
      state: 'suspended',
      resume,
    });

    audio.sync(snapshot({ status: 'running' }), trustedActivation());
    const context = contexts[0];
    if (context === undefined) throw new Error('Expected an AudioContext.');
    await flushMicrotasks();

    audio.sync(snapshot({ status: 'running' }), trustedActivation());
    await flushMicrotasks();

    expect(contexts).toHaveLength(1);
    expect(context.resume).toHaveBeenCalledTimes(2);
  });

  it('degrades permanently when AudioContext is missing or throws', () => {
    const missing = createWebGameAudio({ navigator: {} as Navigator });
    expect(() =>
      missing.sync(snapshot({ status: 'running' }), trustedActivation()),
    ).not.toThrow();
    expect(() => missing.play('food')).not.toThrow();

    const constructor = vi.fn(() => {
      throw new Error('unavailable');
    });
    const throwing = createWebGameAudio({
      AudioContext: constructor as unknown as typeof window.AudioContext,
      navigator: {} as Navigator,
    });
    throwing.sync(snapshot({ status: 'running' }), trustedActivation());
    throwing.sync(snapshot({ status: 'running' }), trustedActivation());

    expect(constructor).toHaveBeenCalledOnce();
  });

  it('mutes on external suspension/interruption and only reconciles when the UA runs it', () => {
    const { audio, contexts } = audioHarness();
    audio.sync(snapshot({ status: 'running', runId: 1 }), trustedActivation());
    const context = contexts[0];
    if (context === undefined) throw new Error('Expected an AudioContext.');
    expect(context.gains[0]?.gain.value).toBeGreaterThan(0);
    audio.play('food');
    const effect = context.sources[1];

    context.state = 'suspended';
    context.onstatechange?.();
    context.state = 'interrupted' as AudioContextState;
    context.onstatechange?.();
    expect(context.gains[0]?.gain.value).toBe(0);
    expect(context.resume).not.toHaveBeenCalled();
    expect(effect?.stop).toHaveBeenCalledOnce();

    context.state = 'running';
    context.onstatechange?.();
    expect(context.gains[0]?.gain.value).toBeGreaterThan(0);
  });

  it('keeps music and effects independent and applies toggles immediately', () => {
    const { audio, contexts } = audioHarness();
    audio.sync(snapshot({ status: 'running', runId: 1 }), trustedActivation());
    const context = contexts[0];
    if (context === undefined) throw new Error('Expected an AudioContext.');

    audio.play('food');
    const food = context.sources[1];
    expect(food?.start).toHaveBeenCalledOnce();

    audio.sync(snapshot({ status: 'running', runId: 1, musicEnabled: false }));
    expect(context.gains[0]?.gain.value).toBe(0);
    expect(food?.stop).not.toHaveBeenCalled();

    const musicOn = snapshot({
      status: 'running',
      runId: 1,
      musicEnabled: true,
      soundEffectsEnabled: false,
    });
    audio.sync(musicOn);
    expect(context.gains[0]?.gain.value).toBe(0);
    expect(food?.stop).toHaveBeenCalledOnce();
    audio.play('resume');
    expect(context.sources).toHaveLength(2);

    audio.sync(musicOn, trustedActivation());
    expect(context.gains[0]?.gain.value).toBeGreaterThan(0);

    audio.sync(
      snapshot({ status: 'running', runId: 1, soundEffectsEnabled: true }),
    );
    expect(context.sources).toHaveLength(2);
    audio.play('resume');
    expect(context.sources).toHaveLength(3);
  });

  it('replaces the current effect and ignores stale onended callbacks', () => {
    const { audio, contexts } = audioHarness();
    audio.sync(snapshot({ status: 'running' }), trustedActivation());
    const context = contexts[0];
    if (context === undefined) throw new Error('Expected an AudioContext.');

    audio.play('food');
    const food = context.sources[1];
    const staleOnEnded = food?.onended;
    audio.play('pause');
    const pause = context.sources[2];

    expect(food?.stop).toHaveBeenCalledOnce();
    expect(food?.disconnect).toHaveBeenCalledOnce();
    staleOnEnded?.();
    expect(pause?.disconnect).not.toHaveBeenCalled();

    pause?.onended?.();
    expect(pause?.disconnect).toHaveBeenCalledOnce();
  });

  it.each([
    {
      stage: 'buffer assignment',
      breakSource(source: FakeSource) {
        Object.defineProperty(source, 'buffer', {
          configurable: true,
          set() {
            throw new Error('buffer rejected');
          },
        });
      },
    },
    {
      stage: 'connect',
      breakSource(source: FakeSource) {
        source.connect.mockImplementation(() => {
          throw new Error('connect rejected');
        });
      },
    },
    {
      stage: 'start',
      breakSource(source: FakeSource) {
        source.start.mockImplementation(() => {
          throw new Error('start rejected');
        });
      },
    },
  ])(
    'cleans a partial effect exactly once when $stage throws',
    ({ breakSource }) => {
      const { audio, contexts } = audioHarness();
      audio.sync(snapshot({ status: 'running' }), trustedActivation());
      const context = contexts[0];
      if (context === undefined) throw new Error('Expected an AudioContext.');
      const failedSource = new FakeSource();
      breakSource(failedSource);
      context.createBufferSource.mockImplementationOnce(() => failedSource);

      audio.play('food');

      expect(failedSource.stop).toHaveBeenCalledOnce();
      expect(failedSource.disconnect).toHaveBeenCalledOnce();
      expect(failedSource.onended).toBeNull();

      audio.play('pause');
      const replacement = context.sources.at(-1);
      expect(replacement).not.toBe(failedSource);
      expect(replacement?.start).toHaveBeenCalledOnce();
      expect(failedSource.stop).toHaveBeenCalledOnce();
      expect(failedSource.disconnect).toHaveBeenCalledOnce();
    },
  );

  it('disposes exactly once and neutralizes retained async callbacks', async () => {
    let resolveResume!: () => void;
    const resumeResult = new Promise<void>((resolve) => {
      resolveResume = resolve;
    });
    const { audio, contexts } = audioHarness({
      state: 'suspended',
      resume: () => resumeResult,
    });

    audio.sync(snapshot({ status: 'running' }), trustedActivation());
    const context = contexts[0];
    if (context === undefined) throw new Error('Expected an AudioContext.');
    audio.sync(snapshot({ status: 'running' }), trustedActivation());
    context.state = 'running';
    audio.play('gameOver');
    const music = context.sources[0];
    const effect = context.sources[1];
    const retainedStateChange = context.onstatechange;
    const retainedOnEnded = effect?.onended;
    context.close.mockRejectedValueOnce(new Error('close blocked'));

    audio.dispose();
    audio.dispose();

    expect(context.gains.every(({ gain }) => gain.value === 0)).toBe(true);
    expect(music?.stop).toHaveBeenCalledOnce();
    expect(effect?.stop).toHaveBeenCalledOnce();
    expect(
      context.gains.every(
        ({ disconnect }) => disconnect.mock.calls.length === 1,
      ),
    ).toBe(true);
    expect(context.close).toHaveBeenCalledOnce();
    expect(context.onstatechange).toBeNull();
    expect(effect?.onended).toBeNull();

    retainedStateChange?.();
    retainedOnEnded?.();
    resolveResume();
    await flushMicrotasks();
    expect(context.gains.every(({ gain }) => gain.value === 0)).toBe(true);
    expect(context.sources).toHaveLength(2);
  });
});
