import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger.js";
import { sendError } from "../utils/response.js";
import { config } from "../config/env.js";

export class AppError extends Error {
  public statusCode: number;
  public errorCode?: string;
  public isOperational: boolean;

  constructor(message: string, statusCode = 500, errorCode?: string) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const notFoundHandler = (req: Request, res: Response): void => {
  sendError(res, `Route not found: ${req.method} ${req.originalUrl}`, 404, "NOT_FOUND");
};

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void => {
  const statusCode = "statusCode" in err && typeof err.statusCode === "number" ? err.statusCode : 500;
  const errorCode = "errorCode" in err ? (err.errorCode as string) : "INTERNAL_SERVER_ERROR";
  const message = err.message || "An unexpected internal server error occurred.";

  logger.error(`[Error] ${req.method} ${req.originalUrl}: ${message}`, {
    statusCode,
    errorCode,
    stack: config.nodeEnv === "development" ? err.stack : undefined,
  });

  sendError(
    res,
    message,
    statusCode,
    errorCode,
    config.nodeEnv === "development" ? { stack: err.stack } : undefined
  );
};
