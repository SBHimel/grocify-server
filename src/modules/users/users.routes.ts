import { Router } from "express";
import { getUsers, getUserById, updateUserRole, updateProfile } from "./users.controller.js";
import { verifyAuthToken } from "../../middlewares/auth.js";
import { requireRole } from "../../middlewares/role.js";
import { validateObjectIdParam } from "../../middlewares/validate.js";

const router = Router();

// Protected: Authenticated user can update their own profile (name, image)
router.patch("/users/profile", verifyAuthToken, updateProfile);

// Protected: Owner and Manager can view user directory
router.get("/users", verifyAuthToken, requireRole(["owner", "manager"]), getUsers);
router.get("/users/:id", verifyAuthToken, requireRole(["owner", "manager"]), validateObjectIdParam("id"), getUserById);

// Protected: Strictly Owner only can change user roles
router.patch("/users/:id/role", verifyAuthToken, requireRole(["owner"]), validateObjectIdParam("id"), updateUserRole);

export const userRoutes = router;
