import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

export const MFA_COOLDOWN_MS = 4 * 60 * 60 * 1000;

export class AuthenticationCooldownError extends Error {
  readonly code = "AUTH_COOLDOWN";
  constructor(public readonly retryAt: number) {
    super(`A previous MFA attempt failed. Automatic login resumes at ${new Date(retryAt).toISOString()}. Run brightspace-auth to retry now.`);
    this.name = "AuthenticationCooldownError";
  }
}

/** Non-secret retry metadata. Call only while holding the authentication lock. */
export class AuthCooldown {
  private readonly file: string;
  constructor(sessionDir: string) {
    this.file = path.join(sessionDir, "auth-status.json");
  }

  async assertAllowed(): Promise<void> {
    let content: string;
    try {
      content = await fs.readFile(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const status = JSON.parse(content) as { retryAt?: number };
    if (typeof status.retryAt === "number" && status.retryAt > Date.now()) throw new AuthenticationCooldownError(status.retryAt);
  }

  async recordMfaFailure(): Promise<void> {
    await this.write({ retryAt: Date.now() + MFA_COOLDOWN_MS });
  }

  async clear(): Promise<void> {
    await this.write({ retryAt: 0 });
  }

  private async write(status: { retryAt: number }): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(status), { mode: 0o600, flag: "wx" });
    await fs.rename(temporary, this.file);
  }
}
