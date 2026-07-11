import { healthStatusSchema } from '@irlo/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { MemoryLogStream } from './support/memory-log-stream.js';

describe('GET /health', () => {
  it('returns a payload matching the shared contract', async () => {
    const app = buildApp({ loggerStream: new MemoryLogStream() });
    await app.ready();

    const response = await request(app.server).get('/health');

    expect(response.status).toBe(200);
    expect(healthStatusSchema.parse(response.body)).toEqual(response.body);

    await app.close();
  });
});
