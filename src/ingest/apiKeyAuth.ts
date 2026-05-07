import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { Pool } from "pg";
import { findActiveApiKeyByPrefix, updateApiKeyLastUsed } from "../db/queries";

const API_KEY_PREFIX_LENGTH = 8;

export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export function createApiKeyAuthMiddleware(pool: Pool) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const apiKey = req.headers["x-api-key"] as string | undefined;
    if (!apiKey) {
      res.status(401).json({ error: "Missing X-API-Key header" });
      return;
    }

    const prefix = apiKey.substring(0, API_KEY_PREFIX_LENGTH);
    const keyRow = await findActiveApiKeyByPrefix(pool, prefix);

    if (!keyRow) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }

    const hash = hashApiKey(apiKey);
    if (hash !== keyRow.key_hash) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }

    const serviceId = req.params.service_id;
    if (keyRow.service_id !== serviceId) {
      res
        .status(403)
        .json({ error: "API key does not have access to this service" });
      return;
    }

    req.apiKeyLabel = keyRow.key_prefix;
    updateApiKeyLastUsed(pool, keyRow.id).catch(() => {});
    next();
  };
}
