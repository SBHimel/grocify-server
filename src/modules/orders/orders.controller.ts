import { Request, Response, NextFunction } from "express";
import { ObjectId } from "mongodb";
import { getDb } from "../../config/db.js";
import { AppError } from "../../middlewares/error.js";
import { sendSuccess } from "../../utils/response.js";
import { AuthenticatedRequest } from "../../types/index.js";
import { ProductDocument } from "../products/products.model.js";
import { allocateStockFEFO, executeStockAllocation } from "../inventory/fefo.service.js";
import { canConvert } from "../inventory/unit-conversion.js";
import {
  OrderDocument,
  OrderStatus,
  toOrderResponse,
  generateOrderNumber,
} from "./orders.model.js";

const FREE_DELIVERY_THRESHOLD = 35.0;
const STANDARD_DELIVERY_FEE = 3.99;

/** POST /api/v1/orders — authenticated customers only */
export const createOrder = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const db = getDb();
    const user = req.user!;

    if (user.role !== "customer") {
      return next(new AppError("Only customers can place orders.", 403, "FORBIDDEN"));
    }

    const {
      customerName,
      customerPhone,
      deliveryAddress,
      items: rawItems,
      notes,
    } = req.body as {
      customerName?: unknown;
      customerPhone?: unknown;
      deliveryAddress?: unknown;
      items?: unknown;
      notes?: unknown;
    };

    // --- Input validation ---
    if (!customerName || typeof customerName !== "string" || customerName.trim().length < 2) {
      return next(new AppError("customerName must be at least 2 characters.", 400, "VALIDATION_ERROR"));
    }
    if (!customerPhone || typeof customerPhone !== "string" || !/^\+?[\d\s\-()]{7,20}$/.test(customerPhone.trim())) {
      return next(new AppError("A valid customerPhone is required.", 400, "VALIDATION_ERROR"));
    }
    if (!deliveryAddress || typeof deliveryAddress !== "string" || deliveryAddress.trim().length < 10) {
      return next(new AppError("deliveryAddress must be at least 10 characters.", 400, "VALIDATION_ERROR"));
    }
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return next(new AppError("At least one order item is required.", 400, "VALIDATION_ERROR"));
    }
    if (rawItems.length > 50) {
      return next(new AppError("Maximum 50 items per order.", 400, "VALIDATION_ERROR"));
    }

    // Validate each item structure
    for (const item of rawItems) {
      if (
        typeof item !== "object" ||
        item === null ||
        typeof item.productId !== "string" ||
        !ObjectId.isValid(item.productId) ||
        typeof item.quantity !== "number" ||
        item.quantity <= 0 ||
        !Number.isInteger(item.quantity)
      ) {
        return next(
          new AppError(
            "Each item must have a valid productId (ObjectId) and a positive integer quantity.",
            400,
            "VALIDATION_ERROR"
          )
        );
      }
    }

    const productsCollection = db.collection<ProductDocument>("products");

    // Deduplicate items (in case client sends same product twice)
    const itemMap = new Map<string, number>();
    for (const item of rawItems as Array<{ productId: string; quantity: number }>) {
      const existing = itemMap.get(item.productId) ?? 0;
      itemMap.set(item.productId, existing + item.quantity);
    }

    interface VerifiedItem {
      productId: ObjectId;
      productName: string;
      unit: OrderDocument["items"][number]["unit"];
      quantity: number;
      unitPrice: number;
      subtotal: number;
    }
    const verifiedItems: VerifiedItem[] = [];
    let serverSubtotal = 0;

    for (const [productIdStr, quantity] of itemMap.entries()) {
      const productObjectId = new ObjectId(productIdStr);
      const product = await productsCollection.findOne({
        _id: productObjectId,
        isActive: true,
      });

      if (!product) {
        return next(
          new AppError(
            `Product with ID ${productIdStr} is not available or does not exist.`,
            400,
            "PRODUCT_UNAVAILABLE"
          )
        );
      }

      // Validate that product's selling unit can convert to its stock unit
      if (!canConvert(product.unit.sellUnit, product.unit.baseUnit, product.unit)) {
        return next(
          new AppError(
            `Cannot place order for '${product.name}': Selling unit '${product.unit.sellUnit}' has no valid conversion to stock unit '${product.unit.baseUnit}'.`,
            400,
            "INVALID_PRODUCT_UNIT"
          )
        );
      }

      // Use server-side price — never trust client price
      const unitPrice = product.retailPrice;
      const subtotal = Math.round(unitPrice * quantity * 100) / 100;

      verifiedItems.push({
        productId: productObjectId,
        productName: product.name,
        unit: product.unit.sellUnit,
        quantity,
        unitPrice,
        subtotal,
      });

      serverSubtotal += subtotal;
    }

    serverSubtotal = Math.round(serverSubtotal * 100) / 100;
    const deliveryFee =
      serverSubtotal >= FREE_DELIVERY_THRESHOLD ? 0 : STANDARD_DELIVERY_FEE;
    const totalAmount = Math.round((serverSubtotal + deliveryFee) * 100) / 100;

    // --- FEFO stock allocation (dry-run first to detect insufficient stock before committing) ---
    const allocations: Array<{
      allocation: Awaited<ReturnType<typeof allocateStockFEFO>>;
      item: VerifiedItem;
    }> = [];
    for (const item of verifiedItems) {
      const allocation = await allocateStockFEFO(db, item.productId, item.quantity, item.unit);
      allocations.push({ allocation, item });
    }

    // --- Create the order document ---
    const now = new Date();
    const orderDoc: OrderDocument = {
      orderNumber: generateOrderNumber(),
      customerId: user.id,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      deliveryAddress: deliveryAddress.trim(),
      items: verifiedItems.map((vi) => ({
        productId: vi.productId,
        productName: vi.productName,
        unit: vi.unit,
        quantity: vi.quantity,
        unitPrice: vi.unitPrice,
        subtotal: vi.subtotal,
      })),
      subtotal: serverSubtotal,
      deliveryFee,
      totalAmount,
      paymentMethod: "cod",
      status: "pending",
      notes: typeof notes === "string" && notes.trim() ? notes.trim() : undefined,
      createdAt: now,
      updatedAt: now,
    };

    const ordersCollection = db.collection<OrderDocument>("orders");
    const insertResult = await ordersCollection.insertOne(orderDoc);
    const orderId = insertResult.insertedId.toHexString();

    // --- Execute FEFO stock deductions now that order is persisted ---
    for (const { allocation, item } of allocations) {
      await executeStockAllocation(
        db,
        allocation,
        "sale_fefo_out",
        orderId,
        { userId: user.id, email: user.email, name: user.name, role: user.role },
        `COD order ${orderDoc.orderNumber}: ${item.quantity} × ${item.productName}`
      );
    }

    const created = await ordersCollection.findOne({ _id: insertResult.insertedId });
    sendSuccess(res, toOrderResponse(created!), "Order placed successfully.", 201);
  } catch (err) {
    next(err);
  }
};

/** GET /api/v1/orders — authenticated customer sees own orders; owner/manager sees all */
export const listOrders = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const db = getDb();
    const user = req.user!;

    const ordersCollection = db.collection<OrderDocument>("orders");

    const filter =
      user.role === "owner" || user.role === "manager"
        ? {}
        : { customerId: user.id };

    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10)));
    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      ordersCollection.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
      ordersCollection.countDocuments(filter),
    ]);

    sendSuccess(
      res,
      {
        orders: orders.map(toOrderResponse),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
      "Orders fetched successfully."
    );
  } catch (err) {
    next(err);
  }
};

/** GET /api/v1/orders/:id */
export const getOrderById = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const db = getDb();
    const user = req.user!;
    const id = String(req.params.id);

    if (!ObjectId.isValid(id)) {
      return next(new AppError("Invalid order ID.", 400, "INVALID_ID"));
    }

    const ordersCollection = db.collection<OrderDocument>("orders");
    const order = await ordersCollection.findOne({ _id: new ObjectId(id) });

    if (!order) {
      return next(new AppError("Order not found.", 404, "NOT_FOUND"));
    }

    // Customers can only view their own orders
    if (user.role === "customer" && order.customerId !== user.id) {
      return next(new AppError("You do not have permission to view this order.", 403, "FORBIDDEN"));
    }

    sendSuccess(res, toOrderResponse(order), "Order fetched successfully.");
  } catch (err) {
    next(err);
  }
};

/** PATCH /api/v1/orders/:id/status — owner/manager updates order status */
export const updateOrderStatus = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const db = getDb();
    const user = req.user!;
    const id = String(req.params.id);

    if (user.role !== "owner" && user.role !== "manager") {
      return next(new AppError("Only owners and managers can update order status.", 403, "FORBIDDEN"));
    }

    if (!ObjectId.isValid(id)) {
      return next(new AppError("Invalid order ID.", 400, "INVALID_ID"));
    }

    const validStatuses: OrderStatus[] = [
      "pending",
      "confirmed",
      "preparing",
      "out_for_delivery",
      "delivered",
      "cancelled",
    ];

    const { status } = req.body as { status?: unknown };
    if (!status || !validStatuses.includes(status as OrderStatus)) {
      return next(
        new AppError(
          `status must be one of: ${validStatuses.join(", ")}.`,
          400,
          "VALIDATION_ERROR"
        )
      );
    }

    const ordersCollection = db.collection<OrderDocument>("orders");
    const result = await ordersCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { status: status as OrderStatus, updatedAt: new Date() } },
      { returnDocument: "after" }
    );

    if (!result) {
      return next(new AppError("Order not found.", 404, "NOT_FOUND"));
    }

    sendSuccess(res, toOrderResponse(result), "Order status updated.");
  } catch (err) {
    next(err);
  }
};
