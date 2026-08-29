# SNAKISH repository guide

## Authoritative verification

GitHub Actions is the authoritative verification runtime. The unified
[CI workflow](.github/workflows/ci.yml) checks the exact event candidate and
runs this complete command set:

- `npm run typecheck`
- `npm run lint`
- `npm run format:check`
- `npm test`
- `npm run build`
- `npm run test:e2e`

Do not install dependencies or run lint, typecheck, tests, builds, databases,
Docker, Playwright, servers, browsers, or visual recording on Hermes. Do not
install, invoke, or reference Superpowers.

## Gameplay invariants

Preserve the accepted 20×20 board, three-segment start at `(10,10)`, initial
rightward movement, food at `(14,10)`, 10-point scoring, collision and board
completion behavior, restart state, and speed thresholds of 0/50/100/200 with
180/155/130/110 ms intervals. The complete gameplay, accessibility, persistence,
and browser invariants are in [the v1 acceptance guide](docs/v1-acceptance.md).
Boaz approval is required before changing these accepted behaviors.

## Deployment policy

Pull requests verify only and must never deploy or receive deployment
credentials. Boaz approves every pull request. Merging an approved pull request
into `main` automatically deploys the tested static artifact through GitHub
Actions; no separate production-environment approval is required after the
merge. Manual deployment is prohibited. Preserve rollback and smoke-test
behavior, and require Boaz approval for any deployment-policy change.
