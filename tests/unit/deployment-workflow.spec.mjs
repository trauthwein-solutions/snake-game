/* global URL */

import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const workflow = await readFile(
  new URL('.github/workflows/ci.yml', root),
  'utf8',
);
const playwright = await readFile(
  new URL('playwright.config.ts', root),
  'utf8',
);
const sourceFixturesPlaywright = await readFile(
  new URL('playwright.source-fixtures.config.ts', root),
  'utf8',
);
const packageJson = JSON.parse(
  await readFile(new URL('package.json', root), 'utf8'),
);
const sourceFixtureSpecs = await Promise.all(
  [
    'tests/e2e/arcade-feedback.spec.ts',
    'tests/e2e/controls.spec.ts',
    'tests/e2e/desktop-game.spec.ts',
  ].map((path) => readFile(new URL(path, root), 'utf8')),
);

const deployStart = workflow.indexOf('\n  deploy:');
const deployJob = deployStart === -1 ? '' : workflow.slice(deployStart);
const ciJob = deployStart === -1 ? workflow : workflow.slice(0, deployStart);
const mainPushCondition =
  "github.event_name == 'push' && github.ref == 'refs/heads/main'";
const sourceFixtureTitles = [
  'direct renderer terminal and high-contrast signatures isolate each event',
  'direct food fixtures isolate center and boundary sparks at app cell size',
  'direct reduced-motion fixtures are pixel-identical with or without events',
  'removes touch swipe listeners during teardown',
  'shows and tears down the actual completed-result dialog helper',
];

describe('production preview and deployment workflow', () => {
  it('keeps CI on pull requests, main pushes, and manual verification runs', () => {
    expect(workflow).toMatch(/on:\s*[\s\S]*pull_request:/);
    expect(workflow).toMatch(/push:\s*\n\s+branches:\s*\n\s+- main/);
    expect(workflow).toMatch(/workflow_dispatch:/);
    expect(workflow).toMatch(/permissions:\s*\n\s+contents: read/);
    expect(workflow).toContain('name: Verify project');
  });

  it('runs 47 production journeys against a freshly built preview', () => {
    expect(packageJson.scripts.preview).toBe('vite preview');
    expect(playwright).toMatch(
      /command:\s*['"]npm run build && npm run preview -- --host 127\.0\.0\.1 --port 4173['"]/,
    );
    expect(playwright).toMatch(/grepInvert:\s*\/@source-fixture\//);
    expect(playwright).toContain('reuseExistingServer: false');
    expect(playwright).not.toContain('npm run dev');
  });

  it('runs only the 5 tagged source fixtures against non-reused Vite dev', () => {
    expect(sourceFixturesPlaywright).toMatch(
      /command:\s*['"]npm run dev -- --host 127\.0\.0\.1 --port 4174['"]/,
    );
    expect(sourceFixturesPlaywright).toMatch(
      /baseURL:\s*['"]http:\/\/127\.0\.0\.1:4174['"]/,
    );
    expect(sourceFixturesPlaywright).toMatch(/grep:\s*\/@source-fixture\//);
    expect(sourceFixturesPlaywright).toContain('reuseExistingServer: false');
    expect(sourceFixturesPlaywright).not.toMatch(/npm run (?:build|preview)/);

    const fixtureSources = sourceFixtureSpecs.join('\n');
    expect(fixtureSources.match(/tag: '@source-fixture'/g)).toHaveLength(3);
    expect(fixtureSources.match(/\nsourceFixtureTest\(/g)).toHaveLength(5);
    expect(fixtureSources.match(/const \w+Path = '\/src\//g)).toHaveLength(5);
    for (const title of sourceFixtureTitles) {
      expect(fixtureSources).toContain(`'${title}'`);
    }
  });

  it('runs production first and source fixtures second as the complete E2E gate', () => {
    expect(packageJson.scripts['test:e2e']).toBe(
      'npm run test:e2e:production && npm run test:e2e:source-fixtures',
    );
    expect(packageJson.scripts['test:e2e:production']).toBe(
      'playwright test --pass-with-no-tests',
    );
    expect(packageJson.scripts['test:e2e:source-fixtures']).toBe(
      'playwright test --config=playwright.source-fixtures.config.ts --pass-with-no-tests',
    );
    expect(ciJob).toMatch(/name: Run end-to-end tests\s+run: npm run test:e2e/);
  });

  it('validates and uploads the tested dist only after E2E on main pushes', () => {
    const e2e = ciJob.indexOf('name: Run end-to-end tests');
    const validate = ciJob.indexOf('name: Validate deployment artifact');
    const upload = ciJob.indexOf('name: Upload tested deployment artifact');

    expect(e2e).toBeGreaterThan(-1);
    expect(validate).toBeGreaterThan(e2e);
    expect(upload).toBeGreaterThan(validate);
    expect(ciJob.slice(validate, upload)).toContain('if: success() &&');
    expect(ciJob.slice(validate, upload)).toContain(mainPushCondition);
    expect(ciJob.slice(upload)).toContain('if: success() &&');
    expect(ciJob.slice(upload)).toContain(mainPushCondition);
    expect(ciJob).toContain('dist/index.html');
    expect(ciJob).toContain('SHA256SUMS');
    expect(ciJob).toContain('snakish-static-${{ github.sha }}');
    expect(ciJob).toMatch(/retention-days:\s*[1-7]\b/);
    const uploadStep = ciJob.slice(upload);
    expect(uploadStep).toContain('overwrite: true');
    expect(workflow.match(/overwrite:\s*true/g)).toHaveLength(1);
  });

  it('creates a self-excluding manifest that exactly verifies in a real directory', () => {
    const validate = ciJob.indexOf('name: Validate deployment artifact');
    const upload = ciJob.indexOf('name: Upload tested deployment artifact');
    const manifestStep = ciJob.slice(validate, upload);
    expect(manifestStep).toContain('find . -type f ! -name SHA256SUMS -print0');

    const directory = mkdtempSync(join(tmpdir(), 'snakish-manifest-test-'));
    const dist = join(directory, 'dist');
    try {
      mkdirSync(join(dist, 'assets'), { recursive: true });
      writeFileSync(join(dist, 'index.html'), 'SNAKISH');
      writeFileSync(join(dist, 'assets', 'app.js'), 'app');
      const result = spawnSync(
        'bash',
        [
          '-c',
          'find . -type f ! -name SHA256SUMS -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > SHA256SUMS\n' +
            'find . -type f ! -name SHA256SUMS -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > "$1"\n' +
            'cmp SHA256SUMS "$1"\n' +
            'sha256sum --check --strict SHA256SUMS',
          'manifest-regression',
          join(directory, 'actual-SHA256SUMS'),
        ],
        { cwd: dist, encoding: 'utf8' },
      );

      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(join(dist, 'SHA256SUMS'), 'utf8')).not.toContain(
        'SHA256SUMS',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('gates a least-privilege deploy job on the successful main-push verifier', () => {
    expect(deployJob).toContain('needs: ci');
    expect(deployJob).toContain("if: needs.ci.result == 'success' &&");
    expect(deployJob).toContain(mainPushCondition);
    expect(deployJob).toMatch(/environment:\s*\n\s+name: production/);
    expect(deployJob).toContain('url: https://snake.trauthwein-solutions.com');
    expect(deployJob).toMatch(/permissions:\s*\n\s+contents: read/);
    expect(deployJob).toMatch(/concurrency:\s*\n\s+group: snakish-production/);
    expect(deployJob).toContain('cancel-in-progress: false');
    expect(deployJob).toMatch(/timeout-minutes:\s*\d+/);
  });

  it('downloads the SHA-specific artifact and verifies it before upload', () => {
    const download = deployJob.indexOf(
      'name: Download tested deployment artifact',
    );
    const verify = deployJob.indexOf('name: Verify deployment artifact');
    const release = deployJob.indexOf('name: Deploy release and smoke test');

    expect(download).toBeGreaterThan(-1);
    expect(verify).toBeGreaterThan(download);
    expect(release).toBeGreaterThan(verify);
    expect(deployJob).toContain('snakish-static-${{ github.sha }}');
    expect(deployJob.slice(verify, release)).toMatch(
      /sha256sum\s+(?:-c|--check)\b/,
    );
    expect(deployJob.slice(verify, release)).toContain(
      'cmp SHA256SUMS "$actual_manifest"',
    );
    expect(deployJob).toMatch(/actions\/download-artifact@[0-9a-f]{40}\s+# v8/);
  });

  it('does not rebuild or elevate in the deployment job', () => {
    expect(deployJob).not.toMatch(/actions\/checkout|actions\/setup-node/);
    expect(deployJob).not.toMatch(/\bnpm\b|\bnpx\b|\bsudo\b|\bdocker\b|root@/i);
    expect(deployJob).not.toMatch(/npm run build|npm test|playwright|vite/i);
    expect(deployJob).not.toMatch(/packages:\s*write|pages:\s*write|id-token:/);
  });

  it('uses strict SSH files/options and contains smoke, rollback, and finalize paths', () => {
    for (const expected of [
      'umask 077',
      'BatchMode=yes',
      'IdentitiesOnly=yes',
      'StrictHostKeyChecking=yes',
      'UserKnownHostsFile=',
      'GlobalKnownHostsFile=/dev/null',
      'ForwardAgent=no',
      'RequestTTY=no',
      'trap cleanup',
      'scripts/smoke-deployment.mjs',
      'scripts/rollback-static-release.sh',
      'finalize',
    ]) {
      expect(deployJob).toContain(expected);
    }
    expect(deployJob).not.toContain('SNAKISH_ROLLBACK_WATCHDOG_SECONDS');
  });

  it('validates and uses a unique transaction for every remote deployment path', () => {
    expect(deployJob).toContain(
      'DEPLOY_TRANSACTION: ${{ github.run_id }}-${{ github.run_attempt }}',
    );
    expect(deployJob).toMatch(/DEPLOY_TRANSACTION[\s\S]*\^\[1-9\]/);
    expect(deployJob).toContain(
      'incoming-$RELEASE_SHA-$DEPLOY_TRANSACTION.tar.gz',
    );
    expect(deployJob).toContain(
      '"$RELEASE_SHA" "$DEPLOY_ROOT" "$DEPLOY_TRANSACTION" activate',
    );
    expect(deployJob).toContain(
      '"$RELEASE_SHA" "$DEPLOY_ROOT" "$DEPLOY_TRANSACTION" finalize',
    );
    expect(
      deployJob.match(
        /"\$RELEASE_SHA" "\$DEPLOY_ROOT" "\$DEPLOY_TRANSACTION"/g,
      ),
    ).toHaveLength(4);
    expect(deployJob).not.toContain('incoming-$RELEASE_SHA.tar.gz');
  });

  it('captures activation failure, attempts rollback, reports both statuses, and still fails', () => {
    const activation = deployJob.indexOf(
      'sh -s -- "$RELEASE_SHA" "$DEPLOY_ROOT" "$DEPLOY_TRANSACTION" activate',
    );
    const smoke = deployJob.indexOf(
      'node artifact/scripts/smoke-deployment.mjs',
    );
    const activationBlock = deployJob.slice(activation - 500, smoke);

    expect(activation).toBeGreaterThan(-1);
    expect(smoke).toBeGreaterThan(activation);
    expect(activationBlock).toMatch(/set \+e[\s\S]*activation_status=\$\?/);
    expect(activationBlock).toMatch(
      /activation_status[\s\S]*rollback-static-release\.sh/,
    );
    expect(activationBlock).toMatch(/rollback_status=\$\?/);
    expect(activationBlock).toMatch(/Activation failed with status/);
    expect(activationBlock).toMatch(/Activation rollback .*status/);
    expect(activationBlock).toContain('exit "$activation_status"');
  });

  it('pins every action to a full immutable commit with a version comment', () => {
    const actionLines = workflow
      .split('\n')
      .filter((line) => /^\s*-?\s*uses:/.test(line));

    expect(actionLines.length).toBeGreaterThanOrEqual(5);
    for (const line of actionLines) {
      expect(line).toMatch(/uses:\s+[\w-]+\/[\w-]+@[0-9a-f]{40}\s+# v\d/);
    }
  });

  it('does not let PR cancellation groups collide with main deployment runs', () => {
    expect(workflow).toContain("github.event_name == 'pull_request'");
    expect(workflow).toContain('github.run_id');
    expect(deployJob).toContain('group: snakish-production');
  });
});
