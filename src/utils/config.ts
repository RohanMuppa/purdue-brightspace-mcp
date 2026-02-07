import * as path from "node:path";
import * as os from "node:os";
import type { AppConfig } from "../types/index.js";

export function loadConfig(): AppConfig {
  const sessionDir = process.env.D2L_SESSION_DIR
    ? expandTilde(process.env.D2L_SESSION_DIR)
    : path.join(os.homedir(), ".d2l-session");

  return {
    baseUrl: process.env.D2L_BASE_URL || "https://purdue.brightspace.com",
    sessionDir,
    tokenTtl: parseInt(process.env.D2L_TOKEN_TTL || "3600", 10),
    headless: process.env.D2L_HEADLESS === "true",
    username: process.env.D2L_USERNAME,
    password: process.env.D2L_PASSWORD,
    totpSecret: process.env.MFA_TOTP_SECRET,
  };
}

function expandTilde(filePath: string): string {
  if (filePath.startsWith("~")) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

export type { AppConfig };
