import { apiRequest } from './http';
import type { UserProfile } from './users.api';

export type FriendUser = Pick<
  UserProfile,
  'id' | 'email' | 'displayName' | 'statusMessage' | 'avatarUrl' | 'accountType'
>;

export type FriendRequestStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';

export interface FriendRequest {
  id: string;
  status: FriendRequestStatus;
  createdAt: string;
  respondedAt: string | null;
  requester: FriendUser;
  addressee: FriendUser;
}

export interface FriendItem {
  id: string;
  friend: FriendUser;
  createdAt: string;
}

export function createPairingCode(): Promise<{ pairingCode: string; expiresAt: string }> {
  return apiRequest('/friends/pairing-code', { method: 'POST' });
}

export function createFriendRequest(pairingCode: string): Promise<FriendRequest> {
  return apiRequest('/friends/requests', {
    method: 'POST',
    body: JSON.stringify({ pairingCode }),
  });
}

export function listFriendRequests(): Promise<{
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
}> {
  return apiRequest('/friends/requests');
}

export function acceptFriendRequest(requestId: string): Promise<FriendRequest> {
  return apiRequest(`/friends/requests/${requestId}/accept`, { method: 'POST' });
}

export function rejectFriendRequest(requestId: string): Promise<FriendRequest> {
  return apiRequest(`/friends/requests/${requestId}/reject`, { method: 'POST' });
}

export function listFriends(): Promise<{ friends: FriendItem[] }> {
  return apiRequest('/friends');
}
