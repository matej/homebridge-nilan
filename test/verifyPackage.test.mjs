import { describe, expect, it } from 'vitest';

import { verifyPackageReport } from '../scripts/verify-package.mjs';

const packageJson = {
  name: 'homebridge-nilan',
  version: '2.0.0',
};

function createReport(overrides = {}) {
  return [{
    name: packageJson.name,
    version: packageJson.version,
    filename: 'homebridge-nilan-2.0.0.tgz',
    size: 1024,
    files: [
      { path: 'LICENSE' },
      { path: 'README.md' },
      { path: 'config.schema.json' },
      { path: 'dist/index.js' },
      { path: 'package.json' },
    ],
    ...overrides,
  }];
}

describe('verifyPackageReport', () => {
  it('accepts the expected publishable package', () => {
    expect(verifyPackageReport(createReport(), packageJson)).toBe('homebridge-nilan-2.0.0.tgz');
  });

  it('rejects a package with a mismatched version', () => {
    expect(() => verifyPackageReport(createReport({ version: '1.0.0' }), packageJson))
      .toThrow('does not match');
  });

  it('rejects a package without its compiled entry point', () => {
    const files = createReport()[0].files.filter(file => file.path !== 'dist/index.js');
    expect(() => verifyPackageReport(createReport({ files }), packageJson))
      .toThrow('Package is missing required file: dist/index.js');
  });

  it('rejects source and sensitive files', () => {
    const files = [...createReport()[0].files, { path: '.npmrc' }];
    expect(() => verifyPackageReport(createReport({ files }), packageJson))
      .toThrow('Package contains forbidden development or sensitive path: .npmrc');
  });

  it('rejects an unexpectedly large package', () => {
    expect(() => verifyPackageReport(createReport({ size: 512 * 1024 + 1 }), packageJson))
      .toThrow('must be between');
  });

  it('rejects an unsafe tarball filename', () => {
    expect(() => verifyPackageReport(createReport({ filename: '../package.tgz' }), packageJson))
      .toThrow('Unsafe or invalid package filename');
  });

  it('rejects control characters and shell metacharacters in a tarball filename', () => {
    expect(() => verifyPackageReport(createReport({ filename: 'package\n$(command).tgz' }), packageJson))
      .toThrow('Unsafe or invalid package filename');
  });
});
