#!/usr/bin/env node
// Extracts every fenced ```mermaid block from the repo's markdown and renders
// each with @mermaid-js/mermaid-cli (mmdc) — a mermaid.js engine, the same
// one GitHub also uses, catching real parse/syntax errors. NOT a GitHub-render
// guarantee: mmdc 11.16.0 rendered the exact block that crashed GitHub's
// renderer (found 2026-07-11 fixing the README diagram) — a version/engine
// mismatch this gate can't close. Treat it as a syntax guard, not proof
// GitHub will render cleanly. Per-commit code review can't see GitHub-side
// rendering either way, so this is still the best mechanical gate available:
// wired into `make lint` and CI (see Makefile, ci.yml).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function listMarkdownFiles() {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '*.md'],
    { cwd: repoRoot, encoding: 'utf-8' },
  );
  return output.split('\n').filter(Boolean);
}

function extractMermaidBlocks(content) {
  const blocks = [];
  const lines = content.split('\n');
  let inBlock = false;
  let startLine = 0;
  let current = [];

  for (const [index, line] of lines.entries()) {
    if (!inBlock && line.trim() === '```mermaid') {
      inBlock = true;
      startLine = index + 1;
      current = [];
      continue;
    }
    if (inBlock && line.trim() === '```') {
      inBlock = false;
      blocks.push({ startLine, source: current.join('\n') });
      continue;
    }
    if (inBlock) current.push(line);
  }

  return blocks;
}

const puppeteerConfigPath = join(repoRoot, 'scripts', 'mermaid-puppeteer-config.json');
const tmpDir = mkdtempSync(join(tmpdir(), 'mermaid-validate-'));
let failures = 0;
let checked = 0;

try {
  for (const file of listMarkdownFiles()) {
    const content = readFileSync(join(repoRoot, file), 'utf-8');
    const blocks = extractMermaidBlocks(content);

    for (const block of blocks) {
      checked += 1;
      const inputPath = join(tmpDir, `block-${checked}.mmd`);
      const outputPath = join(tmpDir, `block-${checked}.svg`);
      writeFileSync(inputPath, block.source);

      try {
        execFileSync(
          'pnpm',
          [
            'exec',
            'mmdc',
            '--puppeteerConfigFile',
            puppeteerConfigPath,
            '-i',
            inputPath,
            '-o',
            outputPath,
          ],
          { cwd: repoRoot, stdio: 'pipe' },
        );
      } catch (error) {
        failures += 1;
        console.error(`\n✗ ${file}:${block.startLine} — mermaid block failed to render`);
        console.error(error.stderr?.toString() ?? error.message);
      }
    }
  }
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures}/${checked} mermaid block(s) failed to render.`);
  process.exit(1);
}

console.log(`✓ ${checked} mermaid block(s) rendered cleanly.`);
