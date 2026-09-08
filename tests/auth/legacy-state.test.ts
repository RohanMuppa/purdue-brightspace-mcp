import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { migrateLegacyState } from "../../src/auth/legacy-state.js";
import { nativeCredentialBackend, NativeCredentialStoreError } from "../../src/auth/credential-store.js";
import { acquireProcessLock, AuthenticationInProgressError } from "../../src/auth/auth-lock.js";
import { SessionStore } from "../../src/auth/session-store.js";
import { BrowserStateStore } from "../../src/auth/browser-state-store.js";
import { MemoryCredentialBackend, testBrowserState, testToken, writeLegacySession, retireTestFile } from "./secure-store-fixtures.js";

vi.mock("trash", () => ({ default: async (file: string) => { await retireTestFile(file); } }));
vi.mock("../../src/utils/logger.js", () => ({ log: vi.fn() }));

describe("original-root legacy migration", () => {
  let root: string;
  let backend: MemoryCredentialBackend;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "legacy-root-test-"));
    backend = new MemoryCredentialBackend();
    vi.spyOn(nativeCredentialBackend, "getPassword").mockImplementation(backend.getPassword.bind(backend));
    vi.spyOn(nativeCredentialBackend, "setPassword").mockImplementation(backend.setPassword.bind(backend));
    vi.spyOn(nativeCredentialBackend, "deletePassword").mockImplementation(backend.deletePassword.bind(backend));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("encrypts exact old files in place without copying them into an account directory", async () => {
    await writeLegacySession(root);
    await fs.writeFile(path.join(root, "storage-state.json"), JSON.stringify(testBrowserState));
    expect(await migrateLegacyState(root)).toEqual({ tokenState: "encrypted", browserState: "encrypted" });
    expect(await new SessionStore(root).load()).toEqual(testToken);
    expect(await new BrowserStateStore(root).load()).toEqual(testBrowserState);
    expect(JSON.parse(await fs.readFile(path.join(root, "session.json"), "utf8")).version).toBe(2);
    expect(await fs.readFile(path.join(root, "storage-state.encrypted.json"), "utf8")).not.toContain("dummy-browser-cookie-secret");
    await expect(fs.access(path.join(root, "storage-state.json"))).rejects.toThrow();
    await expect(fs.access(path.join(root, "accounts"))).rejects.toThrow();
    expect(await migrateLegacyState(root)).toEqual({ tokenState: "encrypted", browserState: "encrypted" });
  });

  it("does nothing when no exact legacy state file exists", async () => {
    await fs.mkdir(path.join(root, "browser-data"));
    await fs.writeFile(path.join(root, "storage-state.json.backup"), "untouched");
    expect(await migrateLegacyState(root)).toEqual({ tokenState: "absent", browserState: "absent" });
    expect(backend.writes).toBe(0);
    expect(await fs.readFile(path.join(root, "storage-state.json.backup"), "utf8")).toBe("untouched");
  });

  it("preserves unreadable legacy data while permitting a separate fresh account", async () => {
    await fs.writeFile(path.join(root, "session.json"), "invalid-token-data");
    await fs.writeFile(path.join(root, "storage-state.json"), "invalid-browser-data");
    expect(await migrateLegacyState(root)).toEqual({ tokenState: "preserved", browserState: "preserved" });
    expect(await fs.readFile(path.join(root, "session.json"), "utf8")).toBe("invalid-token-data");
    expect(await fs.readFile(path.join(root, "storage-state.json"), "utf8")).toBe("invalid-browser-data");
  });

  it("propagates native vault failure and preserves the legacy source", async () => {
    const original = await writeLegacySession(root);
    vi.mocked(nativeCredentialBackend.getPassword).mockRejectedValue(new NativeCredentialStoreError("Linux Secret Service unavailable"));
    await expect(migrateLegacyState(root)).rejects.toThrow("Linux Secret Service unavailable");
    expect(await fs.readFile(path.join(root, "session.json"), "utf8")).toBe(original);
    const release = await acquireProcessLock(path.join(root, ".auth.lock"));
    await release();
  });

  it("does not start migration while root authentication owns the directory", async () => {
    await writeLegacySession(root);
    const release = await acquireProcessLock(path.join(root, ".auth.lock"));
    try {
      await expect(migrateLegacyState(root)).rejects.toBeInstanceOf(AuthenticationInProgressError);
      expect(backend.writes).toBe(0);
    } finally {
      await release();
    }
  });

  it.runIf(process.platform !== "win32")("never follows legacy state symlinks", async () => {
    const target = path.join(root, "outside-state");
    await fs.writeFile(target, JSON.stringify(testBrowserState));
    await fs.symlink(target, path.join(root, "storage-state.json"));
    expect(await migrateLegacyState(root)).toEqual({ tokenState: "absent", browserState: "preserved" });
    expect(await fs.readFile(target, "utf8")).toBe(JSON.stringify(testBrowserState));
    expect(backend.writes).toBe(0);
  });
});
