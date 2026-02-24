/**
 * Background npm update checker — non-blocking fetch on startup.
 * Compares installed version against latest on npm registry.
 * If a newer version exists, produces a one-time notice
 * that gets appended to the first check_auth response.
 */

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(__filename), "..", "..");

let notice: string | null = null;

function getInstalledVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf-8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function initUpdateChecker(): void {
  const installed = getInstalledVersion();

  execFile("npm", ["view", "brightspace-mcp-server", "version"], { timeout: 10000, shell: true }, (err, stdout) => {
    if (err) return;
    const latest = stdout.trim();
    if (!latest) return;

    if (latest !== installed) {
      execFile("npm", ["install", "-g", "brightspace-mcp-server@latest"], { timeout: 60000, shell: true }, (installErr) => {
        if (installErr) {
          notice =
            `Update available: v${installed} → v${latest}. ` +
            "Run `npx brightspace-mcp-server@latest` or clear your npx cache to update.";
        } else {
          notice =
            `Auto-updated from v${installed} to v${latest}. ` +
            "Restart your MCP client to use the new version.";
        }
      });
    }
  });
}

export function getUpdateNotice(): string | null {
  const result = notice;
  notice = null;
  return result;
}
