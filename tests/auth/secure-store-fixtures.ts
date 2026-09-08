import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { randomBytes, scryptSync } from "node:crypto";
import type { CredentialBackend } from "../../src/auth/credential-store.js";
import { encrypt } from "../../src/auth/encrypted-store.js";
import type { TokenData } from "../../src/types/index.js";

export class MemoryCredentialBackend implements CredentialBackend {
  readonly values = new Map<string, string>();
  writes = 0;
  async getPassword(service: string, account: string) {
    return this.values.get(JSON.stringify([service, account])) ?? null;
  }
  async setPassword(service: string, account: string, password: string) {
    this.writes++;
    this.values.set(JSON.stringify([service, account]), password);
  }
  async deletePassword(service: string, account: string) {
    this.values.delete(JSON.stringify([service, account]));
  }
}

export const testToken: TokenData = {
  accessToken: "dummy-bearer-secret", capturedAt: 100, expiresAt: 3_600_100,
  source: "browser", cookieHeader: "d2lSessionVal=dummy-cookie-secret", csrfToken: "dummy-xsrf-secret",
};

export const testBrowserState = {
  cookies: [{ name: "d2lSessionVal", value: "dummy-browser-cookie-secret", domain: "school.example", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "None" as const }],
  origins: [{ origin: "https://school.example", localStorage: [{ name: "state", value: "dummy-local-storage-secret" }] }],
};

export async function writeLegacySession(dir: string, material = os.userInfo().username): Promise<string> {
  const salt = randomBytes(16);
  await fs.writeFile(path.join(dir, "salt"), salt);
  const contents = JSON.stringify({ version: 1, encrypted: encrypt(JSON.stringify(testToken), scryptSync(material, salt, 32)), createdAt: 100, expiresAt: testToken.expiresAt });
  await fs.writeFile(path.join(dir, "session.json"), contents);
  return contents;
}

/** Keep retired test fixtures within the test directory for inspection. */
export async function retireTestFile(file: string): Promise<void> {
  await fs.rename(file, `${file}.retired-${randomBytes(4).toString("hex")}`);
}
