import { Response } from "express";
import { ApiResponse } from "../types/index.js";

export const sendSuccess = <T>(
  res: Response,
  data?: T,
  message?: string,
  statusCode = 200,
  meta?: Record<string, unknown>
): Response => {
  const payload: ApiResponse<T> = {
    success: true,
    ...(message ? { message } : {}),
    ...(data !== undefined ? { data } : {}),
    ...(meta ? { meta, pagination: meta as any } : {}),
  };
  return res.status(statusCode).json(payload);
};

export const sendError = (
  res: Response,
  message: string,
  statusCode = 500,
  errorCode?: string,
  details?: unknown
): Response => {
  const payload: ApiResponse = {
    success: false,
    message,
    ...(errorCode || details
      ? {
          error: {
            ...(errorCode ? { code: errorCode } : {}),
            ...(details ? { details } : {}),
          },
        }
      : {}),
  };
  return res.status(statusCode).json(payload);
};
