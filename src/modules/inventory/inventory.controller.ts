import { Response } from "express";
import { ObjectId } from "mongodb";
import { getDb } from "../../config/db.js";
import { AuthenticatedRequest, UnitOfMeasure } from "../../types/index.js";
import { AppError } from "../../middlewares/error.js";
import { parseObjectId } from "../../middlewares/validate.js";
import { sendSuccess } from "../../utils/response.js";
import { ProductDocument } from "../products/products.model.js";
import {
  InventoryBatchDocument,
  InventoryBatchResponse,
  StockMovementDocument,
  StockMovementResponse,
  MovementType,
} from "./inventory.model.js";
import { convertQuantity } from "./unit-conversion.js";
import { allocateStockFEFO, executeStockAllocation } from "./fefo.service.js";
import { runExpiryInspection } from "./expiry.service.js";

const mapBatchToResponse = (b: InventoryBatchDocument): InventoryBatchResponse => ({
  id: b._id!.toString(),
  productId: b.productId.toString(),
  productName: b.productName,
  batchNumber: b.batchNumber,
  purchaseId: b.purchaseId,
  quantity: b.quantity,
  initialQuantity: b.initialQuantity,
  unit: b.unit,
  unitCost: b.unitCost,
  expiryDate: b.expiryDate ? b.expiryDate.toISOString() : undefined,
  receivedDate: b.receivedDate.toISOString(),
  status: b.status,
  createdAt: b.createdAt.toISOString(),
  updatedAt: b.updatedAt.toISOString(),
});

const mapMovementToResponse = (m: StockMovementDocument): StockMovementResponse => ({
  id: m._id!.toString(),
  productId: m.productId.toString(),
  productName: m.productName,
  batchId: m.batchId?.toString(),
  batchNumber: m.batchNumber,
  quantity: m.quantity,
  unit: m.unit,
  movementType: m.movementType,
  referenceId: m.referenceId,
  notes: m.notes,
  performedBy: m.performedBy,
  createdAt: m.createdAt.toISOString(),
});

/**
 * List all inventory batches with optional filters (Protected: Owner/Manager).
 */
export const getBatches = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  const db = getDb();
  const batchesCollection = db.collection<InventoryBatchDocument>("inventory_batches");
  const { productId, status } = req.query;

  const filter: Record<string, unknown> = {};
  if (productId && typeof productId === "string") {
    filter.productId = parseObjectId(productId, "Product ID");
  }
  if (status && typeof status === "string") {
    filter.status = status;
  }

  const batches = await batchesCollection
    .find(filter)
    .sort({ receivedDate: -1 })
    .toArray();

  return sendSuccess(res, batches.map(mapBatchToResponse), "Inventory batches retrieved.");
};

/**
 * Create a new inventory batch and record initial stock movement (Protected: Owner/Manager).
 */
export const createBatch = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  const db = getDb();
  const batchesCollection = db.collection<InventoryBatchDocument>("inventory_batches");
  const productsCollection = db.collection<ProductDocument>("products");
  const movementsCollection = db.collection<StockMovementDocument>("stock_movements");

  const {
    productId,
    batchNumber,
    quantity,
    unit,
    unitCost,
    expiryDate,
    receivedDate,
    purchaseId,
  } = req.body;

  if (!productId || !batchNumber || quantity === undefined || !unit || unitCost === undefined) {
    throw new AppError("Missing required batch fields (productId, batchNumber, quantity, unit, unitCost).", 400);
  }

  const pId = parseObjectId(productId, "Product ID");
  const product = await productsCollection.findOne({ _id: pId });
  if (!product) {
    throw new AppError("Product does not exist.", 404, "PRODUCT_NOT_FOUND");
  }

  const numQuantity = Number(quantity);
  const numCost = Number(unitCost);

  if (isNaN(numQuantity) || numQuantity <= 0) {
    throw new AppError("Quantity must be a positive number.", 400, "INVALID_QUANTITY");
  }
  if (isNaN(numCost) || numCost < 0) {
    throw new AppError("Unit cost must be non-negative.", 400, "INVALID_COST");
  }

  // Validate unit compatibility with product
  const validUnits: UnitOfMeasure[] = ["kg", "g", "piece", "packet", "box", "carton", "litre", "ml"];
  if (!validUnits.includes(unit)) {
    throw new AppError(`Invalid unit: '${unit}'. Supported units: ${validUnits.join(", ")}`, 400);
  }

  const now = new Date();
  const parsedReceivedDate = receivedDate ? new Date(receivedDate) : now;
  const parsedExpiryDate = expiryDate ? new Date(expiryDate) : undefined;

  // Determine initial status
  let initialStatus: InventoryBatchDocument["status"] = "available";
  if (parsedExpiryDate) {
    if (parsedExpiryDate <= now) {
      initialStatus = "expired";
    } else if (parsedExpiryDate.getTime() <= now.getTime() + 7 * 24 * 60 * 60 * 1000) {
      initialStatus = "expiring_soon";
    }
  }

  const batchDoc: InventoryBatchDocument = {
    productId: pId,
    productName: product.name,
    batchNumber: String(batchNumber).trim(),
    purchaseId: purchaseId ? String(purchaseId).trim() : undefined,
    quantity: numQuantity,
    initialQuantity: numQuantity,
    unit,
    unitCost: numCost,
    expiryDate: parsedExpiryDate,
    receivedDate: parsedReceivedDate,
    status: initialStatus,
    createdAt: now,
    updatedAt: now,
  };

  const insertResult = await batchesCollection.insertOne(batchDoc);
  const createdBatchId = insertResult.insertedId;

  // Record Stock Movement audit record
  const movementDoc: StockMovementDocument = {
    productId: pId,
    productName: product.name,
    batchId: createdBatchId,
    batchNumber: batchDoc.batchNumber,
    quantity: numQuantity,
    unit,
    movementType: "purchase_received",
    referenceId: purchaseId,
    notes: `Initial stock received into batch ${batchDoc.batchNumber}`,
    performedBy: req.user ? {
      userId: req.user.id,
      email: req.user.email,
      name: req.user.name,
      role: req.user.role,
    } : undefined,
    createdAt: now,
  };
  await movementsCollection.insertOne(movementDoc);

  // Update total currentStock on product
  const qtyInBaseUnit = convertQuantity(numQuantity, unit, product.unit.baseUnit, product.unit);
  const newProductStock = Math.round((product.currentStock + qtyInBaseUnit) * 10000) / 10000;

  await productsCollection.updateOne(
    { _id: pId },
    { $set: { currentStock: newProductStock, updatedAt: now } }
  );

  return sendSuccess(
    res,
    mapBatchToResponse({ ...batchDoc, _id: createdBatchId }),
    "Inventory batch created successfully.",
    201
  );
};

/**
 * Preview or simulate FEFO allocation without deducting stock (Protected: Owner/Manager).
 */
export const previewFEFOAllocation = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  const db = getDb();
  const { productId, quantity, unit } = req.body;

  if (!productId || quantity === undefined) {
    throw new AppError("productId and quantity are required.", 400);
  }

  const pId = parseObjectId(productId, "Product ID");
  const numQuantity = Number(quantity);
  const reqUnit = (unit as UnitOfMeasure) || "piece";

  const allocation = await allocateStockFEFO(db, pId, numQuantity, reqUnit);
  return sendSuccess(res, allocation, "FEFO allocation plan simulated successfully.");
};

/**
 * Perform manual stock movement/adjustment (Protected: Owner/Manager).
 */
export const createStockMovement = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  const db = getDb();
  const { productId, batchId, quantity, unit, movementType, notes, referenceId } = req.body;

  if (!productId || quantity === undefined || !unit || !movementType) {
    throw new AppError("productId, quantity, unit, and movementType are required.", 400);
  }

  const validMovementTypes: MovementType[] = [
    "purchase_received",
    "sale_allocation",
    "sale_fefo_out",
    "adjustment_in",
    "adjustment_out",
    "quarantine",
    "disposal",
    "supplier_return",
  ];

  if (!validMovementTypes.includes(movementType)) {
    throw new AppError(`Invalid movementType: '${movementType}'.`, 400);
  }

  const pId = parseObjectId(productId, "Product ID");
  const productsCollection = db.collection<ProductDocument>("products");
  const product = await productsCollection.findOne({ _id: pId });
  if (!product) {
    throw new AppError("Product not found.", 404, "PRODUCT_NOT_FOUND");
  }

  const batchesCollection = db.collection<InventoryBatchDocument>("inventory_batches");
  const movementsCollection = db.collection<StockMovementDocument>("stock_movements");
  const numQuantity = Number(quantity);
  const now = new Date();

  let bId: ObjectId | undefined;
  let batchNumber: string | undefined;

  if (batchId) {
    bId = parseObjectId(batchId, "Batch ID");
    const batch = await batchesCollection.findOne({ _id: bId });
    if (!batch) {
      throw new AppError("Inventory batch not found.", 404, "BATCH_NOT_FOUND");
    }
    batchNumber = batch.batchNumber;

    // If movement is reducing batch stock
    if (["adjustment_out", "quarantine", "disposal", "supplier_return"].includes(movementType)) {
      const deductQty = convertQuantity(Math.abs(numQuantity), unit, batch.unit, product.unit);
      if (batch.quantity < deductQty) {
        throw new AppError(
          `Cannot deduct ${deductQty} ${batch.unit} from batch '${batch.batchNumber}'. Remaining quantity is ${batch.quantity} ${batch.unit}.`,
          400,
          "INSUFFICIENT_BATCH_STOCK"
        );
      }
      const updatedBatchQty = Math.max(0, Math.round((batch.quantity - deductQty) * 10000) / 10000);
      const newStatus = movementType === "quarantine" ? "quarantined" : (updatedBatchQty === 0 ? "disposed" : batch.status);

      await batchesCollection.updateOne(
        { _id: bId },
        { $set: { quantity: updatedBatchQty, status: newStatus, updatedAt: now } }
      );
    } else if (movementType === "adjustment_in") {
      const addQty = convertQuantity(numQuantity, unit, batch.unit, product.unit);
      await batchesCollection.updateOne(
        { _id: bId },
        { $inc: { quantity: addQty }, $set: { updatedAt: now } }
      );
    }
  }

  // Record immutable movement document
  const movementDoc: StockMovementDocument = {
    productId: pId,
    productName: product.name,
    batchId: bId,
    batchNumber,
    quantity: numQuantity,
    unit,
    movementType,
    referenceId,
    notes,
    performedBy: req.user ? {
      userId: req.user.id,
      email: req.user.email,
      name: req.user.name,
      role: req.user.role,
    } : undefined,
    createdAt: now,
  };

  const moveRes = await movementsCollection.insertOne(movementDoc);

  // Recalculate total product currentStock
  const allBatches = await batchesCollection
    .find({ productId: pId, quantity: { $gt: 0 }, status: { $nin: ["quarantined", "disposed"] } })
    .toArray();

  let totalBaseStock = 0;
  for (const b of allBatches) {
    totalBaseStock += convertQuantity(b.quantity, b.unit, product.unit.baseUnit, product.unit);
  }

  await productsCollection.updateOne(
    { _id: pId },
    { $set: { currentStock: Math.round(totalBaseStock * 10000) / 10000, updatedAt: now } }
  );

  return sendSuccess(
    res,
    mapMovementToResponse({ ...movementDoc, _id: moveRes.insertedId }),
    "Stock movement recorded successfully.",
    201
  );
};

/**
 * List audit stock movements (Protected: Owner/Manager).
 */
export const getStockMovements = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  const db = getDb();
  const movementsCollection = db.collection<StockMovementDocument>("stock_movements");
  const { productId, movementType, limit = "50" } = req.query;

  const filter: Record<string, unknown> = {};
  if (productId && typeof productId === "string") {
    filter.productId = parseObjectId(productId, "Product ID");
  }
  if (movementType && typeof movementType === "string") {
    filter.movementType = movementType;
  }

  const limitNum = Math.min(200, Math.max(1, parseInt(String(limit), 10) || 50));
  const movements = await movementsCollection
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(limitNum)
    .toArray();

  return sendSuccess(res, movements.map(mapMovementToResponse), "Stock movements retrieved.");
};

/**
 * Trigger manual or scheduled expiry scan and inspection report (Protected: Owner/Manager).
 */
export const getExpiryInspection = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  const db = getDb();
  const report = await runExpiryInspection(db);
  return sendSuccess(res, report, "Expiry inspection report completed.");
};
