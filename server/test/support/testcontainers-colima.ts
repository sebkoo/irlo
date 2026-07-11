import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Testcontainers doesn't auto-detect colima's non-standard socket path, and
 * colima's Ryuk (resource-reaper) socket bind-mount fails across the VM
 * boundary (docs/runbook.md #Local dev environment (colima)). Only applies
 * when DOCKER_HOST isn't already set (never overrides an explicit choice —
 * CI's native Docker is unaffected) and the colima socket actually exists
 * (never applies on a machine that isn't using colima).
 */
const colimaSocket = path.join(os.homedir(), '.colima', 'default', 'docker.sock');

if (!process.env['DOCKER_HOST'] && existsSync(colimaSocket)) {
  process.env['DOCKER_HOST'] = `unix://${colimaSocket}`;
  process.env['TESTCONTAINERS_RYUK_DISABLED'] = 'true';
}
