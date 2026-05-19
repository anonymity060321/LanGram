import { apiRequest } from './http';
import type { DeviceIdentity } from '../utils/device';

export type EmailCodePurpose = 'REGISTER' | 'LOGIN';

export interface SendEmailCodeRequest {
  email: string;
  purpose: EmailCodePurpose;
}

export interface AuthUser {
  id: string;
  email: string | null;
  displayName: string;
  accountType: string;
}

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

export interface RegisterRequest {
  email: string;
  password: string;
  code: string;
  displayName?: string;
  device: DeviceIdentity;
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

export function login(request: LoginRequest): Promise<AuthResult> {
  return apiRequest('/auth/login', {
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

export function guestLogin(request: GuestLoginRequest): Promise<AuthResult> {
  return apiRequest('/auth/guest', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export function logout(): Promise<{ loggedOut: true }> {
  return apiRequest('/auth/logout', { method: 'POST' });
}
