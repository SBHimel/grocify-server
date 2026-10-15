import express, { Application, Request, Response } from "express";
import cors from "cors";
import { config } from "./config/env.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { userRoutes } from "./modules/users/users.routes.js";
import { categoryRoutes } from "./modules/categories/categories.routes.js";
import { productRoutes } from "./modules/products/products.routes.js";
import { inventoryRoutes } from "./modules/inventory/inventory.routes.js";
import { reviewRoutes } from "./modules/reviews/reviews.routes.js";
import { errorHandler, notFoundHandler } from "./middlewares/error.js";
import { sendSuccess } from "./utils/response.js";

export const createApp = (): Application => {
  const app = express();

  // Cross-Origin Resource Sharing with normalized origin
  const normalizedClientUrl = config.clientUrl.replace(/\/+$/, "");
  const allowedOrigins: string[] = [normalizedClientUrl];

  if (config.nodeEnv === "development") {
    if (normalizedClientUrl.includes("localhost")) {
      allowedOrigins.push(normalizedClientUrl.replace("localhost", "127.0.0.1"));
    } else if (normalizedClientUrl.includes("127.0.0.1")) {
      allowedOrigins.push(normalizedClientUrl.replace("127.0.0.1", "localhost"));
    }
  }

  app.use(
    cors({
      credentials: true,
      origin: allowedOrigins,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );

  // Body parsers with safe size limits
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true, limit: "2mb" }));

  // Root endpoint
  app.get("/", (req: Request, res: Response) => {
    sendSuccess(res, {
      service: "Grocify API Server",
      version: "v1",
      healthCheck: "/api/v1/health",
      products: "/api/v1/products",
      categories: "/api/v1/categories",
      inventory: "/api/v1/batches",
    }, "Server is running fine!");
  });

  // API Routes
  app.use("/api/v1", healthRoutes);
  app.use("/api/v1", userRoutes);
  app.use("/api/v1", categoryRoutes);
  app.use("/api/v1", productRoutes);
  app.use("/api/v1", inventoryRoutes);
  app.use("/api/v1", reviewRoutes);

  // Legacy root-level compatibility mounts
  app.use("/", healthRoutes); // Compatibility for /health
  app.use("/", productRoutes); // Compatibility for /products and /product/:id
  app.use("/", reviewRoutes); // Compatibility for /products/:productId/reviews

  // Catch-all 404 handler
  app.use(notFoundHandler);

  // Global centralized error handler
  app.use(errorHandler);

  return app;
};
