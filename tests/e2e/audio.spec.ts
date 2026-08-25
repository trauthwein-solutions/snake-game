import { expect, test as playwrightTest, type Page } from '@playwright/test';

const test = (
  import.meta.env?.MODE === 'test' ? () => undefined : playwrightTest
) as typeof playwrightTest;

function sourceFixtureTest(
  title: string,
  body: (fixtures: { page: Page }) => Promise<void>,
): void {
  test(title, { tag: '@source-fixture' }, body);
}

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

interface AudioDiagnostics {
  readonly supported: boolean;
  readonly userActivationRemoved: boolean;
  readonly contextCount: number;
  readonly contextStates: readonly AudioContextState[];
  readonly sourceCount: number;
  readonly musicStartCount: number;
  readonly activeMusicCount: number;
  readonly maxActiveMusicCount: number;
  readonly activeEffectCount: number;
  readonly maxActiveEffectCount: number;
  readonly closeCount: number;
  readonly resumeCount: number;
  readonly gainValues: readonly number[];
}

async function installAudioDiagnostics(
  page: Page,
  options: { readonly removeUserActivation?: boolean } = {},
): Promise<void> {
  await page.addInitScript(({ removeUserActivation }) => {
    const userActivationRemoved =
      removeUserActivation === true &&
      Reflect.deleteProperty(Navigator.prototype, 'userActivation') &&
      !('userActivation' in navigator);
    const NativeAudioContext = window.AudioContext;
    const data = {
      supported: NativeAudioContext !== undefined,
      userActivationRemoved,
      contextCount: 0,
      sourceCount: 0,
      musicStartCount: 0,
      activeMusicCount: 0,
      maxActiveMusicCount: 0,
      activeEffectCount: 0,
      maxActiveEffectCount: 0,
      closeCount: 0,
      resumeCount: 0,
      contexts: [] as AudioContext[],
      gains: [] as GainNode[],
    };
    Object.defineProperty(window, '__snakishAudioDiagnostics', {
      configurable: true,
      value: data,
    });
    if (NativeAudioContext === undefined) return;

    const InstrumentedAudioContext = new Proxy(NativeAudioContext, {
      construct(target, argumentsList) {
        const nativeContext = Reflect.construct(
          target,
          argumentsList,
        ) as AudioContext;
        data.contextCount += 1;
        data.contexts.push(nativeContext);
        return new Proxy(nativeContext, {
          get(context, property) {
            if (property === 'createGain') {
              return () => {
                const gain = context.createGain();
                data.gains.push(gain);
                return gain;
              };
            }
            if (property === 'createBufferSource') {
              return () => {
                const nativeSource = context.createBufferSource();
                data.sourceCount += 1;
                let activeSource: 'effect' | 'music' | undefined;
                const markEnded = (): void => {
                  if (activeSource === 'music') {
                    data.activeMusicCount -= 1;
                  } else if (activeSource === 'effect') {
                    data.activeEffectCount -= 1;
                  }
                  activeSource = undefined;
                };
                return new Proxy(nativeSource, {
                  get(source, sourceProperty) {
                    const value = Reflect.get(
                      source,
                      sourceProperty,
                      source,
                    ) as unknown;
                    if (typeof value !== 'function') return value;
                    if (sourceProperty === 'start') {
                      return (...args: unknown[]) => {
                        const result = Reflect.apply(value, source, args);
                        if (source.loop) {
                          data.musicStartCount += 1;
                          data.activeMusicCount += 1;
                          data.maxActiveMusicCount = Math.max(
                            data.maxActiveMusicCount,
                            data.activeMusicCount,
                          );
                          activeSource = 'music';
                        } else {
                          data.activeEffectCount += 1;
                          data.maxActiveEffectCount = Math.max(
                            data.maxActiveEffectCount,
                            data.activeEffectCount,
                          );
                          activeSource = 'effect';
                        }
                        return result;
                      };
                    }
                    if (sourceProperty === 'stop') {
                      return (...args: unknown[]) => {
                        const result = Reflect.apply(value, source, args);
                        markEnded();
                        return result;
                      };
                    }
                    return (...args: unknown[]) =>
                      Reflect.apply(value, source, args);
                  },
                  set(source, propertyName, value) {
                    if (
                      propertyName === 'onended' &&
                      typeof value === 'function'
                    ) {
                      return Reflect.set(
                        source,
                        propertyName,
                        (...args: unknown[]) => {
                          markEnded();
                          return Reflect.apply(value, source, args);
                        },
                        source,
                      );
                    }
                    return Reflect.set(source, propertyName, value, source);
                  },
                });
              };
            }
            const value = Reflect.get(context, property, context) as unknown;
            if (typeof value !== 'function') return value;
            if (property === 'close') {
              return (...args: unknown[]) => {
                data.closeCount += 1;
                return Reflect.apply(value, context, args);
              };
            }
            if (property === 'resume') {
              return (...args: unknown[]) => {
                data.resumeCount += 1;
                return Reflect.apply(value, context, args);
              };
            }
            return (...args: unknown[]) => Reflect.apply(value, context, args);
          },
          set(context, property, value) {
            return Reflect.set(context, property, value, context);
          },
        });
      },
    });
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: InstrumentedAudioContext,
      writable: true,
    });
  }, options);
}

async function diagnostics(page: Page): Promise<AudioDiagnostics> {
  return page.evaluate(() => {
    const data = (
      window as unknown as Window & {
        __snakishAudioDiagnostics: {
          supported: boolean;
          userActivationRemoved: boolean;
          contextCount: number;
          sourceCount: number;
          musicStartCount: number;
          activeMusicCount: number;
          maxActiveMusicCount: number;
          closeCount: number;
          resumeCount: number;
          activeEffectCount: number;
          maxActiveEffectCount: number;
          contexts: AudioContext[];
          gains: GainNode[];
        };
      }
    ).__snakishAudioDiagnostics;
    return {
      ...data,
      contextStates: data.contexts.map((context) => context.state),
      contexts: undefined,
      gains: undefined,
      gainValues: data.gains.map((gain) => gain.gain.value),
    };
  });
}

async function suspendRetainedNativeContext(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const data = (
      window as unknown as Window & {
        __snakishAudioDiagnostics: { contexts: AudioContext[] };
      }
    ).__snakishAudioDiagnostics;
    if (data.contexts.length !== 1) {
      throw new Error(
        `Expected exactly one retained native AudioContext, received ${data.contexts.length}.`,
      );
    }
    await data.contexts[0].suspend();
  });
}

// These transparent proxies preserve real native AudioContext/node calls. The
// graph proves browser API wiring and non-overlap, not physical audibility or
// perceived loudness at a speaker.
test('trusted Play creates one running native music graph with nonzero gain and rapid effects never overlap', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await installAudioDiagnostics(page);
  await page.goto('/');
  expect((await diagnostics(page)).supported).toBe(true);
  expect((await diagnostics(page)).contextCount).toBe(0);

  await page
    .locator('[data-action="play"]')
    .evaluate((button) => (button as HTMLButtonElement).click());
  expect((await diagnostics(page)).contextCount).toBe(0);

  await page.reload();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => (await diagnostics(page)).contextCount).toBe(1);
  await expect
    .poll(async () => (await diagnostics(page)).contextStates[0])
    .toBe('running');
  await expect
    .poll(async () => (await diagnostics(page)).gainValues[0] ?? 0)
    .toBeGreaterThan(0);
  for (let index = 0; index < 6; index += 1) {
    await page.locator('[data-action="pause"]').click();
  }
  for (let index = 0; index < 4; index += 1) {
    await page.getByRole('button', { name: 'Restart', exact: true }).click();
  }

  const result = await diagnostics(page);
  expect(result.contextCount).toBe(1);
  expect(result.musicStartCount).toBe(1);
  expect(result.activeMusicCount).toBe(1);
  expect(result.maxActiveEffectCount).toBe(1);
  expect(result.activeEffectCount).toBeLessThanOrEqual(1);
  expect(browserErrors).toEqual([]);
});

test('Escape stays silent while ready; trusted P itself runs the context before Play', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await installAudioDiagnostics(page);
  await page.goto('/');

  await page.keyboard.press('Escape');
  expect((await diagnostics(page)).contextCount).toBe(0);
  await expect(page.locator('#app')).toHaveAttribute(
    'data-game-status',
    'ready',
  );

  await page.keyboard.press('P');
  await expect.poll(async () => (await diagnostics(page)).contextCount).toBe(1);
  await expect
    .poll(async () => (await diagnostics(page)).contextStates[0])
    .toBe('running');
  expect((await diagnostics(page)).gainValues[0]).toBe(0);
  await expect(page.locator('#app')).toHaveAttribute(
    'data-game-status',
    'ready',
  );

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect
    .poll(async () => (await diagnostics(page)).gainValues[0] ?? 0)
    .toBeGreaterThan(0);
  await expect(page.locator('#app')).toHaveAttribute(
    'data-game-status',
    'running',
  );

  await suspendRetainedNativeContext(page);
  await expect
    .poll(async () => (await diagnostics(page)).contextStates[0])
    .toBe('suspended');
  const resumeCountBeforeEscape = (await diagnostics(page)).resumeCount;

  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute(
    'data-game-status',
    'paused',
  );
  await expect
    .poll(async () => (await diagnostics(page)).contextStates[0])
    .toBe('suspended');
  await expect
    .poll(async () => (await diagnostics(page)).resumeCount)
    .toBe(resumeCountBeforeEscape);

  await page.keyboard.press('P');
  await expect(page.locator('#app')).toHaveAttribute(
    'data-game-status',
    'running',
  );
  await expect
    .poll(async () => (await diagnostics(page)).resumeCount)
    .toBe(resumeCountBeforeEscape + 1);
  await expect
    .poll(async () => (await diagnostics(page)).contextStates[0])
    .toBe('running');

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Music', exact: true }).uncheck();
  let result = await diagnostics(page);
  expect(result.gainValues[0]).toBe(0);
  expect(result.gainValues[1]).toBeGreaterThan(0);

  await page.getByRole('checkbox', { name: 'Music', exact: true }).check();
  await page
    .getByRole('checkbox', { name: 'Sound effects', exact: true })
    .uncheck();
  result = await diagnostics(page);
  expect(result.gainValues[0]).toBeGreaterThan(0);
  expect(result.gainValues[1]).toBe(0);
  expect(result.contextCount).toBe(1);
  expect(result.musicStartCount).toBe(1);
  expect(browserErrors).toEqual([]);
});

test('rapid running style changes keep one context and one non-overlapping selected loop', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await installAudioDiagnostics(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const style = page.getByRole('combobox', { name: 'Music style' });

  for (const value of [
    'pixelDrift',
    'minimalBeat',
    'chillGrid',
    'neonPulse',
    'pixelDrift',
  ]) {
    await style.selectOption(value);
  }

  let result = await diagnostics(page);
  expect(result.contextCount).toBe(1);
  expect(result.musicStartCount).toBe(6);
  expect(result.activeMusicCount).toBe(1);
  expect(result.maxActiveMusicCount).toBe(1);

  const music = page.getByRole('checkbox', { name: 'Music', exact: true });
  await music.uncheck();
  await style.selectOption('chillGrid');
  result = await diagnostics(page);
  expect(result.gainValues[0]).toBe(0);
  expect(result.activeMusicCount).toBe(1);
  expect(result.maxActiveMusicCount).toBe(1);

  await music.check();
  result = await diagnostics(page);
  expect(result.contextCount).toBe(1);
  expect(result.musicStartCount).toBe(7);
  expect(result.activeMusicCount).toBe(1);
  expect(result.gainValues[0]).toBeGreaterThan(0);
  expect(browserErrors).toEqual([]);
});

test('scripted checkbox click cannot unlock without userActivation, but trusted click can', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await installAudioDiagnostics(page, { removeUserActivation: true });
  await page.goto('/');
  const initial = await diagnostics(page);
  test.skip(
    !initial.userActivationRemoved,
    'Chromium did not permit removing navigator.userActivation honestly.',
  );

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const music = page.getByRole('checkbox', { name: 'Music', exact: true });
  await music.evaluate((checkbox) => (checkbox as HTMLInputElement).click());
  expect((await diagnostics(page)).contextCount).toBe(0);

  await music.check();
  await expect.poll(async () => (await diagnostics(page)).contextCount).toBe(1);
  await expect
    .poll(async () => (await diagnostics(page)).contextStates[0])
    .toBe('running');
  expect(browserErrors).toEqual([]);
});

sourceFixtureTest(
  'closes and silences native audio before remount @source-fixture',
  async ({ page }) => {
    const browserErrors = collectPageErrors(page);
    await installAudioDiagnostics(page);
    await page.goto('/');
    await page.evaluate(async () => {
      const modulePath = '/src/app.ts';
      const { mountApp } = (await import(/* @vite-ignore */ modulePath)) as {
        mountApp: (root: HTMLElement) => () => void;
      };
      const root = document.createElement('div');
      root.id = 'audio-remount-fixture';
      document.body.append(root);
      (
        window as Window & { __audioFixtureTeardown?: () => void }
      ).__audioFixtureTeardown = mountApp(root);
    });
    const fixture = page.locator('#audio-remount-fixture');
    await fixture.getByRole('button', { name: 'Play', exact: true }).click();
    await expect
      .poll(async () => (await diagnostics(page)).contextCount)
      .toBe(1);

    await page.evaluate(() => {
      (
        window as Window & { __audioFixtureTeardown?: () => void }
      ).__audioFixtureTeardown?.();
    });
    let result = await diagnostics(page);
    expect(result.closeCount).toBe(1);
    expect(result.activeMusicCount).toBe(0);

    await page.evaluate(async () => {
      const modulePath = '/src/app.ts';
      const { mountApp } = (await import(/* @vite-ignore */ modulePath)) as {
        mountApp: (root: HTMLElement) => () => void;
      };
      const root = document.querySelector<HTMLElement>(
        '#audio-remount-fixture',
      );
      if (root === null) throw new Error('Expected remount root.');
      (
        window as Window & { __audioFixtureTeardown?: () => void }
      ).__audioFixtureTeardown = mountApp(root);
    });
    await fixture.getByRole('button', { name: 'Play', exact: true }).click();

    result = await diagnostics(page);
    expect(result.contextCount).toBe(2);
    expect(result.musicStartCount).toBe(2);
    expect(result.activeMusicCount).toBe(1);
    expect(browserErrors).toEqual([]);
  },
);
