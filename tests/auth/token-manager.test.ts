import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TokenManager } from "../../src/auth/token-manager.js";
import { SessionStore } from "../../src/auth/session-store.js";
import type { TokenData } from "../../src/types/index.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

describe("TokenManager", () => {
  let testDir: string;
  let tokenManager: TokenManager;

  beforeEach(async () => {
    // Create isolated temp directory for each test
    testDir = path.join(
      os.tmpdir(),
      `token-manager-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    tokenManager = new TokenManager(testDir);
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("getToken", () => {
    it("returns null when no token cached and no session file", async () => {
      const token = await tokenManager.getToken();
      expect(token).toBeNull();
    });

    it("returns null for expired token", async () => {
      // Create token that expired 1 hour ago
      const expiredToken: TokenData = {
        accessToken: "expired-token",
        capturedAt: Date.now() - 7200000, // 2 hours ago
        expiresAt: Date.now() - 3600000, // 1 hour ago
        source: "browser",
      };

      await tokenManager.setToken(expiredToken);
      const retrieved = await tokenManager.getToken();

      expect(retrieved).toBeNull();
    });

    it("returns null for token expiring within refresh buffer", async () => {
      // Create token that expires in 4 minutes (buffer is 5 minutes)
      const soonToExpireToken: TokenData = {
        accessToken: "soon-to-expire",
        capturedAt: Date.now(),
        expiresAt: Date.now() + 4 * 60 * 1000, // 4 minutes from now
        source: "browser",
      };

      await tokenManager.setToken(soonToExpireToken);
      const retrieved = await tokenManager.getToken();

      expect(retrieved).toBeNull();
    });

    it("loads from session store if not in memory", async () => {
      // Create valid token that expires in 10 minutes
      const validToken: TokenData = {
        accessToken: "stored-token",
        capturedAt: Date.now(),
        expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
        source: "browser",
      };

      // Save directly via session store (bypassing memory cache)
      const sessionStore = new SessionStore(testDir);
      await sessionStore.save(validToken);

      // Create new TokenManager instance (fresh memory)
      const newTokenManager = new TokenManager(testDir);
      const retrieved = await newTokenManager.getToken();

      expect(retrieved).toEqual(validToken);
    });
  });

  describe("setToken", () => {
    it("caches token in memory", async () => {
      const token: TokenData = {
        accessToken: "cached-token",
        capturedAt: Date.now(),
        expiresAt: Date.now() + 3600000, // 1 hour
        source: "browser",
      };

      await tokenManager.setToken(token);
      const retrieved = await tokenManager.getToken();

      expect(retrieved).toEqual(token);
    });

    it("persists token to session store", async () => {
      const token: TokenData = {
        accessToken: "persisted-token",
        capturedAt: Date.now(),
        expiresAt: Date.now() + 3600000, // 1 hour
        source: "browser",
      };

      await tokenManager.setToken(token);

      // Create new TokenManager with same session dir (fresh memory)
      const newTokenManager = new TokenManager(testDir);
      const retrieved = await newTokenManager.getToken();

      expect(retrieved).toEqual(token);
    });
  });

  describe("isValid", () => {
    it("returns false for expired tokens", () => {
      const expiredToken: TokenData = {
        accessToken: "expired",
        capturedAt: Date.now() - 7200000,
        expiresAt: Date.now() - 3600000, // Expired 1 hour ago
        source: "browser",
      };

      expect(tokenManager.isValid(expiredToken)).toBe(false);
    });

    it("returns false for tokens expiring within buffer", () => {
      const soonExpiredToken: TokenData = {
        accessToken: "soon-expired",
        capturedAt: Date.now(),
        expiresAt: Date.now() + 4 * 60 * 1000, // 4 minutes (< 5 min buffer)
        source: "browser",
      };

      expect(tokenManager.isValid(soonExpiredToken)).toBe(false);
    });

    it("returns true for tokens with sufficient time", () => {
      const validToken: TokenData = {
        accessToken: "valid",
        capturedAt: Date.now(),
        expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
        source: "browser",
      };

      expect(tokenManager.isValid(validToken)).toBe(true);
    });
  });

  describe("clearToken", () => {
    it("removes from memory and disk", async () => {
      const token: TokenData = {
        accessToken: "to-be-cleared",
        capturedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        source: "browser",
      };

      await tokenManager.setToken(token);

      // Verify it's there
      let retrieved = await tokenManager.getToken();
      expect(retrieved).toEqual(token);

      // Clear
      await tokenManager.clearToken();

      // Verify it's gone
      retrieved = await tokenManager.getToken();
      expect(retrieved).toBeNull();

      // Verify it's also gone from disk (new manager instance)
      const newTokenManager = new TokenManager(testDir);
      retrieved = await newTokenManager.getToken();
      expect(retrieved).toBeNull();
    });
  });

  describe("needsRefresh", () => {
    it("returns true when no valid token available", async () => {
      const needsRefresh = await tokenManager.needsRefresh();
      expect(needsRefresh).toBe(true);
    });

    it("returns true when token is expired", async () => {
      const expiredToken: TokenData = {
        accessToken: "expired",
        capturedAt: Date.now() - 7200000,
        expiresAt: Date.now() - 3600000,
        source: "browser",
      };

      await tokenManager.setToken(expiredToken);
      const needsRefresh = await tokenManager.needsRefresh();

      expect(needsRefresh).toBe(true);
    });

    it("returns false when valid token exists", async () => {
      const validToken: TokenData = {
        accessToken: "valid",
        capturedAt: Date.now(),
        expiresAt: Date.now() + 10 * 60 * 1000,
        source: "browser",
      };

      await tokenManager.setToken(validToken);
      const needsRefresh = await tokenManager.needsRefresh();

      expect(needsRefresh).toBe(false);
    });
  });
});
