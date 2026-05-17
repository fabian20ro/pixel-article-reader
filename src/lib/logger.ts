/**
 * Structured logger — lightweight console wrapper with levels and module tags.
 *
 * In production (no ?debug query param) only warn and error are output.
 * In development (?debug in URL) all levels are active.
 */

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

const isVerbose =
  typeof location !== 'undefined' && (location.search.includes('debug') || location.search.includes('trace'));

const minLevel: LogLevel = isVerbose ? 'trace' : 'warn';

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[minLevel];
}

function formatPrefix(module: string): string {
  return `[${module}]`;
}

export interface Logger {
  trace(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export function createLogger(module: string): Logger {
  const prefix = formatPrefix(module);
  return {
    trace(msg, ...args) {
      if (shouldLog('trace')) console.debug(prefix, msg, ...args);
    },
    debug(msg, ...args) {
      if (shouldLog('debug')) console.debug(prefix, msg, ...args);
    },
    info(msg, ...args) {
      if (shouldLog('info')) console.info(prefix, msg, ...args);
    },
    warn(msg, ...args) {
      if (shouldLog('warn')) console.warn(prefix, msg, ...args);
    },
    error(msg, ...args) {
      if (shouldLog('error')) console.error(prefix, msg, ...args);
    },
  };
}
