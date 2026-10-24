import { ObjectId } from "mongodb";
import { UnitOfMeasure } from "../../types/index.js";

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "out_for_delivery"
  | "delivered"
  | "cancelled";

export type PaymentMethod = "cod";

export interface OrderItemDocument {
  productId: ObjectId;
  productName: string;
  unit: UnitOfMeasure;
  quantity: number;
  unitPrice: number; // server-verified price from DB
  subtotal: number;
}

export interface OrderDocument {
  _id?: ObjectId;
  orderNumber: string;
  customerId: string; // Better Auth user ID (string)
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  items: OrderItemDocument[];
  subtotal: number;
  deliveryFee: number;
  totalAmount: number;
  paymentMethod: PaymentMethod;
  status: OrderStatus;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderResponse {
  id: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  items: {
    productId: string;
    productName: string;
    unit: UnitOfMeasure;
    quantity: number;
    unitPrice: number;
    subtotal: number;
  }[];
  subtotal: number;
  deliveryFee: number;
  totalAmount: number;
  paymentMethod: PaymentMethod;
  status: OrderStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/** Convert a raw OrderDocument into the API response shape. */
export function toOrderResponse(doc: OrderDocument): OrderResponse {
  return {
    id: doc._id!.toHexString(),
    orderNumber: doc.orderNumber,
    customerId: doc.customerId,
    customerName: doc.customerName,
    customerPhone: doc.customerPhone,
    deliveryAddress: doc.deliveryAddress,
    items: doc.items.map((item) => ({
      productId: item.productId.toHexString(),
      productName: item.productName,
      unit: item.unit,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      subtotal: item.subtotal,
    })),
    subtotal: doc.subtotal,
    deliveryFee: doc.deliveryFee,
    totalAmount: doc.totalAmount,
    paymentMethod: doc.paymentMethod,
    status: doc.status,
    notes: doc.notes,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/** Generate a human-readable order number like ORD-20261025-AB3F */
export function generateOrderNumber(): string {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = Math.random().toString(36).toUpperCase().slice(2, 6);
  return `ORD-${datePart}-${random}`;
}
