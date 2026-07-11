import { readFileSync } from 'node:fs';

/**
 * Parse one `# --- Section ---` block of a dotenv-style file into key/value
 * pairs. Shared by the env-contract and compose-contract specs so both read
 * `.env.example` the same way.
 */
export function parseDotenvSection(path: string, sectionHeader: string): Record<string, string> {
  const lines = readFileSync(path, 'utf-8').split('\n');
  const vars: Record<string, string> = {};
  let inSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('# ---')) {
      inSection = trimmed === sectionHeader;
      continue;
    }
    if (!inSection || trimmed === '' || trimmed.startsWith('#')) continue;

    const [key, ...rest] = trimmed.split('=');
    if (key) vars[key] = rest.join('=');
  }

  return vars;
}
