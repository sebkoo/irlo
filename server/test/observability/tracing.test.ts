import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { describe, expect, it } from 'vitest';

import { startTracing, tracesEndpointFrom } from '../../src/observability/tracing.js';

describe('tracesEndpointFrom (C18)', () => {
  it('appends the OTLP traces resource path to a bare endpoint', () => {
    expect(tracesEndpointFrom('http://localhost:4318')).toBe('http://localhost:4318/v1/traces');
  });

  it('appends the resource path without doubling the slash when the endpoint already ends in one', () => {
    expect(tracesEndpointFrom('http://localhost:4318/')).toBe('http://localhost:4318/v1/traces');
  });
});

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
