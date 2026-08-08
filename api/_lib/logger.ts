/**
 * Структурированное логирование для Vercel Serverless Functions
 * 
 * Формат: JSON-строки для удобного парсинга в логах Vercel
 * Уровни: debug, info, warn, error
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, any>;
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
}

const isDevelopment = process.env.NODE_ENV === 'development' || process.env.VERCEL_ENV === 'development';

function formatLog(level: LogLevel, message: string, context?: Record<string, any>, error?: Error): string {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };

  if (context && Object.keys(context).length > 0) {
    entry.context = context;
  }

  if (error) {
    entry.error = {
      message: error.message,
      stack: isDevelopment ? error.stack : undefined,
      code: (error as any).code,
    };
  }

  return JSON.stringify(entry);
}

export const logger = {
  debug(message: string, context?: Record<string, any>) {
    if (isDevelopment) {
      console.log(formatLog('debug', message, context));
    }
  },

  info(message: string, context?: Record<string, any>) {
    console.log(formatLog('info', message, context));
  },

  warn(message: string, context?: Record<string, any>) {
    console.warn(formatLog('warn', message, context));
  },

  error(message: string, error?: Error, context?: Record<string, any>) {
    console.error(formatLog('error', message, context, error));
  },
};

/**
 * Хелпер для логирования HTTP-запросов
 */
export function logRequest(req: any, action: string, context?: Record<string, any>) {
  logger.info(`API: ${action}`, {
    method: req.method,
    action,
    ip: req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown',
    userAgent: req.headers['user-agent'],
    ...context,
  });
}

/**
 * Хелпер для логирования ошибок с дополнительным контекстом
 */
export function logError(action: string, error: Error, context?: Record<string, any>) {
  logger.error(`Error in ${action}`, error, context);
}
