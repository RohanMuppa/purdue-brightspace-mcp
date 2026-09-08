import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Browser, BrowserContext, Route } from "playwright";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { BrowserAuth } from "../../src/auth/browser-auth.js";
import { BrowserStateStore, type BrowserState } from "../../src/auth/browser-state-store.js";
import { nativeCredentialBackend } from "../../src/auth/credential-store.js";
import { UnsupportedAuthenticationError } from "../../src/auth/sso-flow.js";
import type { AppConfig } from "../../src/types/index.js";
import { MemoryCredentialBackend } from "./secure-store-fixtures.js";

const BASE = "https://brightspace.fixture.invalid";
const IDP = "https://sso.fixture.invalid";
const enabled = process.env.BRIGHTSPACE_TEST_BROWSER === "1";
const browserHarness = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock("playwright", () => ({ chromium: { launch: browserHarness.launch } }));

function cookie(name: string, value: string, domain: string): BrowserState["cookies"][number] {
  return { name, value, domain, path: "/", expires: -1, httpOnly: false, secure: true, sameSite: "None" };
}

async function navigateFixture(route: Route, destination: string): Promise<void> {
  // Script navigation starts a new intercepted request. Chromium follows a
  // fulfilled HTTP redirect outside the route handler's original request.
  await route.fulfill({ contentType: "text/html", body: `<!doctype html><script>location.replace(${JSON.stringify(destination)});</script>` });
}

describe.runIf(enabled)("actual Chromium authentication fixtures", () => {
  let dir: string;
  let config: AppConfig;
  let store: BrowserStateStore;
  let routeHandler: (route: Route) => Promise<void>;
  let browsers: Browser[];
  let contexts: BrowserContext[];
  let launchedHeadless: boolean[];
  let restoredMarkers: Array<string | null>;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "brightspace-live-fixture-"));
    const backend = new MemoryCredentialBackend();
    vi.spyOn(nativeCredentialBackend, "getPassword").mockImplementation(backend.getPassword.bind(backend));
    vi.spyOn(nativeCredentialBackend, "setPassword").mockImplementation(backend.setPassword.bind(backend));
    vi.spyOn(nativeCredentialBackend, "deletePassword").mockImplementation(backend.deletePassword.bind(backend));
    config = { baseUrl: BASE, sessionDir: dir, tokenTtl: 3600, headless: true, courseFilter: {} } as AppConfig;
    store = new BrowserStateStore(dir);
    browsers = [];
    contexts = [];
    launchedHeadless = [];
    restoredMarkers = [];
    routeHandler = async (route) => { await route.abort("blockedbyclient"); };

    const { chromium } = await vi.importActual<typeof import("playwright")>("playwright");
    const launch = chromium.launch.bind(chromium);
    browserHarness.launch.mockImplementation(async (options) => {
      launchedHeadless.push(options?.headless === true);
      const browser = await launch({ ...options, timeout: 15_000 });
      browsers.push(browser);
      const newContext = browser.newContext.bind(browser);
      vi.spyOn(browser, "newContext").mockImplementation(async (contextOptions) => {
        const context = await newContext(contextOptions);
        contexts.push(context);
        // Every request is intercepted, including any unexpected request.
        await context.route("**/*", (route) => routeHandler(route));
        const close = context.close.bind(context);
        vi.spyOn(context, "close").mockImplementation(async (closeOptions) => {
          const page = context.pages()[0];
          if (page?.url() === `${BASE}/d2l/home`) {
            restoredMarkers.push(await page.evaluate(() => document.body.dataset.restored ?? null).catch(() => null));
          }
          await close(closeOptions);
        });
        return context;
      });
      return browser;
    });
    // Node's HTTP token exchange is also entirely local to this fixture.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected fixture HTTP request"); }));
  });

  afterEach(async () => {
    await Promise.all(browsers.map((browser) => browser.close().catch(() => {})));
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("rejects a login shell even when it exposes D2L.LP and an old session cookie", async () => {
    await store.save({ cookies: [cookie("d2lSessionVal", "stale-cookie", "brightspace.fixture.invalid")], origins: [] });
    const before = await fs.readFile(path.join(dir, "storage-state.encrypted.json"), "utf8");
    const observed: string[] = [];
    routeHandler = async (route) => {
      const url = new URL(route.request().url());
      observed.push(url.pathname);
      if (url.origin !== BASE) return route.abort("blockedbyclient");
      if (url.pathname === "/d2l/home") {
        expect(route.request().headers().cookie).toContain("d2lSessionVal=stale-cookie");
        return navigateFixture(route, `${BASE}/d2l/login?sessionExpired=1`);
      }
      if (url.pathname === "/d2l/login") {
        return route.fulfill({ contentType: "text/html", body: '<!doctype html><script>window.D2L={LP:{}};</script><input type="email" name="loginfmt">' });
      }
      return route.abort("blockedbyclient");
    };
    await expect(new BrowserAuth(config).authenticate()).rejects.toBeInstanceOf(UnsupportedAuthenticationError);
    expect(observed).toContain("/d2l/login");
    expect(fetch).not.toHaveBeenCalled();
    expect(launchedHeadless).toEqual([true]);
    expect(await fs.readFile(path.join(dir, "storage-state.encrypted.json"), "utf8")).toBe(before);
    expect(browsers.every((browser) => !browser.isConnected())).toBe(true);
  }, 20_000);

  it("silently restores SSO and local storage across two fresh headless browsers", async () => {
    await store.save({
      cookies: [cookie("d2lSessionVal", "stale-cookie", "brightspace.fixture.invalid"), cookie("d2lSecureSessionVal", "stale-secure", "brightspace.fixture.invalid"), cookie("fixture-entra-session", "saved-idp-session", "sso.fixture.invalid")],
      origins: [{ origin: BASE, localStorage: [{ name: "fixture-marker", value: "saved-local-storage" }] }],
    });
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await fs.utimes(path.join(dir, "storage-state.encrypted.json"), old, old);
    let idpVisits = 0;
    routeHandler = async (route) => {
      const url = new URL(route.request().url());
      const cookies = route.request().headers().cookie ?? "";
      if (url.origin === IDP && url.pathname === "/authorize") {
        idpVisits++;
        expect(cookies).toContain("fixture-entra-session=saved-idp-session");
        return navigateFixture(route, `${BASE}/saml-complete`);
      }
      if (url.origin !== BASE) return route.abort("blockedbyclient");
      if (url.pathname === "/d2l/home") {
        if (!cookies.includes("d2lSessionVal=fresh-cookie")) return navigateFixture(route, `${BASE}/d2l/login`);
        return route.fulfill({ contentType: "text/html", body: `<!doctype html><meta name="d2l-xsrf-token" content="fixture-xsrf"><body><script>
          window.D2L={LP:{}};
          document.body.dataset.restored=localStorage.getItem('fixture-marker');
          localStorage.setItem('fixture-visits', String(Number(localStorage.getItem('fixture-visits') || 0) + 1));
        </script></body>` });
      }
      if (url.pathname === "/d2l/login") return route.fulfill({ contentType: "text/html", body: '<!doctype html><script>window.D2L={LP:{}};</script><a href="/d2l/lp/auth/saml/initiate-login">Campus</a>' });
      if (url.pathname === "/d2l/lp/auth/saml/initiate-login") return navigateFixture(route, `${IDP}/authorize`);
      if (url.pathname === "/saml-complete") return route.fulfill({ contentType: "text/html", body: `<!doctype html><script>
        document.cookie='d2lSessionVal=fresh-cookie; Path=/; Secure; SameSite=None';
        document.cookie='d2lSecureSessionVal=fresh-secure; Path=/; Secure; SameSite=None';
        location.replace('/d2l/home');
      </script>` });
      return route.abort("blockedbyclient");
    };
    const mint = vi.mocked(fetch).mockImplementation(async (input, options) => {
      expect(String(input)).toBe(`${BASE}/d2l/lp/auth/oauth2/token`);
      expect(options?.method).toBe("POST");
      const headers = new Headers(options?.headers);
      expect(headers.get("cookie")).toContain("d2lSessionVal=fresh-cookie");
      expect(headers.get("cookie")).toContain("d2lSecureSessionVal=fresh-secure");
      expect(headers.get("x-csrf-token")).toBe("fixture-xsrf");
      return new Response(JSON.stringify({ access_token: "fixture-access-token" }), { headers: { "content-type": "application/json" } });
    });

    const first = await new BrowserAuth(config).authenticate();
    expect(first).toMatchObject({ accessToken: "fixture-access-token", csrfToken: "fixture-xsrf", tenantOrigin: BASE });
    expect(idpVisits).toBe(1);
    const second = await new BrowserAuth(config).authenticate();
    expect(second.cookieHeader).toContain("d2lSessionVal=fresh-cookie");
    expect(idpVisits).toBe(1);
    expect(launchedHeadless).toEqual([true, true]);
    expect(contexts[0]).not.toBe(contexts[1]);
    expect(restoredMarkers).toEqual(["saved-local-storage", "saved-local-storage"]);
    expect(mint).toHaveBeenCalledTimes(2);
    const saved = await store.load();
    expect(saved?.origins.find((origin) => origin.origin === BASE)?.localStorage).toContainEqual({ name: "fixture-visits", value: "2" });
    expect(saved?.cookies).toEqual(expect.arrayContaining([expect.objectContaining({ name: "d2lSessionVal", value: "fresh-cookie" })]));
    const contents = await fs.readFile(path.join(dir, "storage-state.encrypted.json"), "utf8");
    expect(contents).not.toContain("fresh-cookie");
    expect(contents).not.toContain("saved-local-storage");
    expect((await fs.readdir(dir)).sort()).toEqual(["auth-status.json", "storage-state.encrypted.json"]);
    expect(browsers.every((browser) => !browser.isConnected())).toBe(true);
  }, 30_000);
});
