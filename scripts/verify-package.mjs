import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const MAX_PACKAGE_SIZE = 512 * 1024;
const REQUIRED_FILES = [
  'LICENSE',
  'README.md',
  'config.schema.json',
  'dist/index.js',
  'package.json',
];
const FORBIDDEN_PATHS = [
  /^\.env(?:\.|$)/,
  /^\.github\//,
  /^\.npmrc$/,
  /^coverage\//,
  /^scripts\//,
  /^src\//,
  /^test\//,
];

export function verifyPackageReport(report, packageJson) {
  if (!Array.isArray(report) || report.length !== 1) {
    throw new Error('npm pack must describe exactly one package');
  }

  const packed = report[0];
  if (packed.name !== packageJson.name || packed.version !== packageJson.version) {
    throw new Error(
      `Packed identity ${packed.name}@${packed.version} does not match ${packageJson.name}@${packageJson.version}`,
    );
  }
  if (typeof packed.filename !== 'string' ||
    path.basename(packed.filename) !== packed.filename ||
    !/^[A-Za-z0-9@._-]+\.tgz$/.test(packed.filename)) {
    throw new Error(`Unsafe or invalid package filename: ${packed.filename}`);
  }
  if (!Number.isFinite(packed.size) || packed.size <= 0 || packed.size > MAX_PACKAGE_SIZE) {
    throw new Error(`Package size ${packed.size} must be between 1 byte and ${MAX_PACKAGE_SIZE} bytes`);
  }
  if (!Array.isArray(packed.files)) {
    throw new Error('npm pack did not report package files');
  }

  const files = new Set(packed.files.map(file => file.path));
  for (const requiredFile of REQUIRED_FILES) {
    if (!files.has(requiredFile)) {
      throw new Error(`Package is missing required file: ${requiredFile}`);
    }
  }
  for (const file of files) {
    if (FORBIDDEN_PATHS.some(pattern => pattern.test(file))) {
      throw new Error(`Package contains forbidden development or sensitive path: ${file}`);
    }
  }

  return packed.filename;
}

async function main() {
  const reportPath = process.argv[2];
  if (!reportPath) {
    throw new Error('Usage: node scripts/verify-package.mjs <npm-pack-report.json>');
  }

  const [reportContents, packageContents] = await Promise.all([
    readFile(reportPath, 'utf8'),
    readFile('package.json', 'utf8'),
  ]);
  const filename = verifyPackageReport(JSON.parse(reportContents), JSON.parse(packageContents));
  await access(filename);
  process.stdout.write(filename);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
