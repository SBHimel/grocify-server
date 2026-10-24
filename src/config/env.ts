import dns from "node:dns";
import dotenv from "dotenv";

// Configure DNS fallback to prevent MongoDB SRV resolution issues on Windows/certain ISPs
try {
  dns.setServers(["1.1.1.1", "1.0.0.1"]);
} catch {
  // Ignore if custom DNS servers cannot be set in current environment
}

dotenv.config();

export interface ServerConfig {
  port: number;
  nodeEnv: "development" | "production" | "test";
  clientUrl: string;
  mongodbUri: string;
  dbName: string;
  geminiApiKey: string;
}

const getEnvOrThrow = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`[Config Error] Missing required environment variable: ${key}`);
  }
  return value;
};

export const config: ServerConfig = {
  port: parseInt(process.env.PORT || "5000", 10),
  nodeEnv: (process.env.NODE_ENV as ServerConfig["nodeEnv"]) || "development",
  clientUrl: process.env.CLIENT_URL || "http://localhost:3000",
  mongodbUri: getEnvOrThrow("MONGODB_URI"),
  dbName: (process.env.DB_NAME || process.env.AUTH_DB_NAME || "Grocify").trim(),
  geminiApiKey: (process.env.GEMINI_API_KEY || "").trim(),
};

