import * as Sentry from "@sentry/node";
import { env } from "../config/env.js";
import { redactSensitiveText, sanitizeLogValue } from "./logger.js";

let sentryEnabled = false;

export function initializeSentry(): boolean {
  if (!env.sentryDsn) {
    return false;
  }

  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.sentryEnvironment,
    release: env.sentryRelease || undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.message) {
        event.message = redactSensitiveText(event.message);
      }

      if (event.request) {
        event.request = {
          ...event.request,
          url: event.request.url ? redactSensitiveText(event.request.url) : undefined,
          headers: undefined,
          cookies: undefined,
          data: undefined,
          query_string: undefined,
        };
      }

      if (event.exception?.values) {
        event.exception.values = event.exception.values.map((exception) => ({
          ...exception,
          value: exception.value ? redactSensitiveText(exception.value) : exception.value,
          stacktrace: exception.stacktrace
            ? {
                ...exception.stacktrace,
                frames: exception.stacktrace.frames?.map((frame) => ({
                  ...frame,
                  filename: frame.filename
                    ? redactSensitiveText(frame.filename)
                    : frame.filename,
                })),
              }
            : exception.stacktrace,
        }));
      }

      if (event.extra) {
        event.extra = sanitizeLogValue(event.extra) as Record<string, unknown>;
      }

      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.message) {
        breadcrumb.message = redactSensitiveText(breadcrumb.message);
      }

      if (breadcrumb.data) {
        breadcrumb.data = sanitizeLogValue(breadcrumb.data) as Record<string, unknown>;
      }

      return breadcrumb;
    },
  });
  sentryEnabled = true;
  return true;
}

export function captureException(
  error: unknown,
  context: Record<string, unknown> = {}
): void {
  if (!sentryEnabled) {
    return;
  }

  Sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(context)) {
      scope.setExtra(key, sanitizeLogValue(value));
    }

    Sentry.captureException(error);
  });
}

export function captureMessage(
  message: string,
  level: "error" | "warning" | "info",
  context: Record<string, unknown> = {}
): void {
  if (!sentryEnabled) {
    return;
  }

  Sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(context)) {
      scope.setExtra(key, sanitizeLogValue(value));
    }

    Sentry.captureMessage(redactSensitiveText(message), { level });
  });
}

export async function flushSentry(timeoutMs = 2_000): Promise<void> {
  if (sentryEnabled) {
    await Sentry.flush(timeoutMs);
  }
}