import { useEffect, useState } from 'react';
import { downloadUserAvatar } from '../api/users.api';

interface UserAvatarProps {
  userId?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
}

type AvatarState =
  | { status: 'idle'; objectUrl: null }
  | { status: 'loaded'; objectUrl: string }
  | { status: 'failed'; objectUrl: null };

export function UserAvatar({
  userId,
  displayName,
  avatarUrl,
  size = 'md',
}: UserAvatarProps): JSX.Element {
  const [avatarState, setAvatarState] = useState<AvatarState>({ status: 'idle', objectUrl: null });

  useEffect(() => {
    if (!userId || !avatarUrl) {
      setAvatarState({ status: 'idle', objectUrl: null });
      return;
    }

    let isCancelled = false;
    let objectUrl: string | null = null;

    void downloadUserAvatar(userId)
      .then((blob) => {
        if (!blob.type.toLowerCase().startsWith('image/')) {
          throw new Error('Avatar is not an image');
        }

        objectUrl = URL.createObjectURL(blob);
        if (isCancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }

        setAvatarState({ status: 'loaded', objectUrl });
      })
      .catch(() => {
        if (!isCancelled) {
          setAvatarState({ status: 'failed', objectUrl: null });
        }
      });

    return () => {
      isCancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [avatarUrl, userId]);

  const label = getInitial(displayName);

  if (avatarState.status === 'loaded') {
    return (
      <span className={`user-avatar user-avatar-${size}`}>
        <img src={avatarState.objectUrl} alt="" aria-hidden="true" />
      </span>
    );
  }

  return (
    <span className={`user-avatar user-avatar-${size}`}>
      <span className="user-avatar-initial">{label}</span>
    </span>
  );
}

function getInitial(displayName?: string | null): string {
  const value = displayName?.trim();
  return value ? value.slice(0, 1).toUpperCase() : 'L';
}
