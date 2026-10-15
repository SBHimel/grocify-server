import { Router } from "express";
import {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
} from "./products.controller.js";
import { verifyAuthToken } from "../../middlewares/auth.js";
import { requireRole } from "../../middlewares/role.js";
import { validateObjectIdParam } from "../../middlewares/validate.js";

const router = Router();

// Public: Browse products
router.get("/products", getProducts);
router.get("/products/:id", getProductById);
router.get("/product/:id", getProductById); // Legacy compatibility

// Protected: Store operations (Owner & Manager only)
router.post(
  "/products",
  verifyAuthToken,
  requireRole(["owner", "manager"]),
  createProduct
);

router.patch(
  "/products/:id",
  verifyAuthToken,
  requireRole(["owner", "manager"]),
  validateObjectIdParam("id"),
  updateProduct
);

router.delete(
  "/products/:id",
  verifyAuthToken,
  requireRole(["owner", "manager"]),
  validateObjectIdParam("id"),
  deleteProduct
);

export const productRoutes = router;
