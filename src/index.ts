/**
 * Express application entry point.
 */
import express from 'express';
import { config } from './config';
import { integrationsRouter } from './routes/integrations.routes';
import { applicationsRouter } from './routes/applications.routes';
import { analyticsRouter } from './routes/analytics.routes';
import { resumeRouter } from './routes/resume.routes';
import { timelineRouter } from './routes/timeline.routes';
import { recruitersRouter } from './routes/recruiters.routes';
import { companiesRouter } from './routes/companies.routes';
import { errorHandler } from './middleware/error-handler';

const app = express();

app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/integrations', integrationsRouter);
app.use('/applications', applicationsRouter);
app.use('/timeline', timelineRouter);
app.use('/recruiters', recruitersRouter);
app.use('/companies', companiesRouter);
app.use('/analytics', analyticsRouter);
app.use('/resume', resumeRouter);

// Global Error Handler
app.use(errorHandler);

export const server = app.listen(config.port, () => {
  console.info(`Server running in ${config.nodeEnv} mode on port ${config.port}`);
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.info('SIGTERM received. Shutting down gracefully.');
  server.close(() => {
    console.info('Process terminated.');
    process.exit(0);
  });
});
