# Contributing

Thanks for helping improve Homebridge Nilan.

## Before opening a change

- Search existing issues and pull requests for related work.
- Keep changes focused. Protocol fixes, dependency maintenance, and documentation
  are easier to review as separate pull requests.
- Do not test against someone else's Nilan unit or commit real device addresses,
  Homebridge configuration, credentials, logs, or generated `dist/` files.

## Development setup

Use Node.js 22 or 24. The repository's `.nvmrc` selects Node.js 22.

```sh
nvm use
npm ci
npm run check
```

`npm run check` runs linting, a strict TypeScript build, and the Vitest suite with
coverage thresholds. Tests must use mocked Modbus I/O unless a maintainer has
explicitly arranged hardware testing.

See `AGENTS.md` for the source map, protocol invariants, HomeKit identity rules,
and detailed validation guidance.

## Pull requests

- Explain the user-visible impact and root cause.
- Add regression tests for bug fixes and focused tests for new behavior.
- Keep `config.schema.json`, runtime configuration, and `README.md` aligned.
- Call out any behavior that could not be tested on a real CTS700 Compact P.
- Preserve plugin/platform identifiers, accessory UUID derivation, and HomeKit
  service subtype strings unless the change intentionally includes a migration.

## Reporting bugs

Include the Homebridge version, plugin version, Node.js version, Compact P/CTS700
details, configuration with secrets removed, relevant logs, and clear reproduction
steps. Use GitHub's private vulnerability reporting for security-sensitive issues.

## Releases

Release maintainers should follow [RELEASING.md](RELEASING.md). Publishing is
performed by GitHub Actions through npm trusted publishing; do not add an npm
access token to the repository.
