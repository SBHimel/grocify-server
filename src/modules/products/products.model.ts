import { ObjectId } from "mongodb";
import { ProductUnitConversion } from "../../types/index.js";

export interface ProductDocument {
  _id?: ObjectId;
  name: string;
  slug: string;
  categoryId: ObjectId;
  categoryName?: string;
  barcode?: string;
  sku?: string;
  description: string;
  retailPrice: number;
  originalPrice?: number;
  unit: ProductUnitConversion;
  images: string[];
  isActive: boolean;
  minStockAlert: number;
  currentStock: number;
  isOrganic?: boolean;
  isFeatured?: boolean;
  isSeasonal?: boolean;
  rating?: number;
  reviewCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductResponse {
  id: string;
  name: string;
  slug: string;
  categoryId: string;
  categoryName?: string;
  barcode?: string;
  sku?: string;
  description: string;
  retailPrice: number;
  originalPrice?: number;
  unit: ProductUnitConversion;
  images: string[];
  isActive: boolean;
  minStockAlert: number;
  currentStock: number;
  isOrganic?: boolean;
  isFeatured?: boolean;
  isSeasonal?: boolean;
  rating?: number;
  reviewCount?: number;
  createdAt: string;
  updatedAt: string;
}
