import { Router } from "express";
import { verifyAuthToken } from "../../middlewares/auth.js";
import { requireRole } from "../../middlewares/role.js";
import {
  getBatches,
  createBatch,
  previewFEFOAllocation,
  createStockMovement,
  getStockMovements,
  getExpiryInspection,
} from "./inventory.controller.js";

const router = Router();

// All inventory operations require authentication and Owner or Manager role
router.use(verifyAuthToken);
router.use(requireRole(["owner", "manager"]));

// Batches
router.get("/batches", getBatches);
router.post("/batches", createBatch);

// FEFO allocation preview / simulation
router.post("/fefo-preview", previewFEFOAllocation);

// Stock movements & audit trail
router.get("/movements", getStockMovements);
router.post("/movements", createStockMovement);

// Expiry monitoring & inspection
router.get("/expiry-inspection", getExpiryInspection);
router.post("/expiry-inspection", getExpiryInspection);

export const inventoryRoutes = router;
