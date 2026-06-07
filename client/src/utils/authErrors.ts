import { ApiClientError } from '../api/http';
import { isNetworkRequestError, reportAuthNetworkError } from './serverHealth';

type AuthErrorMessageKey =
  | 'auth.networkUnavailable'
  | 'auth.captchaInvalidOrExpired'
  | 'auth.emailCodeInvalidOrExpired'
  | 'auth.captchaRefreshFailed'
  | 'auth.submitFailed'
  | 'auth.passwordLoginFailed'
  | 'auth.emailLoginFailed'
  | 'auth.passwordResetFailed';

type TranslateAuthError = (key: AuthErrorMessageKey) => string;

export function isNetworkError(error: unknown): boolean {
  return isNetworkRequestError(error);
}

export function getNetworkErrorMessage(
  error: unknown,
  t: TranslateAuthError,
): string | null {
  if (!isNetworkError(error)) {
    return null;
  }

  reportAuthNetworkError(error);
  return t('auth.networkUnavailable');
}

export function getAuthErrorMessage(
  error: unknown,
  t: TranslateAuthError,
  fallback: AuthErrorMessageKey,
): string {
  const networkMessage = getNetworkErrorMessage(error, t);
  if (networkMessage) {
    return networkMessage;
  }

  if (isEmailCodeError(error)) {
    return t('auth.emailCodeInvalidOrExpired');
  }

  if (isCaptchaError(error)) {
    return t('auth.captchaInvalidOrExpired');
  }

  return t(fallback);
}

export function getCaptchaErrorMessage(error: unknown, t: TranslateAuthError): string {
  const networkMessage = getNetworkErrorMessage(error, t);
  if (networkMessage) {
    return networkMessage;
  }

  if (isCaptchaError(error)) {
    return t('auth.captchaInvalidOrExpired');
  }

  return t('auth.captchaRefreshFailed');
}

function isCaptchaError(error: unknown): boolean {
  if (!(error instanceof ApiClientError)) {
    return false;
  }

  return error.status === 400 && normalizeMessage(error.message).includes('captcha');
}

function isEmailCodeError(error: unknown): boolean {
  if (!(error instanceof ApiClientError)) {
    return false;
  }

  const message = normalizeMessage(error.message);
  return (
    error.status === 400 &&
    (message.includes('verification code') || message.includes('email, code, or new password'))
  );
}

function normalizeMessage(message: string): string {
  return message.trim().toLowerCase();
}
