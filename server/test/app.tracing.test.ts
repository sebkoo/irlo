import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { startTracing } from '../src/observability/tracing.js';
import { MemoryLogStream } from './support/memory-log-stream.js';

describe('trace context in request logs (C18)', () => {
  it('attaches the active span traceId/spanId to a request log line when tracing is enabled', async () => {
    const stream = new MemoryLogStream();
    const exporter = new InMemorySpanExporter();
    const tracing = startTracing({ serviceName: 'irlo-server-test', spanExporter: exporter });
    const app = buildApp({
      config: { NODE_ENV: 'test', PORT: 3000, LOG_LEVEL: 'info' },
      loggerStream: stream,
      tracing,
    });
    await app.ready();

    await request(app.server).get('/health');
    await app.close();
    await tracing?.flush();

    const withTraceContext = stream
      .parsedLines()
      .find((line) => typeof line['traceId'] === 'string');
    expect(withTraceContext).toBeDefined();
    expect(typeof withTraceContext?.['spanId']).toBe('string');

    const [span] = exporter.getFinishedSpans();
    expect(span?.spanContext().traceId).toBe(withTraceContext?.['traceId']);
    expect(span?.spanContext().spanId).toBe(withTraceContext?.['spanId']);
  });

  it('carries no trace context when tracing is not provided, leaving existing suites unaffected', async () => {
    const stream = new MemoryLogStream();
    const app = buildApp({
      config: { NODE_ENV: 'test', PORT: 3000, LOG_LEVEL: 'info' },
      loggerStream: stream,
    });
    await app.ready();

    await request(app.server).get('/health');
    await app.close();

    const withTraceContext = stream
      .parsedLines()
      .find((line) => typeof line['traceId'] === 'string');
    expect(withTraceContext).toBeUndefined();
  });
});
