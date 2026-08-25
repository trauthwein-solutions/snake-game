import type { AudioCue, GameAudio, GameAudioSnapshot } from './game-audio';
import { synthesizeGameAudio } from './synthesis';

interface AudioWindow {
  readonly AudioContext?: typeof AudioContext;
  readonly navigator?: Navigator;
}

const MUSIC_LEVEL = 0.22;
const EFFECTS_LEVEL = 0.32;

const isEligibleActivation = (
  activation: Event | undefined,
  navigator: Navigator | undefined,
): boolean => {
  if (activation?.isTrusted !== true) {
    return false;
  }

  if (navigator !== undefined && 'userActivation' in navigator) {
    return navigator.userActivation?.isActive === true;
  }

  return true;
};

const setGain = (node: GainNode | undefined, value: number): void => {
  try {
    if (node !== undefined) {
      node.gain.value = value;
    }
  } catch {
    // A closed or externally invalidated graph is already inaudible.
  }
};

const safeDisconnect = (node: AudioNode | undefined): void => {
  try {
    node?.disconnect();
  } catch {
    // Nodes may already have been disconnected by the user agent.
  }
};

const safeStop = (source: AudioBufferSourceNode | undefined): void => {
  try {
    source?.stop();
  } catch {
    // A stopped or not-yet-started source is already silent.
  }
};

export function createWebGameAudio(view: AudioWindow | undefined): GameAudio {
  let latest: GameAudioSnapshot = Object.freeze({
    status: 'ready',
    runId: 0,
    musicEnabled: true,
    soundEffectsEnabled: true,
  });
  let creationAttempted = false;
  let permanentlyUnavailable = false;
  let disposed = false;
  let context: AudioContext | undefined;
  let musicGain: GainNode | undefined;
  let effectsGain: GainNode | undefined;
  let musicSource: AudioBufferSourceNode | undefined;
  let currentEffect: AudioBufferSourceNode | undefined;
  let resumeInFlight: Promise<void> | undefined;
  let appliedRunId = latest.runId;
  let musicActivationPermitted = false;
  const buffers = new Map<AudioCue | 'music', AudioBuffer>();

  const stopCurrentEffect = (): void => {
    const source = currentEffect;
    if (source === undefined) {
      return;
    }
    currentEffect = undefined;
    source.onended = null;
    safeStop(source);
    safeDisconnect(source);
  };

  const reconcile = (): void => {
    const running = context?.state === 'running';
    setGain(
      musicGain,
      running &&
        latest.status === 'running' &&
        latest.musicEnabled &&
        musicActivationPermitted
        ? MUSIC_LEVEL
        : 0,
    );
    setGain(
      effectsGain,
      running && latest.soundEffectsEnabled ? EFFECTS_LEVEL : 0,
    );
  };

  const requestResume = (): void => {
    const resumeContext = context;
    if (
      disposed ||
      resumeContext === undefined ||
      resumeContext.state === 'running' ||
      resumeContext.state === 'closed' ||
      resumeInFlight !== undefined
    ) {
      return;
    }

    let result: Promise<void>;
    try {
      result = resumeContext.resume();
    } catch {
      return;
    }
    const pending = Promise.resolve(result).then(
      () => {
        if (
          !disposed &&
          context === resumeContext &&
          resumeInFlight === pending
        ) {
          resumeInFlight = undefined;
          reconcile();
        }
      },
      () => {
        if (context === resumeContext && resumeInFlight === pending) {
          resumeInFlight = undefined;
        }
      },
    );
    resumeInFlight = pending;
  };

  const initialize = (): void => {
    if (disposed || creationAttempted || permanentlyUnavailable) {
      return;
    }
    creationAttempted = true;
    const AudioContextConstructor = view?.AudioContext;
    if (AudioContextConstructor === undefined) {
      permanentlyUnavailable = true;
      return;
    }

    try {
      const createdContext = new AudioContextConstructor();
      context = createdContext;
      const waveforms = synthesizeGameAudio(createdContext.sampleRate);
      for (const [name, samples] of Object.entries(waveforms) as [
        keyof typeof waveforms,
        Float32Array,
      ][]) {
        const buffer = createdContext.createBuffer(
          1,
          samples.length,
          createdContext.sampleRate,
        );
        buffer.copyToChannel(new Float32Array(samples), 0);
        buffers.set(name, buffer);
      }

      musicGain = createdContext.createGain();
      effectsGain = createdContext.createGain();
      setGain(musicGain, 0);
      setGain(effectsGain, 0);
      musicGain.connect(createdContext.destination);
      effectsGain.connect(createdContext.destination);

      musicSource = createdContext.createBufferSource();
      musicSource.buffer = buffers.get('music') ?? null;
      musicSource.loop = true;
      musicSource.connect(musicGain);
      musicSource.start();
      appliedRunId = latest.runId;
      createdContext.onstatechange = () => {
        if (!disposed && context === createdContext) {
          if (createdContext.state !== 'running') {
            stopCurrentEffect();
          }
          reconcile();
        }
      };
      reconcile();
    } catch {
      permanentlyUnavailable = true;
      setGain(musicGain, 0);
      setGain(effectsGain, 0);
      safeStop(musicSource);
      safeDisconnect(musicSource);
      safeDisconnect(musicGain);
      safeDisconnect(effectsGain);
      if (context !== undefined) {
        context.onstatechange = null;
        try {
          void context.close().catch(() => undefined);
        } catch {
          // A failed constructor/graph remains permanently unavailable.
        }
      }
      context = undefined;
      musicGain = undefined;
      effectsGain = undefined;
      musicSource = undefined;
      buffers.clear();
    }
  };

  return {
    sync(nextSnapshot, activation) {
      if (disposed) {
        return;
      }
      latest = Object.freeze({ ...nextSnapshot });
      const eligibleActivation = isEligibleActivation(
        activation,
        view?.navigator,
      );
      if (!latest.musicEnabled) {
        musicActivationPermitted = false;
      } else if (eligibleActivation) {
        musicActivationPermitted = true;
      }

      if (eligibleActivation) {
        initialize();
        requestResume();
      }

      if (appliedRunId !== latest.runId || latest.status === 'ready') {
        stopCurrentEffect();
        appliedRunId = latest.runId;
      }
      if (!latest.soundEffectsEnabled) {
        stopCurrentEffect();
      }
      reconcile();
    },

    play(cue) {
      const playContext = context;
      if (
        disposed ||
        !latest.soundEffectsEnabled ||
        playContext?.state !== 'running'
      ) {
        return;
      }

      const buffer = buffers.get(cue);
      if (buffer === undefined || effectsGain === undefined) {
        return;
      }
      stopCurrentEffect();
      let candidate: AudioBufferSourceNode | undefined;
      try {
        const source = playContext.createBufferSource();
        candidate = source;
        source.buffer = buffer;
        source.connect(effectsGain);
        source.onended = () => {
          if (!disposed && currentEffect === source) {
            currentEffect = undefined;
            source.onended = null;
            safeDisconnect(source);
          }
        };
        source.start();
        currentEffect = source;
      } catch {
        if (candidate !== undefined) {
          candidate.onended = null;
          safeStop(candidate);
          safeDisconnect(candidate);
        }
      }
    },

    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      resumeInFlight = undefined;
      setGain(musicGain, 0);
      setGain(effectsGain, 0);
      if (context !== undefined) {
        context.onstatechange = null;
      }
      stopCurrentEffect();
      if (musicSource !== undefined) {
        musicSource.onended = null;
        safeStop(musicSource);
        safeDisconnect(musicSource);
      }
      safeDisconnect(musicGain);
      safeDisconnect(effectsGain);
      buffers.clear();
      const closingContext = context;
      context = undefined;
      musicSource = undefined;
      musicGain = undefined;
      effectsGain = undefined;
      if (closingContext !== undefined) {
        try {
          void closingContext.close().catch(() => undefined);
        } catch {
          // Closing is best-effort after synchronous silence.
        }
      }
    },
  };
}
