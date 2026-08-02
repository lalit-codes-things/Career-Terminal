import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  BatchSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import {
  AlwaysOnSampler,
  AlwaysOffSampler,
  TraceIdRatioBasedSampler,
  ParentBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { config } from '../../config';
import { logger } from '../../lib/logger';

let sdk: NodeSDK | null = null;

function getSampler() {
  const { tracingSampler, tracingSamplerRatio } = config.telemetry;

  switch (tracingSampler) {
    case 'always_on':
      return new AlwaysOnSampler();
    case 'always_off':
      return new AlwaysOffSampler();
    case 'traceidratio':
      return new TraceIdRatioBasedSampler(tracingSamplerRatio);
    case 'parentbased_always_on':
      return new ParentBasedSampler({ root: new AlwaysOnSampler() });
    case 'parentbased_always_off':
      return new ParentBasedSampler({ root: new AlwaysOffSampler() });
    case 'parentbased_traceidratio':
      return new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(tracingSamplerRatio) });
    default:
      return new ParentBasedSampler({ root: new AlwaysOnSampler() });
  }
}

function getExporter() {
  const { tracingExporterType, otlpEndpoint } = config.telemetry;

  switch (tracingExporterType) {
    case 'otlp':
      return new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` });
    case 'console':
      return new ConsoleSpanExporter();
    case 'none':
    default:
      return null;
  }
}

export function initTracing(): void {
  if (!config.telemetry.tracingEnabled) {
    logger.info('Tracing is disabled');
    return;
  }

  try {
    const exporter = getExporter();
    const processor = exporter
      ? new BatchSpanProcessor(exporter)
      : new SimpleSpanProcessor(new ConsoleSpanExporter());

    sdk = new NodeSDK({
      sampler: getSampler(),
      traceExporter: exporter || new ConsoleSpanExporter(),
      spanProcessors: [processor],
      textMapPropagator: new W3CTraceContextPropagator(),
      instrumentations: [
        new ExpressInstrumentation(),
        new HttpInstrumentation(),
        new PgInstrumentation(),
        new IORedisInstrumentation(),
      ],
    });

    sdk.start();
    logger.info('Tracing initialized');
  } catch (err) {
    logger.error('Failed to initialize tracing', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    try {
      await sdk.shutdown();
      logger.info('Tracing shut down');
    } catch (err) {
      logger.error('Failed to shutdown tracing', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
