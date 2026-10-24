import { Router } from "express";
import { getReviews, createReview, deleteReview } from "./reviews.controller.js";
import { verifyAuthToken } from "../../middlewares/auth.js";
import { requireRole } from "../../middlewares/role.js";
import { validateObjectIdParam } from "../../middlewares/validate.js";

const router = Router({ mergeParams: true });

// Public: list reviews for a product
router.get(
  "/products/:productId/reviews",
  validateObjectIdParam("productId"),
  getReviews
);

// Authenticated: submit a review (any role)
router.post(
  "/products/:productId/reviews",
  verifyAuthToken,
  validateObjectIdParam("productId"),
  createReview
);

// Authenticated: delete a review (author or owner/manager moderation)
router.delete(
  "/products/:productId/reviews/:reviewId",
  verifyAuthToken,
  validateObjectIdParam("productId"),
  validateObjectIdParam("reviewId"),
  deleteReview
);

export const reviewRoutes = router;
