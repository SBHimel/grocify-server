import { Request, Response } from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getDb } from "../../config/db.js";
import { config } from "../../config/env.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { logger } from "../../utils/logger.js";
import { ProductDocument } from "../products/products.model.js";
import { stockInSellUnits } from "../products/products.controller.js";

interface ChatMessage {
  role: "user" | "model" | "assistant";
  content?: string;
  text?: string;
}

// In-memory sliding rate limiting: max 15 requests per minute per IP
interface RateLimitRecord {
  timestamps: number[];
}
const rateLimitMap = new Map<string, RateLimitRecord>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 15;

// Periodically clean up stale rate limit entries
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitMap.entries()) {
    record.timestamps = record.timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (record.timestamps.length === 0) {
      rateLimitMap.delete(ip);
    }
  }
}, 30 * 1000).unref();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  let record = rateLimitMap.get(ip);
  if (!record) {
    record = { timestamps: [] };
    rateLimitMap.set(ip, record);
  }
  record.timestamps = record.timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (record.timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }
  record.timestamps.push(now);
  return true;
}

// Candidate Gemini models with fast fallback order
const CANDIDATE_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.8-flash",
];

/**
 * Handle AI Shopping Assistant chat requests.
 * Uses real live products from MongoDB and the official Google Gemini API.
 */
export const handleChat = async (req: Request, res: Response): Promise<Response> => {
  // 1. IP rate limiting
  const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
  if (!checkRateLimit(clientIp)) {
    return sendError(
      res,
      "You have sent too many messages in a short time. Please wait a moment before sending another message.",
      429,
      "RATE_LIMIT_EXCEEDED"
    );
  }

  // 2. Input validation
  const { message, history } = req.body;
  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return sendError(res, "Please provide a valid, non-empty message.", 400, "INVALID_INPUT");
  }

  const cleanMessage = message.trim();
  if (cleanMessage.length > 600) {
    return sendError(res, "Message exceeds the maximum length of 600 characters.", 400, "MESSAGE_TOO_LONG");
  }

  // Sanitize history (last 10 messages max)
  const safeHistory: { role: "user" | "model"; parts: { text: string }[] }[] = [];
  if (Array.isArray(history)) {
    const trimmedHistory = history.slice(-10);
    for (const item of trimmedHistory) {
      if (item && typeof item === "object") {
        const role = item.role === "user" ? "user" : "model";
        const text = typeof item.content === "string" ? item.content : typeof item.text === "string" ? item.text : "";
        if (text && typeof text === "string" && text.trim().length > 0) {
          safeHistory.push({
            role,
            parts: [{ text: text.trim().slice(0, 500) }],
          });
        }
      }
    }
  }

  // 3. Verify Gemini API key configuration
  const apiKey = config.geminiApiKey;
  if (!apiKey) {
    logger.warn("Chatbot request received but GEMINI_API_KEY is not configured.");
    return sendError(
      res,
      "The AI shopping assistant is temporarily unavailable. Please check back shortly.",
      503,
      "AI_UNAVAILABLE"
    );
  }

  try {
    // 4. Retrieve live available products from MongoDB
    const db = getDb();
    const productsCollection = db.collection<ProductDocument>("products");
    const rawProducts = await productsCollection
      .find({ isActive: true })
      .project<ProductDocument>({
        name: 1,
        slug: 1,
        categoryName: 1,
        retailPrice: 1,
        unit: 1,
        currentStock: 1,
        isOrganic: 1,
        isSeasonal: 1,
        isFeatured: 1,
        description: 1,
      })
      .toArray();

    // Calculate real sellable stock and filter to products currently in stock
    const availableCatalog = rawProducts
      .map((p) => {
        const sellStock = stockInSellUnits(p);
        const sellUnit = p.unit?.sellUnit || p.unit?.baseUnit || "unit";
        return {
          name: p.name,
          slug: p.slug,
          category: p.categoryName || "General",
          priceBDT: `৳${p.retailPrice.toFixed(2)}`,
          stock: `${sellStock} ${sellUnit}`,
          sellStock,
          isOrganic: p.isOrganic ? "Yes" : "No",
          description: p.description ? p.description.slice(0, 80) : "",
        };
      })
      .filter((p) => p.sellStock > 0);

    const catalogContext = availableCatalog
      .map(
        (p) =>
          `• ${p.name} | Category: ${p.category} | Price: ${p.priceBDT} | Available Stock: ${p.stock} | Organic: ${p.isOrganic}${
            p.description ? ` | Note: ${p.description}` : ""
          }`
      )
      .join("\n");

    // 5. System instructions
    const systemInstruction = `You are "Grocify Assistant", the helpful, friendly AI shopping assistant for Grocify — Bangladesh's premier farm-fresh organic grocery store.

CORE RESPONSIBILITIES & BEHAVIOR:
1. Language Support:
   - Fluent in both Bangla (বাংলা) and English.
   - If the user writes in Bangla or Bengali-English (Banglish), respond warmly and naturally in Bangla.
   - If the user writes in English, respond in English.
   - Be polite, courteous, and enthusiastic about fresh, healthy food.

2. Product Recommendations (STRICT RULE):
   - You MUST ONLY recommend real, currently available products listed in the "CURRENT IN-STOCK GROCIFY CATALOG" below.
   - NEVER invent, hallucinate, or assume product names, prices, units, or discounts not present in the catalog.
   - Always state prices in Bangladeshi Taka with the ৳ symbol (e.g. ৳4.99, ৳120.00). Never use "$" or "USD".
   - If a customer asks for a product that is not in the catalog (or is out of stock), politely inform them that it is currently not in stock, and recommend the closest relevant available item from the catalog.

3. General Grocery & Culinary Advice:
   - You can answer questions on produce storage, freshness tips, recipe ideas, healthy meal planning, and ingredient pairings.
   - When suggesting recipes or meal ideas, highlight any matching ingredients currently available at Grocify with their ৳ price.

4. Customer Service Guidelines:
   - If asked about delivery: Grocify delivers farm-fresh organic groceries across Bangladesh in 30 minutes with Cash on Delivery (COD) supported.
   - Keep answers clear, engaging, and well-structured with bullet points where appropriate. Avoid overly long walls of text.

CURRENT IN-STOCK GROCIFY CATALOG (${availableCatalog.length} items available right now):
${catalogContext}`;

    // 6. Invoke Google Gemini API with fallback
    const genAI = new GoogleGenerativeAI(apiKey);
    let replyText = "";
    let lastError: Error | null = null;

    for (const modelName of CANDIDATE_MODELS) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction,
        });

        const chat = model.startChat({
          history: safeHistory,
        });

        const result = await chat.sendMessage(cleanMessage);
        const candidateResponse = result.response.text();
        if (candidateResponse && candidateResponse.trim().length > 0) {
          replyText = candidateResponse.trim();
          break;
        }
      } catch (err: any) {
        lastError = err;
        logger.warn(`Gemini model ${modelName} call failed, trying next candidate:`, {
          error: err?.message?.slice(0, 120),
        });
      }
    }

    if (!replyText) {
      logger.error("All Gemini candidate models failed to generate content", {
        message: lastError?.message,
      });
      return sendError(
        res,
        "I am currently experiencing high demand. Please try asking your question again in a moment!",
        503,
        "AI_OVERLOADED"
      );
    }

    // 7. Return successful assistant reply
    return sendSuccess(res, {
      reply: replyText,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error("Error processing AI chat request:", {
      message: error?.message,
    });
    return sendError(
      res,
      "An unexpected error occurred while processing your request. Please try again shortly.",
      500,
      "CHAT_PROCESSING_ERROR"
    );
  }
};
