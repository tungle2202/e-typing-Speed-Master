#!/usr/bin/env node
/**
 * Build the extension for each browser into dist/<target>/ and zip it.
 *
 *   node scripts/build.mjs            # chromium + firefox
 *   node scripts/build.mjs firefox    # one target only
 *
 * - chromium: manifest.json as-is.
 * - firefox:  manifest.json deep-merged with manifest.firefox.json, with background.service_worker removed
 *             (Firefox MV3 runs background.scripts as an event page instead).
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const FILES = ['background.js', 'content', 'popup', 'assets', 'LICENSE'];
const TARGETS = ['chromium', 'firefox'];

const readJson = (file) => JSON.parse(readFileSync(join(ROOT, file), 'utf8'));

function deepMerge(base, overlay) {
  const out = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const isObject = value && typeof value === 'object' && !Array.isArray(value);
    out[key] = isObject && base[key] && typeof base[key] === 'object' ? deepMerge(base[key], value) : value;
  }
  return out;
}

function manifestFor(target) {
  const manifest = readJson('manifest.json');
  if (target !== 'firefox') return manifest;

  const merged = deepMerge(manifest, readJson('manifest.firefox.json'));
  delete merged.background.service_worker;
  return merged;
}

function build(target) {
  const outDir = join(DIST, target);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  for (const file of FILES) {
    if (existsSync(join(ROOT, file))) cpSync(join(ROOT, file), join(outDir, file), { recursive: true });
  }
  const manifest = manifestFor(target);
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  const zipPath = join(DIST, `ghosttyper-${target}-v${manifest.version}.zip`);
  rmSync(zipPath, { force: true });
  execFileSync('zip', ['-qr', zipPath, '.'], { cwd: outDir });
  console.log(`${target}: ${outDir} -> ${zipPath}`);
}

const requested = process.argv.slice(2);
const unknown = requested.filter((t) => !TARGETS.includes(t));
if (unknown.length) {
  console.error(`Unknown target(s): ${unknown.join(', ')}. Use: ${TARGETS.join(', ')}`);
  process.exit(1);
}
(requested.length ? requested : TARGETS).forEach(build);
