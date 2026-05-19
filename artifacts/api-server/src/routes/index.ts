import { Router, type IRouter } from "express";
import healthRouter from "./health";
import riderRouter from "./rider";

const router: IRouter = Router();

router.use(healthRouter);
router.use(riderRouter);

export default router;
