/**
 * Express application entry point.
 */
import express from 'express';
import { config } from './config';
import { integrationsRouter } from './routes/integrations.routes';
import { errorHandler } from './middleware/error-handler';

const app = express();

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/integrations', integrationsRouter);

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
