/**
 * Purdue Brightspace MCP Server
 * Copyright (c) 2025 Rohan Muppa. All rights reserved.
 * Licensed under AGPL-3.0 — see LICENSE file for details.
 */

import type { Page } from "playwright";
import { BrowserAuthError } from "../utils/errors.js";
import { log } from "../utils/logger.js";

const SELECTORS = {
  usernameInput: "input#username",
  passwordInput: "input#password",
  submitButton: 'button[name="_eventId_proceed"]',
  staySignedInYes: "input[type=submit][value='Yes']",
} as const;

interface PurdueSSOConfig {
  username?: string;
  password?: string;
}

export class PurdueSSOFlow {
  private config: PurdueSSOConfig;

  constructor(config: PurdueSSOConfig) {
    this.config = config;
  }

  /**
   * Execute the complete Microsoft Entra ID SSO login flow for Purdue.
   * Handles institution selector, email/password entry, MFA (TOTP or manual), and "stay signed in" prompt.
   *
   * @param page - Playwright page instance (already navigated to Brightspace or redirected to login)
   * @returns true on successful login (URL contains /d2l/home), false on timeout/failure
   */
  async login(page: Page): Promise<boolean> {
    try {
      log("INFO", "Starting Purdue SSO login flow");

      // Step 1: Handle campus selector on purdue.brightspace.com/d2l/login
      await this.handleCampusSelector(page);

      // Step 2: Enter username + password on sso.purdue.edu (Shibboleth)
      await this.enterCredentials(page);

      // Step 3: Handle MFA (TOTP automated or manual approval)
      await this.handleMFA(page);

      // Step 4: Handle "Stay signed in?" prompt
      await this.handleStaySignedIn(page);

      // Step 5: Wait for successful redirect to Brightspace home
      await page.waitForURL(/\/d2l\/home/, { timeout: 120000 });
      log("INFO", "Login successful - reached Brightspace home");

      return true;
    } catch (error) {
      log("ERROR", "SSO login flow failed", error);
      return false;
    }
  }

  private async handleCampusSelector(page: Page): Promise<void> {
    const currentUrl = page.url();
    if (currentUrl.includes("/d2l/login")) {
      // Campus selector buttons are inside a shadow DOM — navigate directly
      // to Purdue's Shibboleth SAML endpoint instead of clicking them
      const baseUrl = new URL(currentUrl).origin;
      log("INFO", "Campus selector detected — navigating directly to Shibboleth IdP");
      await page.goto(
        `${baseUrl}/d2l/lp/auth/saml/initiate-login?entityId=https://idp.purdue.edu/idp/shibboleth`,
        { waitUntil: "networkidle", timeout: 30000 }
      );
    }
    // Already on sso.purdue.edu or past the campus selector — nothing to do
  }

  private async enterCredentials(page: Page): Promise<void> {
    try {
      log("DEBUG", "Waiting for Shibboleth login form");
      await page.waitForSelector(SELECTORS.usernameInput, { timeout: 30000 });

      if (!this.config.username) {
        throw new BrowserAuthError(
          "Username is required for SSO login",
          "credentials"
        );
      }

      if (!this.config.password) {
        throw new BrowserAuthError(
          "Password is required for SSO login",
          "credentials"
        );
      }

      log("INFO", "Entering credentials");
      await page.fill(SELECTORS.usernameInput, this.config.username);
      await page.fill(SELECTORS.passwordInput, this.config.password);
      await page.click(SELECTORS.submitButton);
      await page.waitForLoadState("networkidle");
    } catch (error) {
      if (error instanceof BrowserAuthError) throw error;
      throw new BrowserAuthError(
        "Failed to enter credentials",
        "credentials",
        error as Error
      );
    }
  }

  private async handleMFA(page: Page): Promise<void> {
    try {
      log("WARN", "Waiting for Microsoft MFA approval on your device...");
      log("INFO", "Timeout: 120 seconds");
      log("INFO", "Browser is running in headed mode - please approve the MFA request on your phone");

      // Wait for MFA approval (page will automatically redirect after approval)
      // We don't need to click anything - just wait for the redirect
      await page.waitForLoadState("networkidle", { timeout: 120000 });
      log("INFO", "MFA approval detected");
    } catch (error) {
      throw new BrowserAuthError(
        "MFA approval timed out after 120 seconds",
        "mfa_approval",
        error as Error
      );
    }
  }

  private async handleStaySignedIn(page: Page): Promise<void> {
    try {
      log("DEBUG", "Checking for 'Stay signed in?' prompt");
      const staySignedInButton = await page.waitForSelector(
        SELECTORS.staySignedInYes,
        { timeout: 10000 }
      );
      if (staySignedInButton) {
        log("INFO", "Clicking 'Yes' on 'Stay signed in?' prompt");
        await staySignedInButton.click();
        await page.waitForLoadState("networkidle");
      }
    } catch (error) {
      // Prompt may not appear - this is normal
      log("DEBUG", "No 'Stay signed in?' prompt found (this is normal)");
    }
  }
}
