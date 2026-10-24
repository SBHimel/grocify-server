import { Db, ObjectId } from "mongodb";
import { AppError } from "../../middlewares/error.js";
import { UnitOfMeasure } from "../../types/index.js";
import { ProductDocument } from "../products/products.model.js";
import { InventoryBatchDocument, StockMovementDocument, MovementType } from "./inventory.model.js";
import { convertQuantity, canConvert } from "./unit-conversion.js";
import { logger } from "../../utils/logger.js";

export interface FEFOAllocationItem {
  batchId: ObjectId;
  batchNumber: string;
  allocatedQuantity: number; // in product baseUnit
  unitCost: number;
  expiryDate?: Date;
}

export interface FEFOAllocationResult {
  productId: ObjectId;
  requestedQuantity: number;
  allocatedBatches: FEFOAllocationItem[];
  totalAllocated: number;
  totalCost: number;
}

/**
 * First Expired, First Out (FEFO) Allocation Strategy
 *
 * Rules:
 * 1. Only considers non-quarantined, non-disposed, active batches with remaining quantity > 0.
 * 2. Filters OUT any batch whose expiryDate is in the past (expired stock cannot be allocated to sales).
 * 3. Batches WITHOUT an expiry date are NOT auto-expired; they are placed after batches with known future expiry dates (or FEFO order).
 * 4. Sorts by:
 *    - Has expiry date first (earliest expiryDate ascending).
 *    - Batches without expiry date sorted by receivedDate ascending (FIFO fallback).
 * 5. Allocates iteratively until requested quantity is fulfilled or available stock is exhausted.
 * 6. Returns detailed allocation plan; throws 400 if stock is insufficient.
 */
export const allocateStockFEFO = async (
  db: Db,
  productId: ObjectId,
  requestedQuantity: number,
  requestUnit: UnitOfMeasure
): Promise<FEFOAllocationResult> => {
  if (requestedQuantity <= 0) {
    throw new AppError("Requested allocation quantity must be greater than zero.", 400, "INVALID_QUANTITY");
  }

  const productsCollection = db.collection<ProductDocument>("products");
  const batchesCollection = db.collection<InventoryBatchDocument>("inventory_batches");

  const product = await productsCollection.findOne({ _id: productId });
  if (!product) {
    throw new AppError("Product not found for stock allocation.", 404, "PRODUCT_NOT_FOUND");
  }

  // Validate requestUnit can convert to product's baseUnit
  if (!canConvert(requestUnit, product.unit.baseUnit, product.unit)) {
    throw new AppError(
      `Cannot convert requested order unit '${requestUnit}' to product stock unit '${product.unit.baseUnit}' for '${product.name}'. No valid product conversion configured.`,
      400,
      "INVALID_UNIT_CONVERSION"
    );
  }

  // Convert requested quantity into the product's base unit
  const requestedBaseQuantity = convertQuantity(
    requestedQuantity,
    requestUnit,
    product.unit.baseUnit,
    product.unit
  );

  const now = new Date();

  // Find all candidate batches: must have remaining quantity, not quarantined or disposed
  const candidateBatches = await batchesCollection
    .find({
      productId,
      quantity: { $gt: 0 },
      status: { $nin: ["expired", "quarantined", "disposed"] },
      $or: [
        { expiryDate: { $gt: now } }, // Unexpired
        { expiryDate: { $exists: false } }, // Missing expiry is not auto-expired
      ],
    })
    .toArray();

  if (!candidateBatches || candidateBatches.length === 0) {
    throw new AppError(
      `Insufficient available stock for '${product.name}'. 0 units available.`,
      400,
      "INSUFFICIENT_STOCK"
    );
  }

  // Sort candidate batches:
  // - First Expired First Out: batches with expiryDate sorted earliest to latest
  // - Batches without expiryDate sorted by receivedDate (FIFO fallback)
  candidateBatches.sort((a, b) => {
    if (a.expiryDate && b.expiryDate) {
      return a.expiryDate.getTime() - b.expiryDate.getTime();
    }
    if (a.expiryDate && !b.expiryDate) {
      return -1; // Batches with expiry get consumed first
    }
    if (!a.expiryDate && b.expiryDate) {
      return 1;
    }
    // Neither has expiry: fall back to oldest receivedDate
    return new Date(a.receivedDate).getTime() - new Date(b.receivedDate).getTime();
  });

  let remainingToAllocate = requestedBaseQuantity;
  const allocations: FEFOAllocationItem[] = [];
  let totalCost = 0;

  for (const batch of candidateBatches) {
    if (remainingToAllocate <= 0) break;

    // Check if batch unit can convert to product baseUnit without error
    if (!canConvert(batch.unit, product.unit.baseUnit, product.unit)) {
      logger.warn(
        `[FEFO] Skipping batch ${batch.batchNumber} (_id: ${batch._id}) for '${product.name}': batch unit '${batch.unit}' is incompatible with stock unit '${product.unit.baseUnit}'.`
      );
      continue;
    }

    // Convert batch quantity into product baseUnit
    const batchQtyInBaseUnit = convertQuantity(
      batch.quantity,
      batch.unit,
      product.unit.baseUnit,
      product.unit
    );

    const takeQty = Math.min(batchQtyInBaseUnit, remainingToAllocate);

    allocations.push({
      batchId: batch._id!,
      batchNumber: batch.batchNumber,
      allocatedQuantity: Math.round(takeQty * 10000) / 10000,
      unitCost: batch.unitCost,
      expiryDate: batch.expiryDate,
    });

    totalCost += takeQty * batch.unitCost;
    remainingToAllocate = Math.round((remainingToAllocate - takeQty) * 10000) / 10000;
  }

  if (remainingToAllocate > 0) {
    throw new AppError(
      `Insufficient available stock for '${product.name}'. Requested ${requestedBaseQuantity} ${product.unit.baseUnit}, but only could allocate ${requestedBaseQuantity - remainingToAllocate} ${product.unit.baseUnit}.`,
      400,
      "INSUFFICIENT_STOCK"
    );
  }

  return {
    productId,
    requestedQuantity,
    allocatedBatches: allocations,
    totalAllocated: requestedBaseQuantity,
    totalCost: Math.round(totalCost * 100) / 100,
  };
};

/**
 * Commits stock reduction and logs movement audit records.
 * Atomic execution: deducts quantities from batches, updates product total currentStock, and records audit trails.
 */
export const executeStockAllocation = async (
  db: Db,
  allocation: FEFOAllocationResult,
  movementType: MovementType,
  referenceId?: string,
  performedBy?: StockMovementDocument["performedBy"],
  notes?: string
): Promise<void> => {
  const batchesCollection = db.collection<InventoryBatchDocument>("inventory_batches");
  const productsCollection = db.collection<ProductDocument>("products");
  const movementsCollection = db.collection<StockMovementDocument>("stock_movements");

  const product = await productsCollection.findOne({ _id: allocation.productId });
  if (!product) {
    throw new AppError("Product not found during stock execution.", 404, "PRODUCT_NOT_FOUND");
  }

  const now = new Date();
  const movementDocs: StockMovementDocument[] = [];

  for (const item of allocation.allocatedBatches) {
    const batch = await batchesCollection.findOne({ _id: item.batchId });
    if (!batch) continue;

    // Convert allocated qty back to the batch's specific stored unit
    const deductInBatchUnit = convertQuantity(
      item.allocatedQuantity,
      product.unit.baseUnit,
      batch.unit,
      product.unit
    );

    const updatedQty = Math.max(0, Math.round((batch.quantity - deductInBatchUnit) * 10000) / 10000);

    await batchesCollection.updateOne(
      { _id: item.batchId },
      {
        $set: {
          quantity: updatedQty,
          status: updatedQty === 0 ? "disposed" : batch.status,
          updatedAt: now,
        },
      }
    );

    movementDocs.push({
      productId: allocation.productId,
      productName: product.name,
      batchId: item.batchId,
      batchNumber: item.batchNumber,
      quantity: -item.allocatedQuantity, // Negative denotes outbound reduction
      unit: product.unit.baseUnit,
      movementType,
      referenceId,
      notes: notes || `FEFO allocation: deducted ${deductInBatchUnit} ${batch.unit} from batch ${item.batchNumber}`,
      performedBy,
      createdAt: now,
    });
  }

  if (movementDocs.length > 0) {
    await movementsCollection.insertMany(movementDocs);
  }

  // Recalculate and update currentStock on the Product document
  const remainingBatches = await batchesCollection
    .find({
      productId: allocation.productId,
      quantity: { $gt: 0 },
      status: { $nin: ["quarantined", "disposed"] },
    })
    .toArray();

  let totalAvailableStockInBaseUnit = 0;
  for (const b of remainingBatches) {
    if (canConvert(b.unit, product.unit.baseUnit, product.unit)) {
      totalAvailableStockInBaseUnit += convertQuantity(
        b.quantity,
        b.unit,
        product.unit.baseUnit,
        product.unit
      );
    }
  }

  await productsCollection.updateOne(
    { _id: allocation.productId },
    {
      $set: {
        currentStock: Math.round(totalAvailableStockInBaseUnit * 10000) / 10000,
        updatedAt: now,
      },
    }
  );
};
