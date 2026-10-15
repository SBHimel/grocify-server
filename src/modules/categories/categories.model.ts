import { ObjectId } from "mongodb";

export interface CategoryDocument {
  _id?: ObjectId;
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  image?: string;
  color?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CategoryResponse {
  id: string;
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  image?: string;
  color?: string;
  itemCount?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
