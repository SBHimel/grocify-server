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

// All inventory operations require authentication
router.use(["/batches", "/fefo-preview", "/movements", "/expiry-inspection"], verifyAuthToken);

// Batches: Owner, Manager, and Worker can read; only Owner/Manager can create
router.get("/batches", requireRole(["owner", "manager", "worker"]), getBatches);
router.post("/batches", requireRole(["owner", "manager"]), createBatch);

// FEFO allocation preview / simulation (Owner/Manager only)
router.post("/fefo-preview", requireRole(["owner", "manager"]), previewFEFOAllocation);

// Stock movements & audit trail: Owner, Manager, and Worker can read; only Owner/Manager can record
router.get("/movements", requireRole(["owner", "manager", "worker"]), getStockMovements);
router.post("/movements", requireRole(["owner", "manager"]), createStockMovement);

// Expiry monitoring & inspection: Owner, Manager, and Worker can view report
router.get("/expiry-inspection", requireRole(["owner", "manager", "worker"]), getExpiryInspection);
router.post("/expiry-inspection", requireRole(["owner", "manager"]), getExpiryInspection);

export const inventoryRoutes = router;
