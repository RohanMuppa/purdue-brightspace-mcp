import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { BrowserStateStore } from "../../src/auth/browser-state-store.js";
import { NativeCredentialStoreError } from "../../src/auth/credential-store.js";
import { MemoryCredentialBackend, retireTestFile, testBrowserState } from "./secure-store-fixtures.js";

describe("BrowserStateStore", () => {
  let dir: string;
  let backend: MemoryCredentialBackend;
  let store: BrowserStateStore;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "browser-state-test-"));
    backend = new MemoryCredentialBackend();
    store = new BrowserStateStore(dir, { backend, trash: retireTestFile });
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it("round-trips encrypted cookies and local storage after a restart", async () => {
    await store.save(testBrowserState);
    expect(await new BrowserStateStore(dir, { backend }).load()).toEqual(testBrowserState);
    const contents = await fs.readFile(path.join(dir, "storage-state.encrypted.json"), "utf8");
    expect(contents).not.toContain("dummy-browser-cookie-secret");
    expect(contents).not.toContain("dummy-local-storage-secret");
    expect(await fs.readdir(dir)).toEqual(["storage-state.encrypted.json"]);
  });

  it("loads old saved state without imposing an access-token TTL", async () => {
    await store.save(testBrowserState);
    const old = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    await fs.utimes(path.join(dir, "storage-state.encrypted.json"), old, old);
    expect(await store.load()).toEqual(testBrowserState);
  });

  it("migrates plaintext state and retires it only after verified encryption", async () => {
    await fs.writeFile(path.join(dir, "storage-state.json"), JSON.stringify(testBrowserState));
    expect(await store.load()).toEqual(testBrowserState);
    expect(await new BrowserStateStore(dir, { backend }).load()).toEqual(testBrowserState);
    await expect(fs.access(path.join(dir, "storage-state.json"))).rejects.toThrow();
    expect((await fs.readdir(dir)).some((name) => name.startsWith("storage-state.json.retired-"))).toBe(true);
  });

  it("preserves plaintext state if key storage is unavailable", async () => {
    const file = path.join(dir, "storage-state.json");
    const contents = JSON.stringify(testBrowserState);
    await fs.writeFile(file, contents);
    backend.setPassword = async () => { throw new NativeCredentialStoreError(); };
    await expect(store.load()).rejects.toBeInstanceOf(NativeCredentialStoreError);
    expect(await fs.readFile(file, "utf8")).toBe(contents);
    await expect(fs.access(path.join(dir, "storage-state.encrypted.json"))).rejects.toThrow();
  });

  it("preserves plaintext state when encrypted persistence fails", async () => {
    const contents = JSON.stringify(testBrowserState);
    await fs.writeFile(path.join(dir, "storage-state.json"), contents);
    const failing = new BrowserStateStore(dir, { backend, write: async () => { throw new Error("disk full"); } });
    await expect(failing.load()).rejects.toThrow();
    expect(await fs.readFile(path.join(dir, "storage-state.json"), "utf8")).toBe(contents);
  });

  it("detects tampering and never falls back to an old plaintext copy", async () => {
    await store.save(testBrowserState);
    await fs.writeFile(path.join(dir, "storage-state.json"), JSON.stringify(testBrowserState));
    const file = path.join(dir, "storage-state.encrypted.json");
    const record = JSON.parse(await fs.readFile(file, "utf8"));
    record.encrypted.authTag = "0".repeat(32);
    await fs.writeFile(file, JSON.stringify(record));
    await expect(store.load()).rejects.toThrow();
    expect(await fs.readFile(file, "utf8")).toBe(JSON.stringify(record));
    await expect(fs.access(path.join(dir, "storage-state.json"))).resolves.toBeUndefined();
  });

  it("returns undefined only when state has never been saved", async () => {
    expect(await store.load()).toBeUndefined();
    expect(backend.writes).toBe(0);
  });

  it("retries legacy cleanup after an interrupted migration", async () => {
    await fs.writeFile(path.join(dir, "storage-state.json"), JSON.stringify(testBrowserState));
    const interrupted = new BrowserStateStore(dir, { backend, trash: async () => { throw new Error("trash unavailable"); } });
    await expect(interrupted.load()).rejects.toThrow();
    expect(await store.load()).toEqual(testBrowserState);
    await expect(fs.access(path.join(dir, "storage-state.json"))).rejects.toThrow();
  });

  it("never overwrites encrypted browser state with a replacement key", async () => {
    await store.save(testBrowserState);
    const file = path.join(dir, "storage-state.encrypted.json");
    const original = await fs.readFile(file, "utf8");
    backend.values.clear();
    await expect(store.save(testBrowserState)).rejects.toBeInstanceOf(NativeCredentialStoreError);
    expect(await fs.readFile(file, "utf8")).toBe(original);
    expect(backend.writes).toBe(1);
  });
});
