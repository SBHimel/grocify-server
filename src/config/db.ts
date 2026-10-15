import { MongoClient, ServerApiVersion, Db } from "mongodb";
import { config } from "./env.js";
import { logger } from "../utils/logger.js";

let client: MongoClient | null = null;
let database: Db | null = null;

export const connectDb = async (): Promise<Db> => {
  if (database && client) {
    return database;
  }

  try {
    client = new MongoClient(config.mongodbUri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
      maxPoolSize: 20,
      minPoolSize: 5,
      serverSelectionTimeoutMS: 8000,
    });

    await client.connect();
    database = client.db(config.dbName);

    // Verify connection via ping
    await database.command({ ping: 1 });
    logger.info(`Successfully connected to MongoDB database: [${config.dbName}]`);

    return database;
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "Unknown database connection error";
    // Strip any embedded credentials from connection error strings
    const sanitizedMessage = rawMessage.replace(/(mongodb(?:\+srv)?:\/\/[^:]+:)([^@]+)(@)/gi, "$1***$3");
    logger.error("Failed to connect to MongoDB", {
      message: sanitizedMessage,
    });
    throw error;
  }
};

export const getDb = (): Db => {
  if (!database) {
    throw new Error("Database not initialized. Ensure connectDb() is called and resolved first.");
  }
  return database;
};

export const isDbConnected = (): boolean => {
  return database !== null && client !== null;
};

export const disconnectDb = async (): Promise<void> => {
  if (client) {
    try {
      await client.close();
      logger.info("MongoDB connection closed gracefully.");
    } catch (error) {
      logger.error("Error while closing MongoDB connection", {
        message: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      client = null;
      database = null;
    }
  }
};
