interface AppLogoProps {
  label?: string;
  size?: 'sm' | 'md';
}

export function AppLogo({ label = 'LanGram', size = 'md' }: AppLogoProps): JSX.Element {
  return (
    <span className={`app-logo app-logo-${size}`}>
      <img src="/logo/logo.svg" alt="" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
