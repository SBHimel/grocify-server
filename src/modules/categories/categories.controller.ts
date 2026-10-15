import { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { getDb } from "../../config/db.js";
import { AuthenticatedRequest } from "../../types/index.js";
import { AppError } from "../../middlewares/error.js";
import { parseObjectId, escapeRegex } from "../../middlewares/validate.js";
import { sendSuccess } from "../../utils/response.js";
import { CategoryDocument, CategoryResponse } from "./categories.model.js";

const slugify = (text: string): string => {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

/**
 * Get all categories (Public).
 * Computes live active item counts per category.
 */
export const getCategories = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const db = getDb();
  const categoriesCollection = db.collection<CategoryDocument>("categories");
  const productsCollection = db.collection("products");

  const query: Record<string, unknown> = { isActive: true };

  // If includeInactive is requested by authenticated staff
  if (req.query.includeInactive === "true") {
    delete query.isActive;
  }

  const categories = await categoriesCollection
    .find(query)
    .sort({ name: 1 })
    .toArray();

  // Aggregate active product counts per category
  const counts = await productsCollection
    .aggregate([
      { $match: { isActive: true } },
      { $group: { _id: "$categoryId", count: { $sum: 1 } } },
    ])
    .toArray();

  const countMap = new Map<string, number>();
  for (const c of counts) {
    if (c._id) {
      countMap.set(c._id.toString(), c.count);
    }
  }

  const responseData: CategoryResponse[] = categories.map((cat) => {
    const idStr = cat._id!.toString();
    return {
      id: idStr,
      name: cat.name,
      slug: cat.slug,
      description: cat.description || "",
      icon: cat.icon || "",
      image: cat.image || "",
      color: cat.color || "",
      itemCount: countMap.get(idStr) || 0,
      isActive: cat.isActive,
      createdAt: cat.createdAt.toISOString(),
      updatedAt: cat.updatedAt.toISOString(),
    };
  });

  return sendSuccess(res, responseData, "Categories retrieved successfully.");
};

/**
 * Get single category by ID or slug (Public).
 */
export const getCategoryById = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const identifier = rawId;
  const db = getDb();
  const categoriesCollection = db.collection<CategoryDocument>("categories");

  let query: Record<string, unknown>;
  if (ObjectId.isValid(identifier)) {
    query = { _id: new ObjectId(identifier) };
  } else {
    query = { slug: identifier };
  }

  const category = await categoriesCollection.findOne(query);

  if (!category) {
    throw new AppError("Category not found.", 404, "CATEGORY_NOT_FOUND");
  }

  const productsCollection = db.collection("products");
  const itemCount = await productsCollection.countDocuments({
    categoryId: category._id,
    isActive: true,
  });

  const responseData: CategoryResponse = {
    id: category._id!.toString(),
    name: category.name,
    slug: category.slug,
    description: category.description || "",
    icon: category.icon || "",
    image: category.image || "",
    color: category.color || "",
    itemCount,
    isActive: category.isActive,
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString(),
  };

  return sendSuccess(res, responseData, "Category details retrieved successfully.");
};

/**
 * Create a new grocery category (Owner/Manager only).
 */
export const createCategory = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  const { name, slug: customSlug, description, icon, image, color } = req.body;

  if (!name || typeof name !== "string" || name.trim().length < 2) {
    throw new AppError(
      "Category name is required and must be at least 2 characters.",
      400,
      "VALIDATION_ERROR"
    );
  }

  const slug = customSlug ? slugify(customSlug) : slugify(name);
  const db = getDb();
  const categoriesCollection = db.collection<CategoryDocument>("categories");

  const existingSlug = await categoriesCollection.findOne({ slug });
  if (existingSlug) {
    throw new AppError(
      `A category with slug '${slug}' already exists. Please choose a different name or slug.`,
      409,
      "SLUG_CONFLICT"
    );
  }

  const now = new Date();
  const newCategory: CategoryDocument = {
    name: name.trim(),
    slug,
    description: description ? String(description).trim() : "",
    icon: icon ? String(icon).trim() : "",
    image: image ? String(image).trim() : "",
    color: color ? String(color).trim() : "",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  const insertResult = await categoriesCollection.insertOne(newCategory);

  const responseData: CategoryResponse = {
    id: insertResult.insertedId.toString(),
    ...newCategory,
    itemCount: 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  return sendSuccess(res, responseData, "Category created successfully.", 201);
};

/**
 * Update a grocery category (Owner/Manager only).
 */
export const updateCategory = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const targetId = parseObjectId(rawId, "id");
  const { name, description, icon, image, color, isActive } = req.body;

  const db = getDb();
  const categoriesCollection = db.collection<CategoryDocument>("categories");

  const existing = await categoriesCollection.findOne({ _id: targetId });
  if (!existing) {
    throw new AppError("Category not found.", 404, "CATEGORY_NOT_FOUND");
  }

  const updateFields: Partial<CategoryDocument> = {
    updatedAt: new Date(),
  };

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length < 2) {
      throw new AppError("Category name must be at least 2 characters.", 400, "VALIDATION_ERROR");
    }
    updateFields.name = name.trim();
  }

  if (description !== undefined) updateFields.description = String(description).trim();
  if (icon !== undefined) updateFields.icon = String(icon).trim();
  if (image !== undefined) updateFields.image = String(image).trim();
  if (color !== undefined) updateFields.color = String(color).trim();
  if (typeof isActive === "boolean") updateFields.isActive = isActive;

  await categoriesCollection.updateOne({ _id: targetId }, { $set: updateFields });

  const updated = await categoriesCollection.findOne({ _id: targetId });

  return sendSuccess(
    res,
    {
      id: updated!._id!.toString(),
      name: updated!.name,
      slug: updated!.slug,
      description: updated!.description || "",
      icon: updated!.icon || "",
      image: updated!.image || "",
      color: updated!.color || "",
      isActive: updated!.isActive,
      createdAt: updated!.createdAt.toISOString(),
      updatedAt: updated!.updatedAt.toISOString(),
    },
    "Category updated successfully."
  );
};

/**
 * Delete a category (Owner/Manager only).
 * Performs safe check for linked active products.
 */
export const deleteCategory = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const targetId = parseObjectId(rawId, "id");
  const db = getDb();
  const categoriesCollection = db.collection<CategoryDocument>("categories");
  const productsCollection = db.collection("products");

  const activeProductCount = await productsCollection.countDocuments({
    categoryId: targetId,
    isActive: true,
  });

  if (activeProductCount > 0) {
    // Soft-delete to preserve relational integrity
    await categoriesCollection.updateOne(
      { _id: targetId },
      { $set: { isActive: false, updatedAt: new Date() } }
    );
    return sendSuccess(
      res,
      { id: targetId.toString(), softDeleted: true, linkedActiveProducts: activeProductCount },
      "Category has linked active products and was deactivated (soft-deleted)."
    );
  }

  const result = await categoriesCollection.deleteOne({ _id: targetId });
  if (result.deletedCount === 0) {
    throw new AppError("Category not found.", 404, "CATEGORY_NOT_FOUND");
  }

  return sendSuccess(res, { id: targetId.toString() }, "Category permanently deleted.");
};
