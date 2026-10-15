import { Request, Response } from "express";
import { isDbConnected } from "../../config/db.js";
import { config } from "../../config/env.js";
import { sendSuccess } from "../../utils/response.js";

export const getHealthStatus = (req: Request, res: Response): Response => {
  const dbStatus = isDbConnected() ? "connected" : "disconnected";

  return sendSuccess(res, {
    status: "ok",
    service: "grocify-server",
    environment: config.nodeEnv,
    database: dbStatus,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  }, "Server is running healthy");
};
