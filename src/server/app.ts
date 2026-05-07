import express from "express";
import crypto from "crypto";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import helmet from "helmet";
import nunjucks from "nunjucks";
import fs from "fs";
import path from "path";
import { Pool } from "pg";
import PgBoss from "pg-boss";
import { Config } from "../config";
import { authRouter, requireAuth } from "./auth";
import { createIngestRouter } from "../ingest/router";
import { dashboardRouter } from "./routes/dashboard";
import { servicesRouter } from "./routes/services";
import { adminRouter } from "./routes/admin";

export function createApp(
  pool: Pool,
  boss: PgBoss,
  config: Config,
): express.Application {
  const app = express();
  const PgSession = connectPgSimple(session);

  app.set("trust proxy", 1);

  const viewsDir = path.join(__dirname, "views");
  const componentsDir = path.join(__dirname, "views/components");
  const govukDir = path.join(
    __dirname,
    "../../node_modules/govuk-frontend/dist",
  );

  const env = nunjucks.configure([viewsDir, componentsDir, govukDir], {
    autoescape: true,
    express: app,
    noCache: config.nodeEnv === "development",
  });

  env.addFilter("date", (val: unknown) => {
    if (!val) return "—";
    const d = val instanceof Date ? val : new Date(String(val));
    const display = d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    const full = d.toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    return new nunjucks.runtime.SafeString(
      `<time datetime="${d.toISOString()}" title="${full}">${display}</time>`,
    );
  });

  app.use((_req, res, next) => {
    res.locals.cspNonce = crypto.randomBytes(16).toString("base64");
    next();
  });

  app.use((req, res, next) => {
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", `'nonce-${res.locals.cspNonce}'`],
          styleSrc: ["'self'"],
        },
      },
    })(req, res, next);
  });

  app.use(
    session({
      store: new PgSession({ pool, createTableIfMissing: true }),
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: config.nodeEnv === "production",
        httpOnly: true,
        sameSite: "lax",
        maxAge: 2 * 60 * 60 * 1000,
      },
    }),
  );

  app.use((req, res, next) => {
    env.addGlobal("user", req.session.user ?? null);
    env.addGlobal("cspNonce", res.locals.cspNonce);
    next();
  });

  const govukStaticBase = path.join(
    __dirname,
    "../../public/govuk-frontend/govuk",
  );
  const govukStaticFallback = path.join(
    __dirname,
    "../../node_modules/govuk-frontend/dist/govuk",
  );
  const govukStaticDir = fs.existsSync(govukStaticBase)
    ? govukStaticBase
    : govukStaticFallback;
  const publicDir = path.join(__dirname, "../../public");
  app.use("/assets", express.static(path.join(govukStaticDir, "assets")));
  app.use("/stylesheets", express.static(govukStaticDir));
  app.use("/stylesheets", express.static(publicDir));
  app.use("/javascripts", express.static(govukStaticDir));

  app.use(
    "/api/modules/sbom",
    express.json({
      limit: config.maxPayloadBytes,
      type: ["application/json", "application/spdx+json"],
    }),
    createIngestRouter(pool, boss, config),
  );

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/", (req, res) => {
    if (req.session.user) {
      res.redirect("/dashboard");
      return;
    }
    res.render("home.njk", { title: "SBOM Service" });
  });

  app.use("/auth", authRouter(config));

  app.use("/dashboard", requireAuth(), dashboardRouter(pool));
  app.use("/services", requireAuth(), servicesRouter(pool));
  app.use(
    "/admin",
    requireAuth(),
    express.urlencoded({ extended: false }),
    adminRouter(pool, boss, config),
  );

  return app;
}
