import { Server } from "node:http";
import { createApp } from "./app.js";
import { config } from "./config/env.js";
import { connectDb, disconnectDb } from "./config/db.js";
import { logger } from "./utils/logger.js";
import { seedInitialCatalog } from "./modules/products/products.seed.js";

let server: Server | null = null;

const startServer = async (): Promise<void> => {
  try {
    logger.info("Starting Grocify Server...", {
      environment: config.nodeEnv,
      port: config.port,
    });

    // 1. Connect to MongoDB and seed baseline catalog if needed
    const db = await connectDb();
    await seedInitialCatalog(db);

    // 2. Initialize Express application
    const app = createApp();

    // 3. Start HTTP listener
    server = app.listen(config.port, () => {
      logger.info(`Server listening on port ${config.port} [http://localhost:${config.port}]`);
    });
  } catch (error) {
    logger.error("Failed to start server", {
      message: error instanceof Error ? error.message : "Unknown startup error",
    });
    process.exit(1);
  }
};

const handleGracefulShutdown = async (signal: string): Promise<void> => {
  logger.info(`Received ${signal}. Initiating graceful shutdown...`);

  if (server) {
    server.close(async () => {
      logger.info("HTTP server closed.");
      await disconnectDb();
      logger.info("Process terminating cleanly.");
      process.exit(0);
    });

    // Force shutdown after 10s timeout
    setTimeout(() => {
      logger.error("Forceful shutdown after timeout.");
      process.exit(1);
    }, 10000).unref();
  } else {
    await disconnectDb();
    process.exit(0);
  }
};

// Process event listeners for termination and uncaught errors
process.on("SIGINT", () => handleGracefulShutdown("SIGINT"));
process.on("SIGTERM", () => handleGracefulShutdown("SIGTERM"));

process.on("uncaughtException", (error: Error) => {
  logger.error("Uncaught Exception", {
    message: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

process.on("unhandledRejection", (reason: unknown) => {
  logger.error("Unhandled Promise Rejection", {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
  process.exit(1);
});

// Launch server
startServer();
