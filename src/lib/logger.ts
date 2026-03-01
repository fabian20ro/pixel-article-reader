/**
 * Structured logger — lightweight console wrapper with levels and module tags.
 *
 * In production (no ?debug query param) only warn and error are output.
 * In development (?debug in URL) all levels are active.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const isVerbose =
  typeof location !== 'undefined' && location.search.includes('debug');

const minLevel: LogLevel = isVerbose ? 'debug' : 'warn';

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[minLevel];
}

function formatPrefix(module: string): string {
  return `[${module}]`;
}

export interface Logger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export function createLogger(module: string): Logger {
  const prefix = formatPrefix(module);
  return {
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
