import { describe, expect, it, vi } from 'vitest';

import type { GameAudioSnapshot } from '../../src/audio/game-audio';
import { synthesizeGameAudio } from '../../src/audio/synthesis';
import { createWebGameAudio } from '../../src/audio/web-audio';
import { MUSIC_STYLES } from '../../src/storage/preferences';

describe('procedural audio synthesis', () => {
  it('is deterministic, finite, restrained, and silent at every boundary', () => {
    const first = synthesizeGameAudio(8_000);
    const second = synthesizeGameAudio(8_000);

    expect(Object.keys(first)).toEqual([
      'musicStyles',
      'food',
      'pause',
      'resume',
      'gameOver',
      'completed',
    ]);
    for (const name of [
      'food',
      'pause',
      'resume',
      'gameOver',
      'completed',
    ] as const) {
      const samples = first[name];
      expect(samples).toEqual(second[name]);
      expect(samples.length).toBeGreaterThan(100);
      expect(samples[0]).toBe(0);
      expect(samples.at(-1)).toBe(0);
      expect(samples.every(Number.isFinite)).toBe(true);
      expect(Math.max(...samples.map(Math.abs))).toBeLessThanOrEqual(0.35);
    }
    for (const style of MUSIC_STYLES) {
      const samples = first.musicStyles[style];
      expect(samples).toEqual(second.musicStyles[style]);
      expect(samples.length).toBeGreaterThan(100);
      expect(samples[0]).toBe(0);
      expect(samples.at(-1)).toBe(0);
      expect(samples.every(Number.isFinite)).toBe(true);
      expect(Math.max(...samples.map(Math.abs))).toBeLessThanOrEqual(0.25);
    }
  });

  it('creates four structurally distinct loop-safe music styles while sharing SFX', () => {
    const synthesized = synthesizeGameAudio(8_000);
    const signatures = MUSIC_STYLES.map((style) => {
      const samples = synthesized.musicStyles[style];
      return `${samples.length}:${Array.from(samples.slice(0, 512)).join(',')}`;
    });

    expect(new Set(signatures).size).toBe(4);
    expect(
      synthesized.musicStyles.minimalBeat.filter((sample) => sample === 0)
        .length,
    ).toBeGreaterThan(synthesized.musicStyles.minimalBeat.length / 4);
    expect(synthesized.food).toEqual(synthesizeGameAudio(8_000).food);
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
  musicStyle: 'neonPulse',
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

  it('initializes a persisted non-default style with exactly one loop source', () => {
    const { audio, contexts } = audioHarness();
    audio.sync(
      snapshot({ status: 'running', runId: 1, musicStyle: 'chillGrid' }),
      trustedActivation(),
    );

    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.sources).toHaveLength(1);
    expect(contexts[0]?.sources[0]?.start).toHaveBeenCalledOnce();
  });

  it('replaces a running music style exactly once without duplicating context or touching SFX', () => {
    const { audio, contexts } = audioHarness();
    audio.sync(snapshot({ status: 'running', runId: 1 }), trustedActivation());
    const context = contexts[0];
    if (context === undefined) throw new Error('Expected an AudioContext.');
    audio.play('food');
    const neon = context.sources[0];
    const food = context.sources[1];

    audio.sync(
      snapshot({ status: 'running', runId: 1, musicStyle: 'pixelDrift' }),
    );
    audio.sync(
      snapshot({ status: 'running', runId: 1, musicStyle: 'pixelDrift' }),
    );

    const pixel = context.sources[2];
    expect(contexts).toHaveLength(1);
    expect(context.sources).toHaveLength(3);
    expect(neon?.stop).toHaveBeenCalledOnce();
    expect(neon?.disconnect).toHaveBeenCalledOnce();
    expect(pixel).toMatchObject({ loop: true });
    expect(pixel?.start).toHaveBeenCalledOnce();
    expect(pixel?.buffer).not.toBe(neon?.buffer);
    expect(food?.stop).not.toHaveBeenCalled();
    expect(context.gains[0]?.gain.value).toBeGreaterThan(0);
  });

  it.each([
    {
      stage: 'createBufferSource',
      arrange(context: FakeContext) {
        context.createBufferSource.mockImplementationOnce(() => {
          throw new Error('source creation rejected');
        });
        return undefined;
      },
    },
    {
      stage: 'buffer assignment',
      arrange(context: FakeContext) {
        const candidate = new FakeSource();
        Object.defineProperty(candidate, 'buffer', {
          configurable: true,
          set() {
            throw new Error('buffer rejected');
          },
        });
        context.createBufferSource.mockImplementationOnce(() => candidate);
        return candidate;
      },
    },
    {
      stage: 'connect',
      arrange(context: FakeContext) {
        const candidate = new FakeSource();
        candidate.connect.mockImplementation(() => {
          throw new Error('connect rejected');
        });
        context.createBufferSource.mockImplementationOnce(() => candidate);
        return candidate;
      },
    },
  ])(
    'preserves the exact running music source when candidate $stage fails and retries later',
    ({ arrange }) => {
      const { audio, contexts } = audioHarness();
      audio.sync(
        snapshot({ status: 'running', runId: 1 }),
        trustedActivation(),
      );
      const context = contexts[0];
      if (context === undefined) throw new Error('Expected an AudioContext.');
      const original = context.sources[0];
      const candidate = arrange(context);
      const requested = snapshot({
        status: 'running',
        runId: 1,
        musicStyle: 'pixelDrift',
      });

      audio.sync(requested);

      expect(original?.stop).not.toHaveBeenCalled();
      expect(original?.disconnect).not.toHaveBeenCalled();
      expect(original?.onended).not.toBeNull();
      if (candidate !== undefined) {
        expect(candidate.stop).toHaveBeenCalledOnce();
        expect(candidate.disconnect).toHaveBeenCalledOnce();
        expect(candidate.onended).toBeNull();
      }

      audio.sync(requested);
      const replacement = context.sources.at(-1);
      expect(replacement).not.toBe(original);
      expect(replacement?.start).toHaveBeenCalledOnce();
      expect(replacement?.buffer).not.toBe(original?.buffer);
      expect(original?.stop).toHaveBeenCalledOnce();
      expect(original?.disconnect).toHaveBeenCalledOnce();
      if (candidate !== undefined) {
        expect(candidate.stop).toHaveBeenCalledOnce();
        expect(candidate.disconnect).toHaveBeenCalledOnce();
      }
    },
  );

  it('cleans a failed-start candidate, recovers the old style without overlap, and retries the requested style', () => {
    const { audio, contexts } = audioHarness();
    audio.sync(snapshot({ status: 'running', runId: 1 }), trustedActivation());
    const context = contexts[0];
    if (context === undefined) throw new Error('Expected an AudioContext.');
    const original = context.sources[0];
    const failedCandidate = new FakeSource();
    failedCandidate.start.mockImplementation(() => {
      throw new Error('start rejected');
    });
    context.createBufferSource.mockImplementationOnce(() => failedCandidate);
    const requested = snapshot({
      status: 'running',
      runId: 1,
      musicStyle: 'pixelDrift',
    });

    audio.sync(requested);

    const recovered = context.sources.at(-1);
    expect(original?.stop).toHaveBeenCalledOnce();
    expect(original?.disconnect).toHaveBeenCalledOnce();
    expect(failedCandidate.stop).toHaveBeenCalledOnce();
    expect(failedCandidate.disconnect).toHaveBeenCalledOnce();
    expect(recovered?.buffer).toBe(original?.buffer);
    expect(recovered?.start).toHaveBeenCalledOnce();
    expect(original?.stop.mock.invocationCallOrder[0]).toBeLessThan(
      failedCandidate.start.mock.invocationCallOrder[0] ?? 0,
    );
    expect(failedCandidate.stop.mock.invocationCallOrder[0]).toBeLessThan(
      recovered?.start.mock.invocationCallOrder[0] ?? 0,
    );

    audio.sync(requested);
    const replacement = context.sources.at(-1);
    expect(recovered?.stop).toHaveBeenCalledOnce();
    expect(recovered?.disconnect).toHaveBeenCalledOnce();
    expect(replacement?.buffer).not.toBe(original?.buffer);
    expect(replacement?.start).toHaveBeenCalledOnce();
  });

  it('leaves music ownership empty when requested start and old-style recovery both fail, then retries', () => {
    const { audio, contexts } = audioHarness();
    audio.sync(snapshot({ status: 'running', runId: 1 }), trustedActivation());
    const context = contexts[0];
    if (context === undefined) throw new Error('Expected an AudioContext.');
    const original = context.sources[0];
    const failures = [new FakeSource(), new FakeSource()];
    for (const source of failures) {
      source.start.mockImplementation(() => {
        throw new Error('start rejected');
      });
      context.createBufferSource.mockImplementationOnce(() => source);
    }
    const requested = snapshot({
      status: 'running',
      runId: 1,
      musicStyle: 'pixelDrift',
    });

    audio.sync(requested);

    expect(original?.stop).toHaveBeenCalledOnce();
    for (const source of failures) {
      expect(source.stop).toHaveBeenCalledOnce();
      expect(source.disconnect).toHaveBeenCalledOnce();
    }

    audio.sync(requested);
    const replacement = context.sources.at(-1);
    expect(replacement?.buffer).not.toBe(original?.buffer);
    expect(replacement?.start).toHaveBeenCalledOnce();
  });

  it('recreates the latest requested style once when the exact current music source ends', () => {
    const { audio, contexts } = audioHarness();
    audio.sync(snapshot({ status: 'running', runId: 1 }), trustedActivation());
    const context = contexts[0];
    if (context === undefined) throw new Error('Expected an AudioContext.');
    const ended = context.sources[0];
    const onended = ended?.onended;

    expect(onended).not.toBeNull();
    onended?.();

    const recovered = context.sources[1];
    expect(ended?.stop).not.toHaveBeenCalled();
    expect(ended?.disconnect).toHaveBeenCalledOnce();
    expect(ended?.onended).toBeNull();
    expect(recovered?.buffer).toBe(ended?.buffer);
    expect(recovered?.start).toHaveBeenCalledOnce();
  });

  it('ignores a stale music onended callback after style replacement', () => {
    const { audio, contexts } = audioHarness();
    audio.sync(snapshot({ status: 'running', runId: 1 }), trustedActivation());
    const context = contexts[0];
    if (context === undefined) throw new Error('Expected an AudioContext.');
    const old = context.sources[0];
    const staleOnEnded = old?.onended;
    audio.sync(
      snapshot({ status: 'running', runId: 1, musicStyle: 'pixelDrift' }),
    );
    const current = context.sources[1];

    staleOnEnded?.();

    expect(context.sources).toHaveLength(2);
    expect(current?.stop).not.toHaveBeenCalled();
    expect(current?.disconnect).not.toHaveBeenCalled();
  });

  it('neutralizes a retained music onended callback during disposal', () => {
    const { audio, contexts } = audioHarness();
    audio.sync(snapshot({ status: 'running' }), trustedActivation());
    const context = contexts[0];
    if (context === undefined) throw new Error('Expected an AudioContext.');
    const music = context.sources[0];
    const retainedOnEnded = music?.onended;

    audio.dispose();
    retainedOnEnded?.();

    expect(music?.onended).toBeNull();
    expect(music?.stop).toHaveBeenCalledOnce();
    expect(music?.disconnect).toHaveBeenCalledOnce();
    expect(context.sources).toHaveLength(1);
  });

  it('keeps muted style changes silent and reveals only the selected style when enabled', () => {
    const { audio, contexts } = audioHarness();
    audio.sync(
      snapshot({ status: 'running', runId: 1, musicEnabled: false }),
      trustedActivation(),
    );
    const context = contexts[0];
    if (context === undefined) throw new Error('Expected an AudioContext.');
    const neon = context.sources[0];

    audio.sync(
      snapshot({
        status: 'running',
        runId: 1,
        musicEnabled: false,
        musicStyle: 'chillGrid',
      }),
    );
    const chill = context.sources[1];
    expect(context.gains[0]?.gain.value).toBe(0);
    expect(neon?.stop).toHaveBeenCalledOnce();
    expect(chill?.buffer).not.toBe(neon?.buffer);

    audio.sync(
      snapshot({ status: 'running', runId: 1, musicStyle: 'chillGrid' }),
      trustedActivation(),
    );
    expect(context.sources).toHaveLength(2);
    expect(chill?.stop).not.toHaveBeenCalled();
    expect(context.gains[0]?.gain.value).toBeGreaterThan(0);
  });

  it('keeps the latest style authoritative across a delayed suspended resume and disposal', async () => {
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

    audio.sync(
      snapshot({ status: 'running', runId: 1, musicStyle: 'pixelDrift' }),
    );
    audio.sync(
      snapshot({ status: 'paused', runId: 1, musicStyle: 'chillGrid' }),
    );
    const latestSource = context.sources.at(-1);
    expect(context.sources).toHaveLength(3);
    expect(context.gains[0]?.gain.value).toBe(0);

    context.state = 'running';
    resolveResume();
    await flushMicrotasks();
    expect(context.gains[0]?.gain.value).toBe(0);
    expect(latestSource?.stop).not.toHaveBeenCalled();

    audio.dispose();
    expect(latestSource?.stop).toHaveBeenCalledOnce();
    expect(
      context.sources
        .slice(0, -1)
        .every((source) => source.stop.mock.calls.length === 1),
    ).toBe(true);
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
