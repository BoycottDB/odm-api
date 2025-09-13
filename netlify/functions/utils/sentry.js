import * as Sentry from "@sentry/serverless";

export const sentryHandler = Sentry.AWSLambda.wrapHandler;

export const initSentry = () => {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'production',
    beforeSend(event) {
      // Supprimer toute donnée potentiellement personnelle
      if (event.user) {
        delete event.user;
      }
      if (event.request?.cookies) {
        delete event.request.cookies;
      }
      return event;
    }
  });
};