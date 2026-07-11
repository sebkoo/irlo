import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { MemoryLogStream } from './support/memory-log-stream.js';

describe('structured request logging (C17)', () => {
  it('emits a JSON log line carrying a request id at info level', async () => {
    const stream = new MemoryLogStream();
    const app = buildApp({
      config: { NODE_ENV: 'test', PORT: 3000, LOG_LEVEL: 'info' },
      loggerStream: stream,
    });
    await app.ready();

    await request(app.server).get('/health');
    await app.close();

    const withReqId = stream.parsedLines().find((line) => typeof line['reqId'] === 'string');
    expect(withReqId).toBeDefined();
  });

  it('suppresses request-lifecycle logs below the configured level', async () => {
    const stream = new MemoryLogStream();
    const app = buildApp({
      config: { NODE_ENV: 'test', PORT: 3000, LOG_LEVEL: 'error' },
      loggerStream: stream,
    });
    await app.ready();

    await request(app.server).get('/health');
    await app.close();

    const withReqId = stream.parsedLines().find((line) => typeof line['reqId'] === 'string');
    expect(withReqId).toBeUndefined();
  });
});
