import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

function respondHealthy(_req: unknown, res: any) {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
}

// Deployment health check and external uptime-monitor endpoint. Keep this
// request unauthenticated and free of database work so it remains fast.
router.get("/healthz", respondHealthy);
router.get("/ping", respondHealthy);

export default router;
