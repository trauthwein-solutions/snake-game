/* global Buffer, URL, process, setTimeout */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

const deployScript = new URL(
  '../../scripts/deploy-static-release.sh',
  import.meta.url,
).pathname;
const rollbackScript = new URL(
  '../../scripts/rollback-static-release.sh',
  import.meta.url,
).pathname;
const temporaryRoots = [];
const sha = (digit) => digit.repeat(40);
const watchdogDelaySeconds = '10';
const defaultTransaction = '1-1';

const run = (command, arguments_) => {
  const result = spawnSync(command, arguments_, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(
      `${command} failed with ${result.status}: ${result.stderr ?? ''}`,
    );
  }
  return result;
};

const makeRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'snakish-release-test-'));
  temporaryRoots.push(root);
  mkdirSync(join(root, 'releases'));
  return root;
};

const makeSite = (root, options = {}) => {
  const source = mkdtempSync(join(tmpdir(), 'snakish-site-'));
  temporaryRoots.push(source);
  if (!options.missingIndex)
    writeFileSync(join(source, 'index.html'), 'SNAKISH');
  if (!options.missingAsset) {
    mkdirSync(join(source, 'assets'));
    writeFileSync(join(source, 'assets', 'app.js'), 'app');
  }
  return source;
};

const archiveSite = (
  root,
  releaseSha,
  source,
  deploymentTransaction = defaultTransaction,
) => {
  const archive = join(
    root,
    `incoming-${releaseSha}-${deploymentTransaction}.tar.gz`,
  );
  run('tar', ['-czf', archive, '-C', source, '.']);
  return archive;
};

const deploy = (root, releaseSha, action, options = {}) =>
  spawnSync(
    'sh',
    [
      deployScript,
      releaseSha,
      root,
      options.transaction ?? defaultTransaction,
      action ?? 'activate',
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        SNAKISH_ROLLBACK_WATCHDOG_SECONDS:
          options.watchdogDelaySeconds ?? watchdogDelaySeconds,
      },
    },
  );

const rollback = (
  root,
  releaseSha,
  deploymentTransaction = defaultTransaction,
) =>
  spawnSync('sh', [rollbackScript, releaseSha, root, deploymentTransaction], {
    encoding: 'utf8',
  });

const current = (root) => readlinkSync(join(root, 'current'));
const marker = (root, releaseSha) =>
  readFileSync(join(root, `.rollback-${releaseSha}`), 'utf8');
const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const waitFor = async (condition, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline)
      throw new Error('condition was not met in time');
    await wait(25);
  }
};
const watchdogsFor = (root) => {
  const result = spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
  return (result.stdout ?? '')
    .split('\n')
    .filter(
      (line) =>
        line.includes('snakish-rollback-watchdog') && line.includes(root),
    );
};

const tarHeader = (name, type) => {
  const block = Buffer.alloc(512);
  const write = (value, offset, length) =>
    block.write(
      value,
      offset,
      Math.min(length, Buffer.byteLength(value)),
      'ascii',
    );
  const octal = (value, length) =>
    `${value.toString(8).padStart(length - 1, '0')}\0`;
  write(name, 0, 100);
  write(octal(0o644, 8), 100, 8);
  write(octal(0, 8), 108, 8);
  write(octal(0, 8), 116, 8);
  write(octal(0, 12), 124, 12);
  write(octal(0, 12), 136, 12);
  block.fill(0x20, 148, 156);
  write(type, 156, 1);
  write('ustar\0', 257, 6);
  write('00', 263, 2);
  write(octal(1, 8), 329, 8);
  write(octal(3, 8), 337, 8);
  const checksum = block.reduce((sum, byte) => sum + byte, 0);
  write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return Buffer.concat([block, Buffer.alloc(1024)]);
};

afterEach(async () => {
  const paths = temporaryRoots.splice(0);
  for (const path of paths) {
    rmSync(path, { recursive: true, force: true });
  }
  await waitFor(() => paths.every((path) => watchdogsFor(path).length === 0));
});

describe('static release scripts', () => {
  it('activates a valid first release with an atomic relative symlink', () => {
    const root = makeRoot();
    archiveSite(root, sha('a'), makeSite(root));

    const result = deploy(root, sha('a'));

    expect(result.status, result.stderr).toBe(0);
    expect(current(root)).toBe(`releases/${sha('a')}`);
    expect(readFileSync(join(root, current(root), 'index.html'), 'utf8')).toBe(
      'SNAKISH',
    );
    expect(lstatSync(join(root, 'current')).isSymbolicLink()).toBe(true);
    expect(marker(root, sha('a'))).toBe('NONE\n');
  });

  it('captures and restores the previous release', () => {
    const root = makeRoot();
    archiveSite(root, sha('a'), makeSite(root));
    expect(deploy(root, sha('a')).status).toBe(0);
    expect(deploy(root, sha('a'), 'finalize').status).toBe(0);
    archiveSite(root, sha('b'), makeSite(root));
    expect(deploy(root, sha('b')).status).toBe(0);

    const result = rollback(root, sha('b'));

    expect(result.status, result.stderr).toBe(0);
    expect(current(root)).toBe(`releases/${sha('a')}`);
    expect(rollback(root, sha('b')).status).toBe(0);
    expect(current(root)).toBe(`releases/${sha('a')}`);
  });

  it('removes current when the first deployment is rolled back', () => {
    const root = makeRoot();
    archiveSite(root, sha('a'), makeSite(root));
    expect(deploy(root, sha('a')).status).toBe(0);

    expect(rollback(root, sha('a')).status).toBe(0);
    expect(spawnSync('test', ['-e', join(root, 'current')]).status).not.toBe(0);
  });

  it('is idempotent for the same SHA and does not replace its release', () => {
    const root = makeRoot();
    const source = makeSite(root);
    archiveSite(root, sha('a'), source);
    expect(deploy(root, sha('a')).status).toBe(0);
    writeFileSync(join(root, 'releases', sha('a'), 'index.html'), 'KNOWN');
    archiveSite(root, sha('a'), makeSite(root), '2-1');

    expect(
      deploy(root, sha('a'), undefined, { transaction: '2-1' }).status,
    ).toBe(0);
    expect(readFileSync(join(root, current(root), 'index.html'), 'utf8')).toBe(
      'KNOWN',
    );
  });

  it('rolls back safely after activation fails before the switch', () => {
    const root = makeRoot();
    archiveSite(root, sha('a'), makeSite(root));
    expect(deploy(root, sha('a')).status).toBe(0);
    expect(deploy(root, sha('a'), 'finalize').status).toBe(0);
    archiveSite(root, sha('b'), makeSite(root, { missingIndex: true }));

    const activation = deploy(root, sha('b'));

    expect(activation.status).not.toBe(0);
    expect(current(root)).toBe(`releases/${sha('a')}`);
    expect(existsSync(join(root, `.rollback-${sha('b')}`))).toBe(false);
    expect(rollback(root, sha('b')).status).toBe(0);
    expect(current(root)).toBe(`releases/${sha('a')}`);
    expect(existsSync(join(root, `.rollback-${sha('b')}`))).toBe(false);
  });

  it('has a watchdog that restores the predecessor after a post-switch interruption', async () => {
    const root = makeRoot();
    archiveSite(root, sha('a'), makeSite(root));
    expect(deploy(root, sha('a')).status).toBe(0);
    expect(deploy(root, sha('a'), 'finalize').status).toBe(0);
    archiveSite(root, sha('b'), makeSite(root));

    expect(
      deploy(root, sha('b'), undefined, { watchdogDelaySeconds: '1' }).status,
    ).toBe(0);
    expect(current(root)).toBe(`releases/${sha('b')}`);
    const watchdogPids = watchdogsFor(root).map((line) =>
      Number(/^\s*(\d+)/.exec(line)?.[1]),
    );
    expect(watchdogPids.length).toBeGreaterThan(0);
    for (const pid of watchdogPids) process.kill(pid, 'SIGHUP');

    await waitFor(
      () =>
        current(root) === `releases/${sha('a')}` &&
        !existsSync(join(root, `.rollback-${sha('b')}`)) &&
        !existsSync(
          join(root, `incoming-${sha('b')}-${defaultTransaction}.tar.gz`),
        ),
    );
    expect(existsSync(join(root, `.rollback-${sha('b')}`))).toBe(false);
    expect(
      existsSync(
        join(root, `incoming-${sha('b')}-${defaultTransaction}.tar.gz`),
      ),
    ).toBe(false);
  });

  it('has a watchdog that removes current after an interrupted first deployment', async () => {
    const root = makeRoot();
    archiveSite(root, sha('a'), makeSite(root));

    expect(
      deploy(root, sha('a'), undefined, { watchdogDelaySeconds: '1' }).status,
    ).toBe(0);
    expect(current(root)).toBe(`releases/${sha('a')}`);

    await waitFor(
      () =>
        !existsSync(join(root, 'current')) &&
        !existsSync(join(root, `.rollback-${sha('a')}`)),
    );
  });

  it('refreshes a stale marker to the actual immediate predecessor', () => {
    const root = makeRoot();
    for (const digit of ['a', 'b']) {
      archiveSite(root, sha(digit), makeSite(root));
      expect(deploy(root, sha(digit)).status).toBe(0);
      expect(deploy(root, sha(digit), 'finalize').status).toBe(0);
    }
    writeFileSync(
      join(root, `.rollback-${sha('c')}`),
      `releases/${sha('a')}\n`,
    );
    archiveSite(root, sha('c'), makeSite(root));

    expect(deploy(root, sha('c')).status).toBe(0);

    expect(marker(root, sha('c'))).toBe(`releases/${sha('b')}\n`);
    expect(rollback(root, sha('c')).status).toBe(0);
    expect(current(root)).toBe(`releases/${sha('b')}`);
  });

  it('uses SAME so a finalized same-SHA retry rollback is a no-op', () => {
    const root = makeRoot();
    archiveSite(root, sha('a'), makeSite(root));
    expect(deploy(root, sha('a')).status).toBe(0);
    expect(deploy(root, sha('a'), 'finalize').status).toBe(0);

    expect(
      deploy(root, sha('a'), undefined, { transaction: '2-1' }).status,
    ).toBe(0);

    expect(marker(root, sha('a'))).toBe('SAME\n');
    expect(rollback(root, sha('a'), '2-1').status).toBe(0);
    expect(current(root)).toBe(`releases/${sha('a')}`);
  });

  it('preserves the real predecessor on an interrupted same-SHA retry', () => {
    const root = makeRoot();
    archiveSite(root, sha('a'), makeSite(root));
    expect(deploy(root, sha('a')).status).toBe(0);
    expect(deploy(root, sha('a'), 'finalize').status).toBe(0);
    archiveSite(root, sha('b'), makeSite(root));
    expect(deploy(root, sha('b')).status).toBe(0);
    expect(marker(root, sha('b'))).toBe(`releases/${sha('a')}\n`);

    expect(
      deploy(root, sha('b'), undefined, { transaction: '2-1' }).status,
    ).toBe(0);

    expect(marker(root, sha('b'))).toBe(`releases/${sha('a')}\n`);
    expect(rollback(root, sha('b'), '2-1').status).toBe(0);
    expect(current(root)).toBe(`releases/${sha('a')}`);
  });

  it('refreshes marker and current inode ownership on a same-SHA activation', () => {
    const root = makeRoot();
    archiveSite(root, sha('a'), makeSite(root));
    expect(deploy(root, sha('a')).status).toBe(0);
    expect(deploy(root, sha('a'), 'finalize').status).toBe(0);
    archiveSite(root, sha('b'), makeSite(root), '2-1');
    expect(
      deploy(root, sha('b'), undefined, { transaction: '2-1' }).status,
    ).toBe(0);
    const oldMarkerInode = lstatSync(join(root, `.rollback-${sha('b')}`)).ino;
    const oldCurrentInode = lstatSync(join(root, 'current')).ino;
    archiveSite(root, sha('b'), makeSite(root), '3-1');

    expect(
      deploy(root, sha('b'), undefined, { transaction: '3-1' }).status,
    ).toBe(0);

    expect(lstatSync(join(root, `.rollback-${sha('b')}`)).ino).not.toBe(
      oldMarkerInode,
    );
    expect(lstatSync(join(root, 'current')).ino).not.toBe(oldCurrentInode);
    expect(marker(root, sha('b'))).toBe(`releases/${sha('a')}\n`);
    expect(rollback(root, sha('b'), '3-1').status).toBe(0);
    expect(current(root)).toBe(`releases/${sha('a')}`);
  });

  it('supersedes an old same-SHA watchdog before its deadline during new smoke', async () => {
    const root = makeRoot();
    archiveSite(root, sha('a'), makeSite(root));
    expect(deploy(root, sha('a')).status).toBe(0);
    expect(deploy(root, sha('a'), 'finalize').status).toBe(0);
    archiveSite(root, sha('b'), makeSite(root), '2-1');
    expect(
      deploy(root, sha('b'), undefined, {
        transaction: '2-1',
        watchdogDelaySeconds: '2',
      }).status,
    ).toBe(0);
    await wait(1_200);
    archiveSite(root, sha('b'), makeSite(root), '3-1');
    expect(
      deploy(root, sha('b'), undefined, {
        transaction: '3-1',
        watchdogDelaySeconds: '5',
      }).status,
    ).toBe(0);
    const newMarkerInode = lstatSync(join(root, `.rollback-${sha('b')}`)).ino;
    const newCurrentInode = lstatSync(join(root, 'current')).ino;

    await wait(1_300);

    expect(current(root)).toBe(`releases/${sha('b')}`);
    expect(lstatSync(join(root, `.rollback-${sha('b')}`)).ino).toBe(
      newMarkerInode,
    );
    expect(lstatSync(join(root, 'current')).ino).toBe(newCurrentInode);
    expect(existsSync(join(root, `incoming-${sha('b')}-3-1.tar.gz`))).toBe(
      true,
    );
    expect(rollback(root, sha('b'), '3-1').status).toBe(0);
    expect(current(root)).toBe(`releases/${sha('a')}`);
  });

  it('does not let an expiring old watchdog delete a later same-SHA upload', async () => {
    const root = makeRoot();
    archiveSite(root, sha('a'), makeSite(root));
    expect(deploy(root, sha('a')).status).toBe(0);
    expect(deploy(root, sha('a'), 'finalize').status).toBe(0);
    archiveSite(root, sha('b'), makeSite(root), '2-1');
    expect(
      deploy(root, sha('b'), undefined, {
        transaction: '2-1',
        watchdogDelaySeconds: '1',
      }).status,
    ).toBe(0);
    const laterArchive = archiveSite(root, sha('b'), makeSite(root), '3-1');

    await waitFor(() => current(root) === `releases/${sha('a')}`);

    expect(existsSync(laterArchive)).toBe(true);
  });

  it('makes an old immediate rollback harmless after same-SHA ownership transfers', () => {
    const root = makeRoot();
    archiveSite(root, sha('a'), makeSite(root));
    expect(deploy(root, sha('a')).status).toBe(0);
    expect(deploy(root, sha('a'), 'finalize').status).toBe(0);
    archiveSite(root, sha('b'), makeSite(root), '2-1');
    expect(
      deploy(root, sha('b'), undefined, { transaction: '2-1' }).status,
    ).toBe(0);
    archiveSite(root, sha('b'), makeSite(root), '3-1');
    expect(
      deploy(root, sha('b'), undefined, { transaction: '3-1' }).status,
    ).toBe(0);
    const newMarkerInode = lstatSync(join(root, `.rollback-${sha('b')}`)).ino;
    const newCurrentInode = lstatSync(join(root, 'current')).ino;

    expect(rollback(root, sha('b'), '2-1').status).toBe(0);

    expect(current(root)).toBe(`releases/${sha('b')}`);
    expect(lstatSync(join(root, `.rollback-${sha('b')}`)).ino).toBe(
      newMarkerInode,
    );
    expect(lstatSync(join(root, 'current')).ino).toBe(newCurrentInode);
    expect(existsSync(join(root, `incoming-${sha('b')}-3-1.tar.gz`))).toBe(
      true,
    );
    expect(rollback(root, sha('b'), '3-1').status).toBe(0);
    expect(current(root)).toBe(`releases/${sha('a')}`);
  });

  it.each(['malformed', 'multiline', 'unterminated multiline', 'symlink'])(
    'rejects an existing %s marker without switching',
    (kind) => {
      const root = makeRoot();
      archiveSite(root, sha('a'), makeSite(root));
      expect(deploy(root, sha('a')).status).toBe(0);
      expect(deploy(root, sha('a'), 'finalize').status).toBe(0);
      const markerPath = join(root, `.rollback-${sha('b')}`);
      if (kind === 'symlink') {
        writeFileSync(join(root, 'unsafe-marker-target'), 'NONE\n');
        symlinkSync('unsafe-marker-target', markerPath);
      } else if (kind === 'unterminated multiline') {
        writeFileSync(markerPath, 'NONE\nSAME');
      } else {
        writeFileSync(
          markerPath,
          kind === 'multiline' ? 'NONE\nSAME\n' : 'bad\n',
        );
      }
      archiveSite(root, sha('b'), makeSite(root));

      expect(deploy(root, sha('b')).status).not.toBe(0);
      expect(current(root)).toBe(`releases/${sha('a')}`);
    },
  );

  it('rejects a malformed rollback marker without changing current', () => {
    const root = makeRoot();
    archiveSite(root, sha('a'), makeSite(root));
    expect(deploy(root, sha('a')).status).toBe(0);
    writeFileSync(join(root, `.rollback-${sha('a')}`), 'NONE\nSAME\n');

    expect(rollback(root, sha('a')).status).not.toBe(0);
    expect(current(root)).toBe(`releases/${sha('a')}`);
  });

  it.each(['0', '601', '1x', ' 1'])(
    'rejects unsafe watchdog delay %j before creating state',
    (watchdogDelay) => {
      const root = makeRoot();
      archiveSite(root, sha('a'), makeSite(root));

      const result = deploy(root, sha('a'), undefined, {
        watchdogDelaySeconds: watchdogDelay,
      });

      expect(result.status).not.toBe(0);
      expect(existsSync(join(root, 'current'))).toBe(false);
      expect(existsSync(join(root, `.rollback-${sha('a')}`))).toBe(false);
    },
  );

  it('does not let an old watchdog clobber a later switch back to the same SHA', async () => {
    const root = makeRoot();
    archiveSite(root, sha('9'), makeSite(root));
    expect(deploy(root, sha('9')).status).toBe(0);
    expect(deploy(root, sha('9'), 'finalize').status).toBe(0);
    archiveSite(root, sha('a'), makeSite(root));
    expect(
      deploy(root, sha('a'), undefined, { watchdogDelaySeconds: '2' }).status,
    ).toBe(0);
    archiveSite(root, sha('b'), makeSite(root));
    expect(deploy(root, sha('b')).status).toBe(0);
    expect(rollback(root, sha('b')).status).toBe(0);
    expect(current(root)).toBe(`releases/${sha('a')}`);

    await waitFor(() => !existsSync(join(root, `.rollback-${sha('a')}`)));

    expect(current(root)).toBe(`releases/${sha('a')}`);
  });

  it('finalize cancels its watchdog without leaving a child process', async () => {
    const root = makeRoot();
    archiveSite(root, sha('a'), makeSite(root));
    expect(
      deploy(root, sha('a'), undefined, { watchdogDelaySeconds: '3' }).status,
    ).toBe(0);
    expect(watchdogsFor(root).length).toBeGreaterThan(0);

    expect(deploy(root, sha('a'), 'finalize').status).toBe(0);
    await waitFor(() => watchdogsFor(root).length === 0);

    expect(current(root)).toBe(`releases/${sha('a')}`);
    expect(existsSync(join(root, `.rollback-${sha('a')}`))).toBe(false);
  });

  it.each([
    ['short SHA', 'abc', undefined],
    ['uppercase SHA', 'A'.repeat(40), undefined],
    ['relative root', sha('a'), 'relative'],
    ['filesystem root', sha('a'), '/'],
  ])('rejects an invalid %s', (_name, releaseSha, badRoot) => {
    const root = badRoot ?? makeRoot();
    expect(deploy(root, releaseSha).status).not.toBe(0);
  });

  it.each([
    '',
    '0-1',
    '1-0',
    '01-1',
    '1-01',
    '-1-1',
    '1-1;touch',
    '1',
    '1-1-1',
    `${'1'.repeat(21)}-1`,
    `1-${'1'.repeat(21)}`,
  ])('rejects invalid transaction ID %j', (deploymentTransaction) => {
    const root = makeRoot();
    archiveSite(root, sha('a'), makeSite(root));

    expect(
      deploy(root, sha('a'), undefined, {
        transaction: deploymentTransaction,
      }).status,
    ).not.toBe(0);
    expect(rollback(root, sha('a'), deploymentTransaction).status).not.toBe(0);
    expect(existsSync(join(root, 'current'))).toBe(false);
  });

  it('rejects traversal archive entries', () => {
    const root = makeRoot();
    const source = makeSite(root);
    const archive = join(
      root,
      `incoming-${sha('a')}-${defaultTransaction}.tar.gz`,
    );
    run('tar', [
      '-czf',
      archive,
      '-C',
      source,
      '--transform=s|index.html|../escaped.html|',
      'index.html',
    ]);

    expect(deploy(root, sha('a')).status).not.toBe(0);
  });

  it('rejects archive entries containing control characters', () => {
    const root = makeRoot();
    const source = makeSite(root);
    writeFileSync(join(source, 'bad\nname.js'), 'bad');
    archiveSite(root, sha('a'), source);

    expect(deploy(root, sha('a')).status).not.toBe(0);
  });

  it.each(['symlink', 'hardlink'])('rejects a %s archive entry', (kind) => {
    const root = makeRoot();
    const source = makeSite(root);
    if (kind === 'symlink') symlinkSync('index.html', join(source, 'bad-link'));
    else linkSync(join(source, 'index.html'), join(source, 'bad-link'));
    archiveSite(root, sha('a'), source);

    expect(deploy(root, sha('a')).status).not.toBe(0);
  });

  it('rejects device archive entries', () => {
    const root = makeRoot();
    writeFileSync(
      join(root, `incoming-${sha('a')}-${defaultTransaction}.tar.gz`),
      gzipSync(tarHeader('device', '3')),
    );

    expect(deploy(root, sha('a')).status).not.toBe(0);
  });

  it.each([
    ['index', { missingIndex: true }],
    ['JS/CSS asset', { missingAsset: true }],
  ])('rejects a release missing its %s', (_name, options) => {
    const root = makeRoot();
    archiveSite(root, sha('a'), makeSite(root, options));

    expect(deploy(root, sha('a')).status).not.toBe(0);
  });

  it('finalizes safely, retaining current plus two prior releases', () => {
    const root = makeRoot();
    for (const [index, digit] of ['a', 'b', 'c', 'd'].entries()) {
      archiveSite(root, sha(digit), makeSite(root));
      expect(deploy(root, sha(digit)).status).toBe(0);
      expect(deploy(root, sha(digit), 'finalize').status).toBe(0);
      utimesSync(
        join(root, 'releases', sha(digit)),
        new Date(index * 1000),
        new Date(index * 1000),
      );
    }
    mkdirSync(join(root, 'releases', 'shared-data'));
    archiveSite(root, sha('d'), makeSite(root), '2-1');
    expect(
      deploy(root, sha('d'), undefined, { transaction: '2-1' }).status,
    ).toBe(0);

    const result = deploy(root, sha('d'), 'finalize', { transaction: '2-1' });

    expect(result.status, result.stderr).toBe(0);
    expect(current(root)).toBe(`releases/${sha('d')}`);
    expect(
      spawnSync('test', ['-d', join(root, 'releases', sha('a'))]).status,
    ).not.toBe(0);
    expect(
      spawnSync('test', ['-d', join(root, 'releases', sha('b'))]).status,
    ).toBe(0);
    expect(
      spawnSync('test', ['-d', join(root, 'releases', sha('c'))]).status,
    ).toBe(0);
    expect(
      spawnSync('test', ['-d', join(root, 'releases', 'shared-data')]).status,
    ).toBe(0);
    expect(
      spawnSync('test', ['-e', join(root, `.rollback-${sha('d')}`)]).status,
    ).not.toBe(0);
    expect(
      spawnSync('test', ['-e', join(root, `incoming-${sha('d')}-2-1.tar.gz`)])
        .status,
    ).not.toBe(0);
  });
});
