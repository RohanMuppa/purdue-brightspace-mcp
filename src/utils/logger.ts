import type { LogLevel } from "../types/index.js";

let currentLevel: LogLevel = "INFO";

const LEVEL_ORDER: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function log(
  level: LogLevel,
  message: string,
  ...args: unknown[]
): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return;
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [${level}] ${message}`, ...args);
}

// Override console.log in production to prevent accidental stdout writes
export function enableStdoutGuard(): void {
  console.log = (...args: unknown[]) => {
    console.error(
      "[WARN] console.log intercepted (would corrupt stdio):",
      ...args,
    );
  };
}
