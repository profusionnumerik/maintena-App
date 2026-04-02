import express from "express";
import type { Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import * as fs from "fs";
import * as path from "path";

const app = express();
const log = console.log;

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

function setupCors(app: express.Application) {
  app.use((req, res, next) => {
    const origins = new Set<string>();

    const configuredOrigins = [
      process.env.EXPO_PUBLIC_APP_URL,
      process.env.EXPO_PUBLIC_API_BASE_URL,
      process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL,
      process.env.EXPO_PUBLIC_ACCOUNT_DELETION_URL,
      process.env.APP_WEB_BASE_URL,
    ].filter(Boolean) as string[];

    configuredOrigins.forEach((origin) => {
      try {
        origins.add(new URL(origin).origin);
      } catch {
        origins.add(origin.replace(/\/$/, ""));
      }
    });

    const requestOrigin = req.header("origin");
    const normalizedOrigin = requestOrigin?.replace(/\/$/, "");
    const isLocalhost =
      normalizedOrigin?.startsWith("http://localhost:") ||
      normalizedOrigin?.startsWith("http://127.0.0.1:");

    if (normalizedOrigin && (origins.has(normalizedOrigin) || isLocalhost)) {
      res.header("Access-Control-Allow-Origin", normalizedOrigin);
      res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.header("Access-Control-Allow-Credentials", "true");
    }

    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }

    next();
  });
}

function setupSecurityHeaders(app: express.Application) {
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "geolocation=(self), camera=(self)");
    next();
  });
}

function setupBodyParsing(app: express.Application) {
  app.use(
    express.json({
      limit: "10mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );

  app.use(
    express.urlencoded({
      extended: false,
      limit: "10mb",
    })
  );
}

function setupRequestLogging(app: express.Application) {
  app.use((req, res, next) => {
    const start = Date.now();
    const routePath = req.path;

    res.on("finish", () => {
      if (!routePath.startsWith("/api")) return;
      log(`${req.method} ${routePath} ${res.statusCode} in ${Date.now() - start}ms`);
    });

    next();
  });
}

function getAppName(): string {
  try {
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "Maintena";
  } catch {
    return "Maintena";
  }
}

function configureStatic(app: express.Application) {
  const appName = getAppName();
  const publicPath = path.resolve(process.cwd(), "public");
  const assetsPath = path.resolve(process.cwd(), "assets");
  const staticBuildPath = path.resolve(process.cwd(), "static-build");

  app.get("/", (_req, res) => {
    return res.status(200).send(`${appName} API OK`);
  });

  app.get("/healthz", (_req, res) => {
    return res.status(200).json({ ok: true, app: appName });
  });

  if (fs.existsSync(publicPath)) {
    app.use(express.static(publicPath, { extensions: ["html"] }));
  }

  if (fs.existsSync(assetsPath)) {
    app.use("/assets", express.static(assetsPath));
  }

  if (fs.existsSync(staticBuildPath)) {
    app.use(express.static(staticBuildPath));
  }
}

function setupErrorHandler(app: express.Application) {
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    const error = err as { status?: number; statusCode?: number; message?: string };
    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });
}

(async () => {
  try {
    setupCors(app);
    setupSecurityHeaders(app);
    setupBodyParsing(app);
    setupRequestLogging(app);
    configureStatic(app);

    const server = await registerRoutes(app);

    setupErrorHandler(app);

    const port = parseInt(process.env.PORT || "8080", 10);

    server.listen(
      {
        port,
        host: "0.0.0.0",
        reusePort: true,
      },
      () => {
        log(`express server serving on port ${port}`);
      }
    );
  } catch (error) {
    console.error("Server bootstrap error:", error);
    process.exit(1);
  }
})();
