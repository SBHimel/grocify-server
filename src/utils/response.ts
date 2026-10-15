import { Response } from "express";
import { ApiResponse } from "../types/index.js";

export const sendSuccess = <T>(
  res: Response,
  data?: T,
  message?: string,
  statusCode = 200
): Response => {
  const payload: ApiResponse<T> = {
    success: true,
    ...(message ? { message } : {}),
    ...(data !== undefined ? { data } : {}),
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
