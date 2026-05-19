import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';

interface AuthShellProps {
  title: string;
  children: React.ReactNode;
}

export function AuthShell({ title, children }: AuthShellProps): JSX.Element {
  const { t } = useI18n();

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="brand-mark">{t('app.name')}</div>
        <h1>{title}</h1>
        {children}
        <nav className="auth-links" aria-label="Auth navigation">
          <Link to="/auth/login">{t('auth.toLogin')}</Link>
          <Link to="/auth/register">{t('auth.toRegister')}</Link>
          <Link to="/auth/guest">{t('auth.toGuest')}</Link>
        </nav>
      </section>
    </main>
  );
}
