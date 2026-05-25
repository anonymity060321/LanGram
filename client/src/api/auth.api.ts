import { apiRequest } from './http';
import type { UserProfile } from './users.api';
import type { DeviceIdentity } from '../utils/device';

export type EmailCodePurpose = 'REGISTER' | 'LOGIN';

export interface SendEmailCodeRequest {
  email: string;
  purpose: EmailCodePurpose;
}

export type AuthUser = Pick<
  UserProfile,
  'id' | 'email' | 'displayName' | 'statusMessage' | 'avatarUrl' | 'accountType'
>;

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  user: AuthUser;
}

export interface LoginRequest {
  email: string;
  password?: string;
  code?: string;
  device: DeviceIdentity;
}

export interface TextCaptchaResponse {
  captchaId: string;
  prompt: string;
  expiresInSeconds: number;
  captchaType?: 'ARITHMETIC' | 'TEXT';
  imageDataUrl?: string;
}

export interface PasswordLoginRequest {
  identifier: string;
  password: string;
  captchaId: string;
  captchaAnswer: string;
  device: DeviceIdentity;
}

export interface EmailCodeLoginRequest {
  email: string;
  code: string;
  device: DeviceIdentity;
}

export interface RegisterRequest {
  email: string;
  password: string;
  code: string;
  displayName?: string;
  device: DeviceIdentity;
}

export type TemporaryRegisterRequest = Omit<RegisterRequest, 'code'>;

export interface PasswordResetCodeRequest {
  email: string;
}

export interface PasswordResetRequest {
  email: string;
  code: string;
  newPassword: string;
}

export interface GuestLoginRequest {
  displayName?: string;
  device: DeviceIdentity;
}

export function sendEmailCode(request: SendEmailCodeRequest): Promise<{ sent: true }> {
  return apiRequest('/auth/email/code', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export function requestTextCaptcha(): Promise<TextCaptchaResponse> {
  return apiRequest('/auth/captcha/text', {
    method: 'POST',
  });
}

export function login(request: LoginRequest): Promise<AuthResult> {
  return apiRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export function loginWithPassword(request: PasswordLoginRequest): Promise<AuthResult> {
  return apiRequest('/auth/login/password', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export function loginWithEmailCode(request: EmailCodeLoginRequest): Promise<AuthResult> {
  return apiRequest('/auth/login/email-code', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export function requestPasswordResetCode(
  request: PasswordResetCodeRequest,
): Promise<{ sent: true }> {
  return apiRequest('/auth/password/reset/code', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export function resetPassword(request: PasswordResetRequest): Promise<{ reset: true }> {
  return apiRequest('/auth/password/reset', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export function register(request: RegisterRequest): Promise<AuthResult> {
  return apiRequest('/auth/register', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export function registerTemporary(request: TemporaryRegisterRequest): Promise<AuthResult> {
  return apiRequest('/auth/register/temporary', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export function guestLogin(request: GuestLoginRequest): Promise<AuthResult> {
  return apiRequest('/auth/guest', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export function logout(): Promise<{ loggedOut: true }> {
  return apiRequest('/auth/logout', { method: 'POST' });
}
