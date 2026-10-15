import { Db } from "mongodb";
import { logger } from "../../utils/logger.js";
import { InventoryBatchDocument } from "./inventory.model.js";

export interface ExpiryInspectionReport {
  quarantinedCount: number;
  expiringSoonCount: number;
  missingExpiryCount: number;
}

/**
 * Scans all inventory batches to enforce automated grocery expiry rules:
 * 1. Expired Stock: If `expiryDate < now`, status is updated to `expired` / `quarantined`.
 * 2. Expiring Soon: If `expiryDate` is within `daysThreshold` (default 7 days), status updated to `expiring_soon`.
 * 3. Missing Expiry: Flagged as warning, but strictly NOT automatically expired.
 */
export const runExpiryInspection = async (
  db: Db,
  daysThreshold = 7
): Promise<ExpiryInspectionReport> => {
  const batchesCollection = db.collection<InventoryBatchDocument>("inventory_batches");
  const now = new Date();
  const thresholdDate = new Date(now.getTime() + daysThreshold * 24 * 60 * 60 * 1000);

  // 1. Auto-quarantine expired batches
  const expiredResult = await batchesCollection.updateMany(
    {
      quantity: { $gt: 0 },
      expiryDate: { $lte: now },
      status: { $nin: ["expired", "quarantined", "disposed"] },
    },
    {
      $set: {
        status: "quarantined",
        updatedAt: now,
      },
    }
  );

  // 2. Mark expiring soon batches
  const expiringSoonResult = await batchesCollection.updateMany(
    {
      quantity: { $gt: 0 },
      expiryDate: { $gt: now, $lte: thresholdDate },
      status: "available",
    },
    {
      $set: {
        status: "expiring_soon",
        updatedAt: now,
      },
    }
  );

  // 3. Count missing expiry items for operational inspection warning
  const missingExpiryCount = await batchesCollection.countDocuments({
    quantity: { $gt: 0 },
    status: { $nin: ["disposed", "quarantined"] },
    expiryDate: { $exists: false },
  });

  const report: ExpiryInspectionReport = {
    quarantinedCount: expiredResult.modifiedCount,
    expiringSoonCount: expiringSoonResult.modifiedCount,
    missingExpiryCount,
  };

  if (report.quarantinedCount > 0) {
    logger.warn(`Auto-quarantined ${report.quarantinedCount} expired grocery batches.`);
  }

  return report;
};
