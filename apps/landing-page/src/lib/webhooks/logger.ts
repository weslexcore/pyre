export interface WebhookLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, error?: unknown, data?: Record<string, unknown>): void;
}

export function createWebhookLogger(prefix: string): WebhookLogger {
  const tag = `[Webhook: ${prefix}]`;

  return {
    info(message, data) {
      if (data) {
        console.log(tag, message, data);
      } else {
        console.log(tag, message);
      }
    },

    warn(message, data) {
      if (data) {
        console.warn(tag, message, data);
      } else {
        console.warn(tag, message);
      }
    },

    error(message, error, data) {
      if (error && data) {
        console.error(tag, message, error, data);
      } else if (error) {
        console.error(tag, message, error);
      } else {
        console.error(tag, message);
      }
    },
  };
}
