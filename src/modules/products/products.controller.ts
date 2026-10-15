import { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { getDb } from "../../config/db.js";
import { AuthenticatedRequest } from "../../types/index.js";
import { AppError } from "../../middlewares/error.js";
import { parseObjectId, escapeRegex } from "../../middlewares/validate.js";
import { sendSuccess } from "../../utils/response.js";
import { ProductDocument, ProductResponse } from "./products.model.js";
import { CategoryDocument } from "../categories/categories.model.js";

const slugify = (text: string): string => {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

const mapToResponse = (p: ProductDocument): ProductResponse => ({
  id: p._id!.toString(),
  name: p.name,
  slug: p.slug,
  categoryId: p.categoryId.toString(),
  categoryName: p.categoryName || "",
  barcode: p.barcode,
  sku: p.sku,
  description: p.description,
  retailPrice: p.retailPrice,
  originalPrice: p.originalPrice,
  unit: p.unit,
  images: p.images || [],
  isActive: p.isActive,
  minStockAlert: p.minStockAlert,
  currentStock: p.currentStock,
  isOrganic: p.isOrganic,
  isFeatured: p.isFeatured,
  isSeasonal: p.isSeasonal,
  rating: p.rating,
  reviewCount: p.reviewCount,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

/**
 * List products with search, category filtering, and sorting (Public).
 */
export const getProducts = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const db = getDb();
  const productsCollection = db.collection<ProductDocument>("products");
  const categoriesCollection = db.collection<CategoryDocument>("categories");

  const {
    search,
    category,
    isFeatured,
    isOrganic,
    isSeasonal,
    sort,
    page = "1",
    limit = "50",
    includeInactive,
  } = req.query;

  const filter: Record<string, unknown> = {};

  // Status filter: only active by default
  if (includeInactive !== "true") {
    filter.isActive = true;
  }

  // Category filter: support either ObjectId or category slug
  if (category && typeof category === "string" && category.trim()) {
    const trimmedCat = category.trim();
    if (ObjectId.isValid(trimmedCat)) {
      filter.categoryId = new ObjectId(trimmedCat);
    } else {
      // Lookup category by slug
      const foundCategory = await categoriesCollection.findOne({ slug: trimmedCat });
      if (foundCategory) {
        filter.categoryId = foundCategory._id;
      } else {
        // Unknown category slug, return empty
        return sendSuccess(res, [], "No products found for specified category.");
      }
    }
  }

  // Boolean attribute filters
  if (isFeatured === "true") filter.isFeatured = true;
  if (isOrganic === "true") filter.isOrganic = true;
  if (isSeasonal === "true") filter.isSeasonal = true;

  // Search filter across name, description, categoryName, or barcode
  if (search && typeof search === "string" && search.trim() && search !== "undefined") {
    const safeRegex = new RegExp(escapeRegex(search.trim()), "i");
    filter.$or = [
      { name: safeRegex },
      { description: safeRegex },
      { categoryName: safeRegex },
      { barcode: safeRegex },
      { sku: safeRegex },
    ];
  }

  // Sorting
  let sortOption: Record<string, 1 | -1> = { createdAt: -1 };
  if (sort === "price_asc") sortOption = { retailPrice: 1 };
  else if (sort === "price_desc") sortOption = { retailPrice: -1 };
  else if (sort === "rating") sortOption = { rating: -1 };
  else if (sort === "name_asc") sortOption = { name: 1 };

  const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 50));
  const skip = (pageNum - 1) * limitNum;

  const [products, totalCount] = await Promise.all([
    productsCollection.find(filter).sort(sortOption).skip(skip).limit(limitNum).toArray(),
    productsCollection.countDocuments(filter),
  ]);

  const mapped = products.map(mapToResponse);

  return sendSuccess(
    res,
    mapped,
    "Products retrieved successfully.",
    200
  );
};

/**
 * Get product by ID or slug (Public).
 */
export const getProductById = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const identifier = rawId;
  const db = getDb();
  const productsCollection = db.collection<ProductDocument>("products");

  let query: Record<string, unknown>;
  if (ObjectId.isValid(identifier)) {
    query = { _id: new ObjectId(identifier) };
  } else {
    query = { slug: identifier };
  }

  const product = await productsCollection.findOne(query);

  if (!product) {
    throw new AppError("Product not found.", 404, "PRODUCT_NOT_FOUND");
  }

  return sendSuccess(res, mapToResponse(product), "Product details retrieved successfully.");
};

/**
 * Create a new grocery product (Owner/Manager only).
 */
export const createProduct = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  const {
    name,
    slug: customSlug,
    categoryId,
    barcode,
    sku,
    description,
    retailPrice,
    originalPrice,
    unit,
    images,
    minStockAlert,
    currentStock,
    isOrganic,
    isFeatured,
    isSeasonal,
  } = req.body;

  // 1. Validate mandatory fields
  if (!name || typeof name !== "string" || name.trim().length < 2) {
    throw new AppError("Product name is required (min 2 characters).", 400, "VALIDATION_ERROR");
  }

  if (retailPrice === undefined || typeof retailPrice !== "number" || retailPrice < 0) {
    throw new AppError("A non-negative retail price is required.", 400, "VALIDATION_ERROR");
  }

  if (!categoryId || !ObjectId.isValid(String(categoryId))) {
    throw new AppError("A valid categoryId (24-hex string) is required.", 400, "VALIDATION_ERROR");
  }

  if (!unit || typeof unit !== "object" || !unit.baseUnit || !unit.sellUnit || !unit.multiplier) {
    throw new AppError(
      "Product unit conversion ({ baseUnit, sellUnit, multiplier }) is required.",
      400,
      "VALIDATION_ERROR"
    );
  }

  // 2. Verify Category exists
  const db = getDb();
  const catObjId = new ObjectId(String(categoryId));
  const category = await db.collection<CategoryDocument>("categories").findOne({ _id: catObjId });

  if (!category) {
    throw new AppError("Specified category does not exist.", 400, "CATEGORY_NOT_FOUND");
  }

  const productsCollection = db.collection<ProductDocument>("products");

  // 3. Unique slug check
  const slug = customSlug ? slugify(customSlug) : slugify(name);
  const existingProductWithSlug = await productsCollection.findOne({ slug });
  if (existingProductWithSlug) {
    throw new AppError(
      `A product with slug '${slug}' already exists. Please choose a unique name or slug.`,
      409,
      "SLUG_CONFLICT"
    );
  }

  const now = new Date();
  const newProduct: ProductDocument = {
    name: name.trim(),
    slug,
    categoryId: catObjId,
    categoryName: category.name,
    barcode: barcode ? String(barcode).trim() : undefined,
    sku: sku ? String(sku).trim() : undefined,
    description: description ? String(description).trim() : "",
    retailPrice: Number(retailPrice),
    originalPrice: originalPrice ? Number(originalPrice) : undefined,
    unit: {
      baseUnit: unit.baseUnit,
      sellUnit: unit.sellUnit,
      multiplier: Number(unit.multiplier) || 1,
    },
    images: Array.isArray(images) && images.length > 0 ? images : ["/assets/grocify_logo.png"],
    isActive: true,
    minStockAlert: minStockAlert !== undefined ? Number(minStockAlert) : 5,
    currentStock: currentStock !== undefined ? Number(currentStock) : 0,
    isOrganic: Boolean(isOrganic),
    isFeatured: Boolean(isFeatured),
    isSeasonal: Boolean(isSeasonal),
    rating: 5.0,
    reviewCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  const insertResult = await productsCollection.insertOne(newProduct);
  newProduct._id = insertResult.insertedId;

  return sendSuccess(res, mapToResponse(newProduct), "Product created successfully.", 201);
};

/**
 * Update an existing grocery product (Owner/Manager only).
 */
export const updateProduct = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const targetId = parseObjectId(rawId, "id");
  const db = getDb();
  const productsCollection = db.collection<ProductDocument>("products");

  const existing = await productsCollection.findOne({ _id: targetId });
  if (!existing) {
    throw new AppError("Product not found.", 404, "PRODUCT_NOT_FOUND");
  }

  const {
    name,
    categoryId,
    barcode,
    sku,
    description,
    retailPrice,
    originalPrice,
    unit,
    images,
    isActive,
    minStockAlert,
    currentStock,
    isOrganic,
    isFeatured,
    isSeasonal,
  } = req.body;

  const updateFields: Partial<ProductDocument> = {
    updatedAt: new Date(),
  };

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length < 2) {
      throw new AppError("Product name must be at least 2 characters.", 400, "VALIDATION_ERROR");
    }
    updateFields.name = name.trim();
  }

  if (retailPrice !== undefined) {
    if (typeof retailPrice !== "number" || retailPrice < 0) {
      throw new AppError("Retail price must be a non-negative number.", 400, "VALIDATION_ERROR");
    }
    updateFields.retailPrice = retailPrice;
  }

  if (originalPrice !== undefined) {
    updateFields.originalPrice = Number(originalPrice);
  }

  if (categoryId !== undefined) {
    const catObjId = parseObjectId(categoryId, "categoryId");
    const category = await db.collection<CategoryDocument>("categories").findOne({ _id: catObjId });
    if (!category) {
      throw new AppError("Category does not exist.", 400, "CATEGORY_NOT_FOUND");
    }
    updateFields.categoryId = catObjId;
    updateFields.categoryName = category.name;
  }

  if (unit !== undefined) {
    if (!unit.baseUnit || !unit.sellUnit || !unit.multiplier) {
      throw new AppError("Unit must include baseUnit, sellUnit, and multiplier.", 400, "VALIDATION_ERROR");
    }
    updateFields.unit = {
      baseUnit: unit.baseUnit,
      sellUnit: unit.sellUnit,
      multiplier: Number(unit.multiplier) || 1,
    };
  }

  if (images !== undefined && Array.isArray(images)) {
    updateFields.images = images;
  }

  if (description !== undefined) updateFields.description = String(description).trim();
  if (barcode !== undefined) updateFields.barcode = String(barcode).trim();
  if (sku !== undefined) updateFields.sku = String(sku).trim();
  if (typeof isActive === "boolean") updateFields.isActive = isActive;
  if (typeof isOrganic === "boolean") updateFields.isOrganic = isOrganic;
  if (typeof isFeatured === "boolean") updateFields.isFeatured = isFeatured;
  if (typeof isSeasonal === "boolean") updateFields.isSeasonal = isSeasonal;
  if (minStockAlert !== undefined) updateFields.minStockAlert = Number(minStockAlert);
  if (currentStock !== undefined) updateFields.currentStock = Number(currentStock);

  await productsCollection.updateOne({ _id: targetId }, { $set: updateFields });

  const updated = await productsCollection.findOne({ _id: targetId });

  return sendSuccess(res, mapToResponse(updated!), "Product updated successfully.");
};

/**
 * Delete a product (Owner/Manager only).
 * Performs safe soft-delete to preserve order and inventory history.
 */
export const deleteProduct = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const targetId = parseObjectId(rawId, "id");
  const db = getDb();
  const productsCollection = db.collection<ProductDocument>("products");

  const result = await productsCollection.updateOne(
    { _id: targetId },
    { $set: { isActive: false, updatedAt: new Date() } }
  );

  if (result.matchedCount === 0) {
    throw new AppError("Product not found.", 404, "PRODUCT_NOT_FOUND");
  }

  return sendSuccess(res, { id: targetId.toString() }, "Product deactivated successfully.");
};
