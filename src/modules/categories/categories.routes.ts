import { Router } from "express";
import {
  getCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
} from "./categories.controller.js";
import { verifyAuthToken } from "../../middlewares/auth.js";
import { requireRole } from "../../middlewares/role.js";
import { validateObjectIdParam } from "../../middlewares/validate.js";

const router = Router();

// Public: Browse categories
router.get("/categories", getCategories);
router.get("/categories/:id", getCategoryById);

// Protected: Store operations (Owner & Manager only)
router.post(
  "/categories",
  verifyAuthToken,
  requireRole(["owner", "manager"]),
  createCategory
);

router.patch(
  "/categories/:id",
  verifyAuthToken,
  requireRole(["owner", "manager"]),
  validateObjectIdParam("id"),
  updateCategory
);

router.delete(
  "/categories/:id",
  verifyAuthToken,
  requireRole(["owner", "manager"]),
  validateObjectIdParam("id"),
  deleteCategory
);

export const categoryRoutes = router;
