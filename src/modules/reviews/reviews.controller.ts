import { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { getDb } from "../../config/db.js";
import { AuthenticatedRequest } from "../../types/index.js";
import { AppError } from "../../middlewares/error.js";
import { parseObjectId } from "../../middlewares/validate.js";
import { sendSuccess } from "../../utils/response.js";
import { ReviewDocument, ReviewResponse } from "./reviews.model.js";
import { ProductDocument } from "../products/products.model.js";

const mapReview = (r: ReviewDocument): ReviewResponse => ({
  id: r._id!.toString(),
  productId: r.productId.toString(),
  userId: r.userId,
  userName: r.userName,
  rating: r.rating,
  comment: r.comment,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

/**
 * Recalculate and persist the product's average rating and review count.
 * Called after every review create/delete.
 */
async function syncProductRating(productId: ObjectId): Promise<void> {
  const db = getDb();
  const reviewsCol = db.collection<ReviewDocument>("reviews");
  const productsCol = db.collection<ProductDocument>("products");

  const agg = await reviewsCol
    .aggregate<{ avg: number; count: number }>([
      { $match: { productId } },
      {
        $group: {
          _id: null,
          avg: { $avg: "$rating" },
          count: { $sum: 1 },
        },
      },
    ])
    .toArray();

  const avg = agg[0]?.avg ?? 0;
  const count = agg[0]?.count ?? 0;

  await productsCol.updateOne(
    { _id: productId },
    {
      $set: {
        rating: Math.round(avg * 10) / 10, // one decimal place
        reviewCount: count,
        updatedAt: new Date(),
      },
    }
  );
}

/**
 * GET /api/v1/products/:productId/reviews
 * Public — returns all reviews for a product, newest first.
 */
export const getReviews = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const rawProductId = Array.isArray(req.params.productId) ? req.params.productId[0] : req.params.productId;
  const productId = parseObjectId(rawProductId, "productId");
  const db = getDb();
  const reviews = await db
    .collection<ReviewDocument>("reviews")
    .find({ productId })
    .sort({ createdAt: -1 })
    .toArray();

  return sendSuccess(res, reviews.map(mapReview), "Reviews retrieved successfully.");
};

/**
 * POST /api/v1/products/:productId/reviews
 * Authenticated — any role may review. One review per user per product.
 */
export const createReview = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  const currentUser = req.user;
  if (!currentUser) throw new AppError("Authentication required.", 401, "UNAUTHORIZED");

  const rawProductId = Array.isArray(req.params.productId) ? req.params.productId[0] : req.params.productId;
  const productId = parseObjectId(rawProductId, "productId");
  const { rating, comment } = req.body;

  // Validate rating
  const ratingNum = Number(rating);
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    throw new AppError("Rating must be an integer between 1 and 5.", 400, "VALIDATION_ERROR");
  }

  // Validate comment
  if (!comment || typeof comment !== "string" || comment.trim().length < 5) {
    throw new AppError("Review comment must be at least 5 characters.", 400, "VALIDATION_ERROR");
  }
  if (comment.trim().length > 1000) {
    throw new AppError("Review comment must not exceed 1000 characters.", 400, "VALIDATION_ERROR");
  }

  const db = getDb();

  // Verify product exists
  const product = await db.collection<ProductDocument>("products").findOne({ _id: productId });
  if (!product) throw new AppError("Product not found.", 404, "PRODUCT_NOT_FOUND");

  const reviewsCol = db.collection<ReviewDocument>("reviews");

  // Prevent duplicate review by the same user for the same product
  const existing = await reviewsCol.findOne({ productId, userId: currentUser.id });
  if (existing) {
    throw new AppError(
      "You have already reviewed this product. Only one review per customer is allowed.",
      409,
      "DUPLICATE_REVIEW"
    );
  }

  const now = new Date();
  const newReview: ReviewDocument = {
    productId,
    userId: currentUser.id,
    userName: currentUser.name || currentUser.email || "Anonymous",
    rating: ratingNum,
    comment: comment.trim(),
    createdAt: now,
    updatedAt: now,
  };

  const result = await reviewsCol.insertOne(newReview);
  newReview._id = result.insertedId;

  // Recalculate product rating
  await syncProductRating(productId);

  return sendSuccess(res, mapReview(newReview), "Review submitted successfully.", 201);
};

/**
 * DELETE /api/v1/products/:productId/reviews/:reviewId
 * Review Author or Owner/Manager (moderation): remove review and sync product rating.
 */
export const deleteReview = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  const currentUser = req.user;
  if (!currentUser) {
    throw new AppError("Authentication required.", 401, "UNAUTHORIZED");
  }

  const rawProductId = Array.isArray(req.params.productId) ? req.params.productId[0] : req.params.productId;
  const rawReviewId = Array.isArray(req.params.reviewId) ? req.params.reviewId[0] : req.params.reviewId;
  const productId = parseObjectId(rawProductId, "productId");
  const reviewId = parseObjectId(rawReviewId, "reviewId");

  const db = getDb();
  const reviewsCol = db.collection<ReviewDocument>("reviews");

  const existingReview = await reviewsCol.findOne({ _id: reviewId, productId });
  if (!existingReview) {
    throw new AppError("Review not found.", 404, "REVIEW_NOT_FOUND");
  }

  const isModerator = currentUser.role === "owner" || currentUser.role === "manager";
  const isAuthor = existingReview.userId === currentUser.id;

  if (!isModerator && !isAuthor) {
    throw new AppError("You do not have permission to delete this review.", 403, "FORBIDDEN");
  }

  await reviewsCol.deleteOne({ _id: reviewId, productId });
  await syncProductRating(productId);

  return sendSuccess(res, { id: reviewId.toString() }, "Review deleted successfully.");
};
