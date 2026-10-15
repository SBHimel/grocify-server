import { Router } from "express";
import { getHealthStatus } from "./health.controller.js";

const router = Router();

router.get("/health", getHealthStatus);

export const healthRoutes = router;
