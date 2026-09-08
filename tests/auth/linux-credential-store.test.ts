import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { createLinuxCredentialBackend, NativeCredentialStoreError, type SecretToolResult } from "../../src/auth/credential-store.js";

const childMocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: childMocks.spawn }));
const result = (code = 0, stdout = "", stderr = ""): SecretToolResult => ({ code, stdout, stderr });

describe("strict Linux Secret Service adapter", () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.useRealTimers(); });

  it("preserves exact piped secret bytes, including leading spaces and trailing newlines", async () => {
    const run = vi.fn(async () => result(0, " secret with whitespace\n"));
    expect(await createLinuxCredentialBackend(run).getPassword("service", "account")).toBe(" secret with whitespace\n");
    expect(run).toHaveBeenCalledWith(["lookup", "service", "service", "username", "account"]);
  });

  it("accepts absence only after an empty successful exact-attribute search", async () => {
    const run = vi.fn().mockResolvedValueOnce(result(1)).mockResolvedValueOnce(result());
    expect(await createLinuxCredentialBackend(run).getPassword("service", "account")).toBeNull();
    expect(run).toHaveBeenLastCalledWith(["search", "--all", "service", "service", "username", "account"]);
  });

  it("treats dismissed unlock as unavailable instead of creating replacement credentials", async () => {
    const run = vi.fn().mockResolvedValueOnce(result(1)).mockResolvedValueOnce(result(0, "[/org/freedesktop/secrets/item/1]\n", "item is locked"));
    await expect(createLinuxCredentialBackend(run).getPassword("service", "account")).rejects.toBeInstanceOf(NativeCredentialStoreError);
    expect(run.mock.calls.every(([args]) => args[0] !== "store")).toBe(true);
  });

  it("sends stored secrets through stdin without putting them in process arguments", async () => {
    let stdin: string | undefined;
    childMocks.spawn.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & Record<string, any>;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = new EventEmitter();
      child.kill = vi.fn();
      child.stdin.end = (value: string) => { stdin = value; queueMicrotask(() => child.emit("close", 0)); };
      return child;
    });
    await createLinuxCredentialBackend().setPassword("service", "account", "dummy-password\n");
    expect(stdin).toBe("dummy-password\n");
    expect(childMocks.spawn).toHaveBeenCalledWith("secret-tool", ["store", "--label=Brightspace MCP", "--collection=default", "service", "service", "username", "account"], { stdio: ["pipe", "pipe", "pipe"] });
    expect(JSON.stringify(childMocks.spawn.mock.calls)).not.toContain("dummy-password");
  });

  it("requires successful deletion verification", async () => {
    const run = vi.fn().mockResolvedValueOnce(result()).mockResolvedValueOnce(result());
    await expect(createLinuxCredentialBackend(run).deletePassword("service", "account")).resolves.toBeUndefined();
    expect(run.mock.calls.map(([args]) => args[0])).toEqual(["clear", "search"]);
    const locked = vi.fn().mockResolvedValueOnce(result(1)).mockResolvedValueOnce(result(0, "[existing item]"));
    await expect(createLinuxCredentialBackend(locked).deletePassword("service", "account")).rejects.toThrow("Secret Service");
  });

  it("reports missing executable without exposing process diagnostics", async () => {
    childMocks.spawn.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & Record<string, any>;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = new EventEmitter();
      child.stdin.end = vi.fn();
      child.kill = vi.fn();
      queueMicrotask(() => child.emit("error", Object.assign(new Error("sensitive diagnostic"), { code: "ENOENT" })));
      return child;
    });
    const error = await createLinuxCredentialBackend().getPassword("service", "account").catch((error: unknown) => error) as Error;
    expect(error).toBeInstanceOf(NativeCredentialStoreError);
    expect(error.message).toContain("secret-tool");
    expect(error.message).not.toContain("sensitive diagnostic");
    expect(error.cause).toBeUndefined();
  });

  it("does not include a failed tool's secret output in errors", async () => {
    const run = vi.fn(async () => result(1, "dummy-private-value", "diagnostic contains dummy-private-value"));
    const error = await createLinuxCredentialBackend(run).getPassword("service", "account").catch((error: unknown) => error) as Error;
    expect(error.message).not.toContain("dummy-private-value");
    expect(error.cause).toBeUndefined();
  });

  it("rejects secrets larger than the libsecret stdin reader supports", async () => {
    const run = vi.fn();
    await expect(createLinuxCredentialBackend(run).setPassword("service", "account", "x".repeat(8192))).rejects.toThrow("supported size");
    expect(run).not.toHaveBeenCalled();
  });
});
