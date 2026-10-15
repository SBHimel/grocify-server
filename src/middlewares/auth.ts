import { Response, NextFunction } from "express";
import { jwtVerify, createRemoteJWKSet, JWTVerifyGetKey } from "jose-cjs";
import { config } from "../config/env.js";
import { AuthenticatedRequest, AuthUser } from "../types/index.js";
import { AppError } from "./error.js";
import { logger } from "../utils/logger.js";

let jwksCache: JWTVerifyGetKey | null = null;

const getJWKS = (): JWTVerifyGetKey => {
  if (!jwksCache) {
    const jwksUrl = new URL(`${config.clientUrl}/api/auth/jwks`);
    jwksCache = createRemoteJWKSet(jwksUrl);
    logger.info(`Initialized remote JWKS token verifier at: ${jwksUrl.toString()}`);
  }
  return jwksCache;
};

/**
 * Middleware to verify Better Auth issued JWTs using remote JWKS.
 * Attaches the verified user payload to req.user.
 */
export const verifyAuthToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AppError("Authentication required. Missing or malformed Bearer token.", 401, "UNAUTHORIZED");
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    throw new AppError("Authentication token is missing.", 401, "UNAUTHORIZED");
  }

  try {
    const JWKS = getJWKS();
    const { payload } = await jwtVerify(token, JWKS);

    const userId = (payload.sub || payload.id || "") as string;
    if (!userId) {
      throw new AppError("Malformed authentication token: missing user identifier.", 401, "INVALID_TOKEN");
    }

    // Strictly validate role against allowed system roles; safely map legacy roles
    const validRoles: AuthUser["role"][] = ["owner", "manager", "worker", "customer"];
    let rawRole = typeof payload.role === "string" ? payload.role.toLowerCase() : "";
    
    // Legacy migration compatibility
    if (rawRole === "seller") rawRole = "manager";
    if (rawRole === "admin") rawRole = "owner";
    if (rawRole === "buyer") rawRole = "customer";

    if (!rawRole || !validRoles.includes(rawRole as AuthUser["role"])) {
      throw new AppError(
        `Invalid or unmapped account role: "${payload.role}". Access denied. Please re-authenticate.`,
        403,
        "INVALID_ROLE"
      );
    }

    const validatedRole: AuthUser["role"] = rawRole as AuthUser["role"];

    // Populate verified user on request object
    req.user = {
      id: userId,
      email: (payload.email || "") as string,
      role: validatedRole,
      name: payload.name as string | undefined,
    };

    next();
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    const errCode = (error as { code?: string })?.code;
    const isJwksFetchError = errCode === "ERR_JWKS_FETCH_FAILED" || (error instanceof Error && error.message.includes("fetch"));

    if (isJwksFetchError) {
      logger.error("Failed to fetch public JWKS keys from auth client", {
        clientUrl: config.clientUrl,
        reason: error instanceof Error ? error.message : "JWKS endpoint unreachable",
      });
      throw new AppError("Authentication service is temporarily unavailable. Please verify client is running.", 503, "AUTH_SERVICE_UNAVAILABLE");
    }

    logger.warn("JWT verification failed", {
      reason: error instanceof Error ? error.message : "Invalid token",
      code: errCode,
    });
    throw new AppError("Invalid or expired authentication token.", 401, "INVALID_TOKEN");
  }
};
