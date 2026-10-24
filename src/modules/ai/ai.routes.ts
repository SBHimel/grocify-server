import { Router } from "express";
import { handleChat } from "./ai.controller.js";

const router = Router();

// Public: Customer AI Chat Assistant endpoint
router.post("/chat", handleChat);
router.post("/ai/chat", handleChat); // Convenient alias

export const aiRoutes = router;
