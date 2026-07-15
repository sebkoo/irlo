#!/usr/bin/env node
// Parses NEXT_STEPS.md's stage/item conventions (see its own "Status
// convention" paragraph) into { stage -> [named items] } and renders a
// README progress block between <!-- progress:begin --> / <!-- progress:end -->.
// Node stdlib only — no markdown parsing library, mirroring
// scripts/validate-mermaid.mjs's own no-new-dependency line-scan approach.
//
// Fail-closed by design: a line shaped like a stage header, table row, or
// C-numbered/lettered item that doesn't fully match its expected shape is a
// loud, line-numbered error — never a silent skip. A parser that guesses is
// a staleness machine with extra steps. Lines that aren't shaped like any
// tracked structure (ordinary prose, unrelated "##" sections, non-C
// bullets) are simply not items — that's not a fail-closed violation, it's
// content outside this generator's scope by design.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const STAGE_HEADER_RE = /^## Stage (?:\d+|AI) — .+$/;
const STAGE_HEADER_ATTEMPT_RE = /^## Stage\b/i;
const TABLE_ROW_ATTEMPT_RE = /^\|\s*C\d/i;
const TABLE_ROW_RE = /^\|\s*(C\d+(?:[–—-]C?\d+)?)\s*\|(.*)\|(.*)\|$/;
const BULLET_SLICE_ATTEMPT_RE = /^- \*\*\(/;
const BULLET_SLICE_RE = /^- \*\*\(([A-Z])\)\*\*\s+(.+)$/;
const BULLET_C_ATTEMPT_RE = /^- C\d/;
const BULLET_C_RE = /^- (C\d+(?:[–—-]C?\d+)?)\s+(.+)$/;

// One level of nested parens is enough for every marker seen in
// NEXT_STEPS.md today (e.g. a "(done: ... `(source, event_id)`)" clause) —
// deeper nesting would leave a stray ")" in the stripped name, a cosmetic
// gap caught by the "show the rendered block before committing" checkpoint,
// not a fail-closed correctness gap (state detection only needs the
// "(done" prefix, which this still finds regardless of how the group closes).
const DONE_MARKER_RE = /\(done\b(?:[^()]|\([^()]*\))*\)/gi;
const DONE_MARKER_TEST_RE = /\(done\b(?:[^()]|\([^()]*\))*\)/i;
const IN_PROGRESS_MARKER_RE = /\(in progress\)/gi;
const IN_PROGRESS_MARKER_TEST_RE = /\(in progress\)/i;

const STATE_EMOJI = { done: '✅', in_progress: '🚧', planned: '📋' };

// Mechanical mitigation for long item text (a length cutoff, not an
// importance judgment about what to keep): anything over FOLD_THRESHOLD
// chars collapses behind <details><summary>; the full text stays present
// (searchable, and visible on expand), just not pre-rendered inline.
const FOLD_THRESHOLD = 200;
const SUMMARY_LENGTH = 100;

function truncateForSummary(text, maxLen) {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  const boundary = lastSpace > maxLen * 0.4 ? lastSpace : maxLen;
  return `${cut.slice(0, boundary)}…`;
}

function renderItemRow(item) {
  const emoji = STATE_EMOJI[item.state];
  if (item.name.length <= FOLD_THRESHOLD) {
    return `- ${emoji} **${item.id}** — ${item.name}`;
  }
  const summary = truncateForSummary(item.name, SUMMARY_LENGTH);
  return `- ${emoji} **${item.id}** — <details><summary>${summary}</summary> ${item.name}</details>`;
}

const MARK_BEGIN = '<!-- progress:begin -->';
const MARK_END = '<!-- progress:end -->';

export class GenProgressError extends Error {
  constructor(errors) {
    super(errors.map((e) => `NEXT_STEPS.md:${e.line}: ${e.message}`).join('\n'));
    this.name = 'GenProgressError';
    this.errors = errors;
  }
}

function stripMarkers(text) {
  return text
    .replace(DONE_MARKER_RE, '')
    .replace(IN_PROGRESS_MARKER_RE, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
}

function classifyState(text, line, errors) {
  const hasDone = DONE_MARKER_TEST_RE.test(text);
  const hasInProgress = IN_PROGRESS_MARKER_TEST_RE.test(text);
  if (hasDone && hasInProgress) {
    errors.push({ line, message: 'item declares both a done and an in-progress marker' });
    return null;
  }
  if (hasDone) return 'done';
  if (hasInProgress) return 'in_progress';
  return 'planned';
}

export function parseNextSteps(source) {
  const lines = source.split('\n');
  const errors = [];
  const stages = [];
  const seenCIds = new Map();
  let currentStage = null;
  let openItem = null;

  const finalizeItem = (kind, id, lineNo, text) => {
    const state = classifyState(text, lineNo, errors);
    if (state === null) return;

    if (kind === 'c') {
      if (seenCIds.has(id)) {
        errors.push({ line: lineNo, message: `duplicate C-number "${id}" (first seen at line ${seenCIds.get(id)})` });
        return;
      }
      seenCIds.set(id, lineNo);
      currentStage.items.push({ id, name: stripMarkers(text), state });
      return;
    }

    // kind === 'slice'
    if (currentStage.seenSliceLetters.has(id)) {
      errors.push({ line: lineNo, message: `duplicate slice letter "${id}" within "${currentStage.title}"` });
      return;
    }
    currentStage.seenSliceLetters.add(id);
    currentStage.items.push({ id: `Slice ${id}`, name: stripMarkers(text), state });
  };

  const closeOpenItem = () => {
    if (!openItem) return;
    const text = openItem.textParts.join(' ').replace(/\s{2,}/g, ' ').trim();
    finalizeItem(openItem.kind, openItem.id, openItem.lineNo, text);
    openItem = null;
  };

  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    const trimmed = rawLine.trim();

    if (trimmed === '') {
      closeOpenItem();
      return;
    }

    if (STAGE_HEADER_RE.test(trimmed)) {
      closeOpenItem();
      currentStage = { title: trimmed.replace(/^##\s*/, ''), items: [], seenSliceLetters: new Set() };
      stages.push(currentStage);
      return;
    }
    if (STAGE_HEADER_ATTEMPT_RE.test(trimmed)) {
      closeOpenItem();
      errors.push({ line: lineNo, message: `malformed stage header: "${trimmed}"` });
      return;
    }
    if (trimmed.startsWith('##')) {
      closeOpenItem();
      currentStage = null;
      return;
    }

    if (trimmed.startsWith('|')) {
      closeOpenItem();
      if (!TABLE_ROW_ATTEMPT_RE.test(trimmed)) return; // ordinary table scaffolding, not an item
      const m = TABLE_ROW_RE.exec(trimmed);
      if (!m) {
        errors.push({ line: lineNo, message: `malformed table row: "${trimmed}"` });
        return;
      }
      if (!currentStage) {
        errors.push({ line: lineNo, message: 'table item found outside any Stage section' });
        return;
      }
      finalizeItem('c', m[1], lineNo, m[2].trim());
      return;
    }

    if (trimmed.startsWith('- ')) {
      closeOpenItem();
      if (BULLET_SLICE_ATTEMPT_RE.test(trimmed)) {
        const m = BULLET_SLICE_RE.exec(trimmed);
        if (!m) {
          errors.push({ line: lineNo, message: `malformed slice bullet: "${trimmed}"` });
          return;
        }
        if (!currentStage) {
          errors.push({ line: lineNo, message: 'slice item found outside any Stage section' });
          return;
        }
        openItem = { kind: 'slice', id: m[1], lineNo, textParts: [m[2]] };
        return;
      }
      if (BULLET_C_ATTEMPT_RE.test(trimmed)) {
        const m = BULLET_C_RE.exec(trimmed);
        if (!m) {
          errors.push({ line: lineNo, message: `malformed C-item bullet: "${trimmed}"` });
          return;
        }
        if (!currentStage) {
          errors.push({ line: lineNo, message: 'item found outside any Stage section' });
          return;
        }
        openItem = { kind: 'c', id: m[1], lineNo, textParts: [m[2]] };
        return;
      }
      return; // an ordinary bullet, not a tracked item
    }

    if (openItem && !trimmed.startsWith('**')) {
      openItem.textParts.push(trimmed);
      return;
    }
    closeOpenItem();
  });
  closeOpenItem();

  if (errors.length > 0) {
    throw new GenProgressError(errors);
  }
  return { stages };
}

export function renderProgressBlock(stages) {
  return stages
    .map((stage) => {
      const heading = `### ${stage.title}`;
      if (stage.items.length === 0) {
        return `${heading}\n\n_No slice-level items yet — see the stage heading in NEXT_STEPS.md._`;
      }
      const rows = stage.items.map(renderItemRow);
      return `${heading}\n\n${rows.join('\n')}`;
    })
    .join('\n\n');
}

export function spliceReadme(readmeText, block) {
  const beginIdx = readmeText.indexOf(MARK_BEGIN);
  const endIdx = readmeText.indexOf(MARK_END);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    throw new Error(`README.md is missing the ${MARK_BEGIN} / ${MARK_END} markers`);
  }
  const before = readmeText.slice(0, beginIdx + MARK_BEGIN.length);
  const after = readmeText.slice(endIdx);
  return `${before}\n\n${block}\n\n${after}`;
}

function main() {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const nextStepsPath = join(repoRoot, 'NEXT_STEPS.md');
  const readmePath = join(repoRoot, 'README.md');

  const { stages } = parseNextSteps(readFileSync(nextStepsPath, 'utf-8'));
  const block = renderProgressBlock(stages);
  const readmeText = readFileSync(readmePath, 'utf-8');
  const updated = spliceReadme(readmeText, block);

  if (process.argv.includes('--check')) {
    if (updated !== readmeText) {
      console.error('✗ README.md progress block is stale — run `make docs-progress` to regenerate.');
      process.exitCode = 1;
      return;
    }
    console.log('✓ README.md progress block is up to date.');
    return;
  }

  writeFileSync(readmePath, updated);
  console.log('✓ README.md progress block regenerated.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
