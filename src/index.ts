/**
 * Express application entry point.
 */
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { config } from './config';
import { queueService } from './services/queue/queue.service';
import { prisma } from './config/database';
import { cacheService, RedisCacheService } from './services/cache/cache.service';
import { healthRouter } from './infrastructure/health/health.router';
import { requestLogger } from './infrastructure/logger/request-logger.middleware';
import { authRouter } from './routes/auth.routes';
import { integrationsRouter } from './routes/integrations.routes';
import { applicationsRouter } from './routes/applications.routes';
import { analyticsRouter } from './routes/analytics.routes';
import { dashboardRouter } from './routes/dashboard.routes';
import { resumeRouter } from './routes/resume.routes';
import { timelineRouter } from './routes/timeline.routes';
import { recruitersRouter } from './routes/recruiters.routes';
import { companiesRouter } from './routes/companies.routes';
import { errorHandler } from './middleware/error-handler';
import { logger } from './lib/logger';
import { initTracing, shutdownTracing } from './infrastructure/telemetry/tracing';
import { initMetrics, metrics } from './infrastructure/telemetry/metrics';
import blocked from 'blocked-at';
import {
  httpMethodProtection,
  requestLimits,
  parameterPollutionProtection,
  requestTimeout,
  securityHeaders,
} from './infrastructure/security/middleware';

const app = express();

// ── Startup Diagnostics ────────────────────────────────────────────────────────
const startupTime = Date.now();

async function runStartupDiagnostics(): Promise<void> {
  logger.info('Starting application...', {
    nodeEnv: config.nodeEnv,
    nodeVersion: process.version,
    appVersion: config.appVersion,
    gitCommit: config.gitCommit,
    buildTimestamp: config.buildTimestamp,
  });

  // Test database connection
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info('Database connection successful');
  } catch (err) {
    logger.error('Database connection failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // Test Redis connection
  if (cacheService instanceof RedisCacheService) {
    try {
      await cacheService.ping();
      logger.info('Redis connection successful');
    } catch (err) {
      logger.error('Redis connection failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('Startup diagnostics complete', {
    startupDurationMs: Date.now() - startupTime,
  });
}

// ── Initialize Observability ───────────────────────────────────────────────────
function initObservability(): void {
  initTracing();
  initMetrics();

  // Monitor event loop lag
  blocked(
    (time: number, stack: string[]) => {
      logger.warn('Event loop blocked', {
        durationMs: time,
        thresholdMs: config.thresholds.eventLoopBlocked,
        stack,
      });
      metrics.eventLoopLagGauge.set(time);
    },
    { threshold: config.thresholds.eventLoopBlocked },
  );
}

// ── 1. Trust proxy ────────────────────────────────────────────────────────────
app.set('trust proxy', 1);

// ── 2. Request logger — attach requestId/correlationId ───────────────────────
app.use(requestLogger);

// ── 3. Helmet — HTTP security headers ────────────────────────────────────────
const cspDirectives = config.security.cspDirectives
  ? config.security.cspDirectives.split(';').reduce(
      (acc, d) => {
        const [key, ...valParts] = d.trim().split(' ');
        if (key) {
          acc[key] = valParts.join(' ');
        }
        return acc;
      },
      {} as Record<string, string>,
    )
  : {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    };

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: cspDirectives,
    },
    hsts: config.security.hsts.enabled
      ? {
          maxAge: config.security.hsts.maxAge,
          includeSubDomains: config.security.hsts.includeSubdomains,
          preload: config.security.hsts.preload,
        }
      : false,
    xFrameOptions: { action: config.security.xFrameOptions.toLowerCase() as 'deny' | 'sameorigin' },
    referrerPolicy: { policy: config.security.referrerPolicy as any },
    crossOriginEmbedderPolicy:
      config.security.coep === 'unsafe-none' ? false : { policy: config.security.coep as any },
    crossOriginOpenerPolicy:
      config.security.coop === 'unsafe-none' ? false : { policy: config.security.coop as any },
    crossOriginResourcePolicy: { policy: config.security.corp as any },
  }),
);

app.use(securityHeaders());

// ── 4. CORS ───────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      const { allowedOrigins } = config.cors;

      if (allowedOrigins.length === 0) {
        if (config.isProduction) {
          return callback(new Error(`CORS: origin '${origin}' not allowed`));
        }
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      callback(new Error(`CORS: origin '${origin}' not allowed`));
    },
    methods: config.cors.allowedMethods,
    allowedHeaders: config.cors.allowedHeaders,
    exposedHeaders: config.cors.exposedHeaders,
    credentials: config.cors.credentials,
    maxAge: config.cors.preflightCache,
  }),
);

// ── 5. Compression ────────────────────────────────────────────────────────────
app.use(compression({ threshold: 1024 }));

// ── 6. Security middleware ────────────────────────────────────────────────────
app.use(httpMethodProtection());
app.use(requestLimits());
app.use(requestTimeout());
app.use(parameterPollutionProtection());

// ── 7. Body parsing — explicit size limit to prevent DoS ─────────────────────
app.use(express.json({ limit: config.limits.maxJsonSize, strict: config.validation.strict }));
app.use(express.urlencoded({ extended: true, limit: config.limits.maxBodySize }));

// ── Health endpoints (unauthenticated) ───────────────────────────────────────
app.use(healthRouter);

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/auth', authRouter);
app.use('/integrations', integrationsRouter);
app.use('/applications', applicationsRouter);
app.use('/timeline', timelineRouter);
app.use('/recruiters', recruitersRouter);
app.use('/companies', companiesRouter);
app.use('/analytics', analyticsRouter);
app.use('/dashboard', dashboardRouter);
app.use('/resume', resumeRouter);

// ── Global error handler ──────────────────────────────────────────────────────
app.use(errorHandler);

// ── Server startup ────────────────────────────────────────────────────────────
export const server = app.listen(config.port, () => {
  initObservability();
  runStartupDiagnostics().catch((err) =>
    logger.error('Failed to run startup diagnostics', { error: err }),
  );

  logger.info(`Server running in ${config.nodeEnv} mode on port ${config.port}`);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`${signal} received — shutting down gracefully`);

  server.close(() => {
    (async () => {
      try {
        await shutdownTracing();
        await queueService.close();
        await prisma.$disconnect();
        if (cacheService instanceof RedisCacheService) {
          await cacheService.disconnect();
        }
        logger.info('All connections closed — process exiting');
        process.exit(0);
      } catch (err) {
        logger.error('Error during shutdown', {
          message: err instanceof Error ? err.message : String(err),
        });
        process.exit(1);
      }
    })();
  });

  // Force shutdown after timeout
  setTimeout(() => {
    logger.error('Shutdown timed out, forcing exit');
    process.exit(1);
  }, config.timeouts.shutdown);
}

process.on('SIGTERM', () => {
  gracefulShutdown('SIGTERM').catch((err) => logger.error('Failed to shutdown', { error: err }));
});
process.on('SIGINT', () => {
  gracefulShutdown('SIGINT').catch((err) => logger.error('Failed to shutdown', { error: err }));
});

// ── Unhandled rejection / exception safety nets ───────────────────────────────
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
});

process.on('uncaughtException', (err: Error) => {
  logger.error('Uncaught exception — process will exit', { message: err.message });
  process.exit(1);
});
