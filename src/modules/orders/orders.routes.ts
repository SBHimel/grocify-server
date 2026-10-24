import { Router } from "express";
import { verifyAuthToken } from "../../middlewares/auth.js";
import { requireRole } from "../../middlewares/role.js";
import {
  createOrder,
  listOrders,
  getOrderById,
  updateOrderStatus,
} from "./orders.controller.js";

const router = Router();

/** POST /orders — customer places a COD order */
router.post("/orders", verifyAuthToken, requireRole(["customer"]), createOrder);

/** GET /orders — customer sees own orders; owner/manager sees all */
router.get("/orders", verifyAuthToken, listOrders);

/** GET /orders/:id */
router.get("/orders/:id", verifyAuthToken, getOrderById);

/** PATCH /orders/:id/status — owner/manager updates fulfillment status */
router.patch(
  "/orders/:id/status",
  verifyAuthToken,
  requireRole(["owner", "manager"]),
  updateOrderStatus
);

export { router as orderRoutes };
