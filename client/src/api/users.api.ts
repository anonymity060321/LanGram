import { apiBlobRequest, apiRequest } from './http';

export interface UserProfile {
  id: string;
  email: string | null;
  displayName: string;
  statusMessage: string | null;
  avatarUrl: string | null;
  accountType: string;
  isOnline?: boolean;
  lastSeenAt?: string | null;
  status: string;
  createdAt: string;
}

export interface UpdateProfileRequest {
  displayName?: string;
  statusMessage?: string;
}

export function getCurrentUserProfile(): Promise<UserProfile> {
  return apiRequest('/users/me');
}

export function updateCurrentUserProfile(request: UpdateProfileRequest): Promise<UserProfile> {
  return apiRequest('/users/me/profile', {
    method: 'PATCH',
    body: JSON.stringify(request),
  });
}

export function uploadCurrentUserAvatar(file: File): Promise<UserProfile> {
  const formData = new FormData();
  formData.append('avatar', file);

  return apiRequest('/users/me/avatar', {
    method: 'POST',
    body: formData,
  });
}

export function downloadUserAvatar(userId: string): Promise<Blob> {
  return apiBlobRequest(`/users/${encodeURIComponent(userId)}/avatar`);
}
