import type { Tracer } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { BatchSpanProcessor, type SpanExporter } from '@opentelemetry/sdk-trace-base';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

export interface StartTracingOptions {
  serviceName: string;
  /** OTLP/HTTP collector endpoint, e.g. `serverEnvSchema.OTEL_EXPORTER_OTLP_ENDPOINT`. */
  otlpEndpoint?: string;
  /**
   * Test injection seam, same staged-rollout shape as `buildApp`'s `db` and
   * `loggerStream` options: pass an `InMemorySpanExporter` to assert on
   * captured spans without ever exporting over the network.
   */
  spanExporter?: SpanExporter;
}

export interface Tracing {
  tracer: Tracer;
  /** Exports buffered spans without stopping the provider — the assertion seam for tests. */
  flush: () => Promise<void>;
  shutdown: () => Promise<void>;
}

/**
 * Bootstraps a NodeTracerProvider, or returns undefined (noop/off) when
 * neither a spanExporter nor an otlpEndpoint is given — the default for
 * every existing buildApp caller, so current suites stay unaffected.
 */
export function startTracing(options: StartTracingOptions): Tracing | undefined {
  const exporter =
    options.spanExporter ??
    (options.otlpEndpoint === undefined
      ? undefined
      : new OTLPTraceExporter({ url: options.otlpEndpoint }));

  if (exporter === undefined) return undefined;

  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: options.serviceName }),
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });

  return {
    tracer: provider.getTracer(options.serviceName),
    flush: () => provider.forceFlush(),
    shutdown: () => provider.shutdown(),
  };
}
