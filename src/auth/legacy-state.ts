/**
 * Brightspace MCP Server
 * Copyright (c) 2026 Rohan Muppa. All rights reserved.
 * Licensed under MIT. See LICENSE file for details.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { acquireProcessLock, AuthenticationInProgressError } from "./auth-lock.js";
import { BrowserStateStore } from "./browser-state-store.js";
import { NativeCredentialStoreError } from "./credential-store.js";
import { SessionStore } from "./session-store.js";
import { log } from "../utils/logger.js";

type StateDisposition = "absent" | "encrypted" | "preserved";
export interface LegacyMigrationResult {
  tokenState: StateDisposition;
  browserState: StateDisposition;
}

async function fileKind(root: string, name: string): Promise<"absent" | "regular" | "unsafe"> {
  try {
    const stat = await fs.lstat(path.join(root, name));
    return stat.isFile() && !stat.isSymbolicLink() ? "regular" : "unsafe";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent";
    throw error;
  }
}

function reportPreserved(label: string): void {
  log("WARN", `Legacy ${label} could not be migrated safely and was preserved in the original session directory. The new account will use a separate session.`);
}

async function migrate(label: string, operation: () => Promise<unknown>): Promise<StateDisposition> {
  try {
    await operation();
    return "encrypted";
  } catch (error) {
    if (error instanceof NativeCredentialStoreError || error instanceof AuthenticationInProgressError) throw error;
    reportPreserved(label);
    return "preserved";
  }
}

/** Secure v1 state in its original directory without assigning it to a new identity. */
export async function migrateLegacyState(sessionRoot: string): Promise<LegacyMigrationResult> {
  const names = ["session.json", "storage-state.json", "storage-state.encrypted.json"];
  const kinds = await Promise.all(names.map((name) => fileKind(sessionRoot, name)));
  if (kinds.every((kind) => kind === "absent")) return { tokenState: "absent", browserState: "absent" };

  const release = await acquireProcessLock(path.join(sessionRoot, ".auth.lock"));
  try {
    const result: LegacyMigrationResult = { tokenState: "absent", browserState: "absent" };
    // Recheck under the process lock; never follow links into another directory.
    const token = await fileKind(sessionRoot, "session.json");
    if (token !== "absent") {
      const salt = await fileKind(sessionRoot, "salt");
      if (token === "unsafe" || salt === "unsafe") {
        reportPreserved("token state");
        result.tokenState = "preserved";
      } else {
        result.tokenState = await migrate("token state", () => new SessionStore(sessionRoot).load());
      }
    }

    const [plain, encrypted] = await Promise.all([
      fileKind(sessionRoot, "storage-state.json"), fileKind(sessionRoot, "storage-state.encrypted.json"),
    ]);
    if (plain === "unsafe" || encrypted === "unsafe") {
      reportPreserved("browser state");
      result.browserState = "preserved";
    } else if (plain !== "absent" || encrypted !== "absent") {
      result.browserState = await migrate("browser state", () => new BrowserStateStore(sessionRoot).load());
    }
    return result;
  } finally {
    await release();
  }
}
