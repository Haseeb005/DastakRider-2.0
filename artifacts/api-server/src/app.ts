import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import MemoryStore from "memorystore";
import router from "./routes";
import { logger } from "./lib/logger";

const Store = MemoryStore(session);

const app: Express = express();

// Rider API responses are live operational data and must always include their
// JSON body. Express ETags can turn authenticated polling responses into 304
// responses, which have no body and leave native/web clients with missing data.
app.disable("etag");
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.use(
  session({
    secret: process.env["SESSION_SECRET"] || "dastak-rider-fallback-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: "lax" },
    store: new Store({ checkPeriod: 86_400_000 }),
  })
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
