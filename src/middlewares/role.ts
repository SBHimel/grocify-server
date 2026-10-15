import { Response, NextFunction } from "express";
import { AuthenticatedRequest, UserRole } from "../types/index.js";
import { AppError } from "./error.js";

/**
 * Role-based authorization middleware.
 * Enforces that req.user has one of the allowed roles.
 * Never trusts client-supplied roles.
 */
export const requireRole = (allowedRoles: UserRole[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const user = req.user;

    if (!user) {
      throw new AppError("Authentication required.", 401, "UNAUTHORIZED");
    }

    if (!allowedRoles.includes(user.role)) {
      throw new AppError(
        `Access denied. Required role: [${allowedRoles.join(", ")}], but your account has role: [${user.role}].`,
        403,
        "FORBIDDEN"
      );
    }

    next();
  };
};
