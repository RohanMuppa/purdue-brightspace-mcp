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

async function isV2Session(root: string): Promise<boolean> {
  try {
    return JSON.parse(await fs.readFile(path.join(root, "session.json"), "utf8")).version === 2;
  } catch {
    return false;
  }
}

/** Secure v1 state in its original directory without assigning it to a new identity. */
export async function migrateLegacyState(sessionRoot: string): Promise<LegacyMigrationResult> {
  const names = ["session.json", "storage-state.json", "storage-state.encrypted.json"];
  const kinds = await Promise.all(names.map((name) => fileKind(sessionRoot, name)));
  if (kinds.every((kind) => kind === "absent")) return { tokenState: "absent", browserState: "absent" };

  const [token, plainBrowser, encryptedBrowser] = kinds;
  const tokenAlreadyV2 = token === "regular" && await isV2Session(sessionRoot);
  // Once migration is complete, validation is read-only and must not make
  // concurrent MCP startups contend on the authentication lock.
  if ((token === "absent" || token === "unsafe" || tokenAlreadyV2) && plainBrowser === "absent") {
    let tokenState: StateDisposition = "absent";
    if (token === "unsafe") {
      reportPreserved("token state");
      tokenState = "preserved";
    } else if (tokenAlreadyV2) {
      tokenState = await migrate("token state", () => new SessionStore(sessionRoot).load());
    }

    let browserState: StateDisposition = "absent";
    if (encryptedBrowser === "unsafe") {
      reportPreserved("browser state");
      browserState = "preserved";
    } else if (encryptedBrowser === "regular") {
      browserState = await migrate("browser state", () => new BrowserStateStore(sessionRoot).load());
    }
    return { tokenState, browserState };
  }

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
