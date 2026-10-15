import { ObjectId } from "mongodb";

export interface ReviewDocument {
  _id?: ObjectId;
  productId: ObjectId;
  userId: string;
  userName: string;
  rating: number; // 1–5 integer
  comment: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReviewResponse {
  id: string;
  productId: string;
  userId: string;
  userName: string;
  rating: number;
  comment: string;
  createdAt: string;
  updatedAt: string;
}
