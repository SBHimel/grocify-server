import { Request, Response, NextFunction } from "express";
import { ObjectId } from "mongodb";
import { AppError } from "./error.js";

/**
 * Validates that an Express route parameter is a valid MongoDB ObjectId.
 * Returns HTTP 400 Bad Request if invalid instead of causing a 500 server crash.
 */
export const validateObjectIdParam = (paramName = "id") => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const rawParam = req.params[paramName];
    const idStr = Array.isArray(rawParam) ? rawParam[0] : rawParam;

    if (!idStr || typeof idStr !== "string" || !ObjectId.isValid(idStr)) {
      throw new AppError(
        `Invalid identifier provided for parameter '${paramName}': "${idStr}". Expected a 24-character hex string.`,
        400,
        "INVALID_OBJECT_ID"
      );
    }
    next();
  };
};

/**
 * Safely parses a string into a MongoDB ObjectId.
 * Throws an AppError with status 400 if invalid.
 */
export const parseObjectId = (id: string, fieldName = "id"): ObjectId => {
  if (!id || typeof id !== "string" || !ObjectId.isValid(id)) {
    throw new AppError(
      `Invalid identifier provided for field '${fieldName}': "${id}". Expected a 24-character hex string.`,
      400,
      "INVALID_OBJECT_ID"
    );
  }
  return new ObjectId(id);
};

/**
 * Escapes special regular expression characters in user input to prevent ReDoS
 * (Regular Expression Denial of Service) and regex injection.
 */
export const escapeRegex = (text: string): string => {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
};
