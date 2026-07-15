import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { describe, expect, it } from 'vitest';

import { startTracing } from '../../src/observability/tracing.js';

describe('startTracing (C18)', () => {
  it('stays off by default when neither an exporter nor an endpoint is configured', () => {
    const tracing = startTracing({ serviceName: 'irlo-server' });

    expect(tracing).toBeUndefined();
  });

  it('exports spans through an injected in-memory exporter when enabled for tests', async () => {
    const exporter = new InMemorySpanExporter();
    const tracing = startTracing({ serviceName: 'irlo-server', spanExporter: exporter });

    expect(tracing).toBeDefined();
    tracing?.tracer.startSpan('test-span').end();
    await tracing?.flush();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.name).toBe('test-span');
  });

  it('builds a real OTLP exporter from an endpoint without making any network calls at construction time', async () => {
    const tracing = startTracing({
      serviceName: 'irlo-server',
      otlpEndpoint: 'http://localhost:4318',
    });

    expect(tracing).toBeDefined();
    await tracing?.shutdown();
  });
});
