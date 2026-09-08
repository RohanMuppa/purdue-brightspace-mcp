import { describe, expect, it, vi } from "vitest";
import * as path from "node:path";
vi.mock("../../src/utils/secure-config.js", () => ({ resolveStoredPassword: vi.fn() }));
import { accountSessionDirectory } from "../../src/utils/config.js";

describe("account session isolation", () => {
  const root = path.resolve("test-session-root");
  it("uses stable directories across process restarts and equivalent school origins", () => {
    const first = accountSessionDirectory(root, "https://school.example", "alice");
    expect(accountSessionDirectory(root, "https://school.example/", "alice")).toBe(first);
    expect(first.startsWith(path.join(root, "accounts") + path.sep)).toBe(true);
  });
  it("isolates different accounts at the same school", () => {
    expect(accountSessionDirectory(root, "https://school.example", "alice"))
      .not.toBe(accountSessionDirectory(root, "https://school.example", "bob"));
  });
  it("isolates the same username at different schools", () => {
    expect(accountSessionDirectory(root, "https://school.example", "alice"))
      .not.toBe(accountSessionDirectory(root, "https://other.example", "alice"));
  });
  it("retains the explicit legacy recovery path when no username is configured", () => {
    expect(accountSessionDirectory(root, "https://school.example")).toBe(root);
  });
});
