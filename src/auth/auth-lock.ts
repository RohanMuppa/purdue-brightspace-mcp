import * as fs from "node:fs/promises";
import * as path from "node:path";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

export class AuthenticationInProgressError extends Error {
  readonly code = "AUTH_IN_PROGRESS";
  constructor() {
    super("Authentication already in progress. Retry after the current authentication finishes.");
    this.name = "AuthenticationInProgressError";
  }
}

interface Owner {
  pid: number;
  host: string;
  nonce: string;
}

async function readOwner(lockPath: string): Promise<Owner | undefined> {
  try {
    const owner = JSON.parse(await fs.readFile(path.join(lockPath, "owner.json"), "utf8"));
    if (Number.isSafeInteger(owner.pid) && owner.pid > 0 && typeof owner.host === "string" && typeof owner.nonce === "string") return owner;
  } catch {
    // An incomplete or unknown lock is not proof that its owner is gone.
  }
  return undefined;
}

function isDead(owner: Owner): boolean {
  // Session directories are local-only. DHCP can change the host's name
  // without changing this process table, so only PID liveness decides.
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

/** Remove only our fixed metadata names, after the directory was retired. */
async function cleanRetired(lockPath: string): Promise<void> {
  await fs.unlink(path.join(lockPath, "owner.json")).catch(() => {});
  await cleanChild(path.join(lockPath, "reclaim.lock"));
  await fs.rmdir(lockPath).catch(() => {});
}
async function cleanChild(childPath: string): Promise<void> {
  try {
    if ((await fs.lstat(childPath)).isDirectory()) await cleanRetired(childPath);
  } catch { /* Already absent. */ }
}

class Lease {
  constructor(public directory: string, readonly owner: Owner) {}
  async release(): Promise<void> {
    const current = await readOwner(this.directory);
    if (current?.nonce !== this.owner.nonce) return;
    const retired = `${this.directory}.released.${this.owner.nonce}`;
    await fs.rename(this.directory, retired);
    await cleanRetired(retired);
  }
}

/** Acquire a process-shared lock without waiting or relying on its age. */
export async function acquireProcessLock(lockPath: string): Promise<() => Promise<void>> {
  await fs.mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  const lease = await acquireLease(lockPath, 0);
  return () => lease.release();
}

async function acquireLease(lockPath: string, depth: number): Promise<Lease> {
  if (depth > 16) throw new AuthenticationInProgressError();
  const owner: Owner = { pid: process.pid, host: hostname(), nonce: randomUUID() };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await fs.mkdir(lockPath, { mode: 0o700 });
      try {
        await fs.writeFile(path.join(lockPath, "owner.json"), JSON.stringify(owner), { flag: "wx", mode: 0o600 });
      } catch (error) {
        await fs.rmdir(lockPath).catch(() => {});
        throw error;
      }
      return new Lease(lockPath, owner);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new AuthenticationInProgressError();
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }

    const stale = await readOwner(lockPath);
    if (!stale || !isDead(stale)) throw new AuthenticationInProgressError();
    // Recovery gets its own process lock within the stale directory. If a
    // recovering process crashes, the same dead-owner rules recover its lock.
    // Keep this claim in the directory during rename to serialize contenders.
    const claim = await acquireLease(path.join(lockPath, "reclaim.lock"), depth + 1);
    try {
      const current = await readOwner(lockPath);
      if (current?.nonce !== stale.nonce || !isDead(current)) throw new AuthenticationInProgressError();
      const retired = `${lockPath}.stale.${owner.nonce}`;
      await fs.rename(lockPath, retired);
      claim.directory = path.join(retired, "reclaim.lock");
      await claim.release();
      await cleanRetired(retired);
    } finally {
      await claim.release();
    }
  }
  throw new AuthenticationInProgressError();
}
