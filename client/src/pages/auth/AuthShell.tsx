import { Link } from 'react-router-dom';
import { AppLogo } from '../../components/AppLogo';
import { useI18n } from '../../i18n';

interface AuthShellProps {
  title: string;
  children: React.ReactNode;
  showLoginLink?: boolean;
  registerLinkLabel?: string;
}

export function AuthShell({
  title,
  children,
  showLoginLink = true,
  registerLinkLabel,
}: AuthShellProps): JSX.Element {
  const { t } = useI18n();

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="brand-mark">
          <AppLogo label={t('app.name')} />
        </div>
        <h1>{title}</h1>
        {children}
        <nav className="auth-links" aria-label="Auth navigation">
          {showLoginLink ? <Link to="/auth/login">{t('auth.toLogin')}</Link> : null}
          <Link to="/auth/register">{registerLinkLabel ?? t('auth.toRegister')}</Link>
          <Link to="/auth/guest">{t('auth.toGuest')}</Link>
        </nav>
      </section>
    </main>
  );
}
