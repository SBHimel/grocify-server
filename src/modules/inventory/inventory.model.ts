import { ObjectId } from "mongodb";
import { UnitOfMeasure } from "../../types/index.js";

export type BatchStatus = "available" | "expiring_soon" | "expired" | "quarantined" | "disposed";

export interface InventoryBatchDocument {
  _id?: ObjectId;
  productId: ObjectId;
  productName: string;
  batchNumber: string;
  purchaseId?: string; // Optional PO reference if recorded during purchase
  quantity: number; // Current remaining stock quantity in this batch
  initialQuantity: number; // Original quantity received in this batch
  unit: UnitOfMeasure; // e.g. "kg", "piece", "packet", "carton"
  unitCost: number; // Weighted-average cost per unit
  expiryDate?: Date; // Optional: null or undefined for non-perishables (does not auto-expire)
  receivedDate: Date;
  status: BatchStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface InventoryBatchResponse {
  id: string;
  productId: string;
  productName: string;
  batchNumber: string;
  purchaseId?: string;
  quantity: number;
  initialQuantity: number;
  unit: UnitOfMeasure;
  unitCost: number;
  expiryDate?: string;
  receivedDate: string;
  status: BatchStatus;
  createdAt: string;
  updatedAt: string;
}

export type MovementType =
  | "purchase_received"
  | "sale_allocation"
  | "sale_fefo_out"
  | "adjustment_in"
  | "adjustment_out"
  | "quarantine"
  | "disposal"
  | "supplier_return";

export interface StockMovementDocument {
  _id?: ObjectId;
  productId: ObjectId;
  productName: string;
  batchId?: ObjectId;
  batchNumber?: string;
  quantity: number; // Positive for additions, negative for reductions
  unit: UnitOfMeasure;
  movementType: MovementType;
  referenceId?: string; // Order ID, adjustment reason, disposal note, etc.
  notes?: string;
  performedBy?: {
    userId: string;
    email: string;
    name?: string;
    role: string;
  };
  createdAt: Date;
}

export interface StockMovementResponse {
  id: string;
  productId: string;
  productName: string;
  batchId?: string;
  batchNumber?: string;
  quantity: number;
  unit: UnitOfMeasure;
  movementType: MovementType;
  referenceId?: string;
  notes?: string;
  performedBy?: {
    userId: string;
    email: string;
    name?: string;
    role: string;
  };
  createdAt: string;
}
