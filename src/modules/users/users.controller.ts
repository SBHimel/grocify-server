import { Response } from "express";
import { getDb } from "../../config/db.js";
import { AuthenticatedRequest, UserRole } from "../../types/index.js";
import { AppError } from "../../middlewares/error.js";
import { parseObjectId } from "../../middlewares/validate.js";
import { sendSuccess } from "../../utils/response.js";
import { logger } from "../../utils/logger.js";

const VALID_ROLES: UserRole[] = ["owner", "manager", "worker", "customer"];

/**
 * List all users.
 * Accessible by: owner, manager
 */
export const getUsers = async (req: AuthenticatedRequest, res: Response): Promise<Response> => {
  const db = getDb();
  const usersCollection = db.collection("user");

  const users = await usersCollection
    .find({}, { projection: { password: 0 } })
    .sort({ createdAt: -1 })
    .toArray();

  const formattedUsers = users.map((u) => ({
    id: u._id.toString(),
    name: u.name,
    email: u.email,
    role: u.role || "customer",
    image: u.image,
    createdAt: u.createdAt,
  }));

  return sendSuccess(res, formattedUsers, "Users retrieved successfully.");
};

/**
 * Get user by ID.
 * Accessible by: owner, manager
 */
export const getUserById = async (req: AuthenticatedRequest, res: Response): Promise<Response> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const targetId = parseObjectId(rawId, "id");
  const db = getDb();
  const usersCollection = db.collection("user");

  const user = await usersCollection.findOne(
    { _id: targetId },
    { projection: { password: 0 } }
  );

  if (!user) {
    throw new AppError("User not found.", 404, "USER_NOT_FOUND");
  }

  return sendSuccess(res, {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role || "customer",
    image: user.image,
    createdAt: user.createdAt,
  }, "User details retrieved.");
};

/**
 * Update user role with Last-Owner protection.
 * Accessible by: owner only
 */
export const updateUserRole = async (req: AuthenticatedRequest, res: Response): Promise<Response> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const targetId = parseObjectId(rawId, "id");
  const { role: newRole } = req.body;

  if (!newRole || typeof newRole !== "string" || !VALID_ROLES.includes(newRole.toLowerCase() as UserRole)) {
    throw new AppError(
      `Invalid role specified. Must be one of: [${VALID_ROLES.join(", ")}].`,
      400,
      "INVALID_ROLE"
    );
  }

  const normalizedNewRole = newRole.toLowerCase() as UserRole;
  const db = getDb();
  const usersCollection = db.collection("user");

  const targetUser = await usersCollection.findOne({ _id: targetId });
  if (!targetUser) {
    throw new AppError("Target user not found.", 404, "USER_NOT_FOUND");
  }

  const currentRole = (targetUser.role || "customer") as UserRole;

  // No-op if role is unchanged
  if (currentRole === normalizedNewRole) {
    return sendSuccess(res, {
      id: targetUser._id.toString(),
      role: currentRole,
    }, "User role is already set to this value.");
  }

  // LAST OWNER PROTECTION
  // If demoting an existing owner to any non-owner role, verify that at least one other active owner remains.
  if (currentRole === "owner" && normalizedNewRole !== "owner") {
    const ownerCount = await usersCollection.countDocuments({ role: "owner" });
    if (ownerCount <= 1) {
      logger.warn("Blocked attempt to demote the sole remaining Owner", {
        actorId: req.user?.id,
        targetUserId: targetId.toString(),
      });
      throw new AppError(
        "Cannot demote the last remaining Owner account. At least one active Owner must exist at all times.",
        400,
        "LAST_OWNER_PROTECTION"
      );
    }
  }

  // Update role
  await usersCollection.updateOne(
    { _id: targetId },
    {
      $set: {
        role: normalizedNewRole,
        updatedAt: new Date(),
      },
    }
  );

  logger.info("User role updated successfully", {
    actorId: req.user?.id,
    targetUserId: targetId.toString(),
    previousRole: currentRole,
    newRole: normalizedNewRole,
  });

  return sendSuccess(res, {
    id: targetUser._id.toString(),
    email: targetUser.email,
    name: targetUser.name,
    previousRole: currentRole,
    role: normalizedNewRole,
  }, `User role successfully updated from ${currentRole} to ${normalizedNewRole}.`);
};

/**
 * Update authenticated user's own profile (name, image).
 * Accessible by: any authenticated role for their own profile.
 */
export const updateProfile = async (req: AuthenticatedRequest, res: Response): Promise<Response> => {
  const currentUserId = req.user?.id;
  if (!currentUserId) {
    throw new AppError("Authentication required.", 401, "UNAUTHORIZED");
  }

  const { name, image } = req.body;
  const updateFields: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length < 2) {
      throw new AppError("Name must be at least 2 characters.", 400, "VALIDATION_ERROR");
    }
    updateFields.name = name.trim();
  }

  if (image !== undefined) {
    if (typeof image === "string") {
      updateFields.image = image.trim();
    } else if (image === null) {
      updateFields.image = "";
    }
  }

  const db = getDb();
  const usersCollection = db.collection("user");
  const targetId = parseObjectId(currentUserId, "id");

  await usersCollection.updateOne(
    { _id: targetId },
    { $set: updateFields }
  );

  const updatedUser = await usersCollection.findOne(
    { _id: targetId },
    { projection: { password: 0 } }
  );

  if (!updatedUser) {
    throw new AppError("User not found.", 404, "USER_NOT_FOUND");
  }

  logger.info("User profile updated successfully", {
    userId: currentUserId,
    name: updatedUser.name,
    hasImage: !!updatedUser.image,
  });

  return sendSuccess(res, {
    id: updatedUser._id.toString(),
    name: updatedUser.name,
    email: updatedUser.email,
    role: updatedUser.role || "customer",
    image: updatedUser.image,
    createdAt: updatedUser.createdAt,
    updatedAt: updatedUser.updatedAt,
  }, "Profile updated successfully.");
};

