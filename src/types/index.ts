import { Request } from "express";

export type UserRole = "owner" | "manager" | "worker" | "customer";

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  name?: string;
  plan?: string;
  [key: string]: unknown;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export type UnitOfMeasure = "kg" | "g" | "piece" | "packet" | "box" | "carton" | "litre" | "ml";

export interface ProductUnitConversion {
  baseUnit: UnitOfMeasure;
  sellUnit: UnitOfMeasure;
  multiplier: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: {
    code?: string;
    details?: unknown;
  };
}
