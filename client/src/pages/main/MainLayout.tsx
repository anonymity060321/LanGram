import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useAuthStore } from '../../stores/auth.store';

export function MainLayout(): JSX.Element {
  const { t } = useI18n();
  const user = useAuthStore((state) => state.user);

  return (
    <main className="main-layout">
      <aside className="conversation-panel">
        <div className="sidebar-header">
          <strong>{t('app.name')}</strong>
          <div className="sidebar-actions">
            <Link to="/friends">{t('main.friends')}</Link>
            <Link to="/settings">{t('main.settings')}</Link>
          </div>
        </div>
        <section className="sidebar-section">
          <h2>{t('main.sidebarChats')}</h2>
          <p>{t('main.emptyBody')}</p>
        </section>
        <section className="sidebar-section">
          <h2>{t('main.sidebarFriends')}</h2>
          <Link to="/friends">{t('friends.openFriends')}</Link>
        </section>
      </aside>
      <section className="chat-panel">
        <header className="chat-header">
          <div>
            <strong>{user?.displayName ?? t('app.name')}</strong>
            <span>{user?.accountType ?? 'MVP'}</span>
          </div>
        </header>
        <div className="empty-chat-state">
          <h1>{t('main.emptyTitle')}</h1>
          <p>{t('main.emptyBody')}</p>
        </div>
      </section>
      <aside className="profile-panel">
        <div className="profile-avatar">{user?.displayName?.slice(0, 1).toUpperCase() ?? 'L'}</div>
        <strong>{user?.displayName ?? t('app.name')}</strong>
        <span>{user?.email ?? user?.accountType ?? 'MVP'}</span>
      </aside>
    </main>
  );
}
