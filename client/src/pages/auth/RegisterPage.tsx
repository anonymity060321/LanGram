import { FormEvent, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { register, registerTemporary, sendEmailCode } from '../../api/auth.api';
import { useI18n } from '../../i18n';
import { useAuthStore } from '../../stores/auth.store';
import { getDeviceIdentity } from '../../utils/device';
import { reportAuthNetworkError } from '../../utils/serverHealth';
import { AuthShell } from './AuthShell';

const EMAIL_MAX_LENGTH = 254;
const PASSWORD_MAX_LENGTH = 128;
const EMAIL_CODE_MAX_LENGTH = 6;
const DISPLAY_NAME_MAX_LENGTH = 32;

export function RegisterPage(): JSX.Element {
  const { t } = useI18n();
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [isTemporaryRegistering, setIsTemporaryRegistering] = useState(false);
  const submitInFlightRef = useRef(false);
  const sendCodeInFlightRef = useRef(false);
  const temporaryRegisterInFlightRef = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmedEmail = email.trim();
    const trimmedDisplayName = displayName.trim();
    const trimmedCode = code.trim();
    if (!trimmedEmail || !password || !trimmedCode || submitInFlightRef.current) {
      return;
    }

    submitInFlightRef.current = true;
    setError(null);
    setIsSubmitting(true);

    try {
      const device = await getDeviceIdentity();
      const result = await register({
        email: trimmedEmail,
        password,
        code: trimmedCode,
        displayName: trimmedDisplayName || undefined,
        device,
      });
      setSession(result);
      navigate('/', { replace: true });
    } catch (error) {
      if (reportAuthNetworkError(error)) {
        return;
      }
      setError(t('auth.submitFailed'));
    } finally {
      submitInFlightRef.current = false;
      setIsSubmitting(false);
    }
  }

  async function handleSendCode(): Promise<void> {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || sendCodeInFlightRef.current) {
      return;
    }

    sendCodeInFlightRef.current = true;
    setError(null);
    setIsSendingCode(true);

    try {
      await sendEmailCode({ email: trimmedEmail, purpose: 'REGISTER' });
    } catch (error) {
      if (reportAuthNetworkError(error)) {
        return;
      }
      setError(t('auth.submitFailed'));
    } finally {
      sendCodeInFlightRef.current = false;
      setIsSendingCode(false);
    }
  }

  async function handleTemporaryRegister(): Promise<void> {
    const trimmedEmail = email.trim();
    const trimmedDisplayName = displayName.trim();
    if (
      !trimmedEmail ||
      !password ||
      temporaryRegisterInFlightRef.current ||
      !window.confirm(t('auth.temporaryRegisterConfirm'))
    ) {
      return;
    }

    temporaryRegisterInFlightRef.current = true;
    setError(null);
    setIsTemporaryRegistering(true);

    try {
      const device = await getDeviceIdentity();
      const result = await registerTemporary({
        email: trimmedEmail,
        password,
        displayName: trimmedDisplayName || undefined,
        device,
      });
      setSession(result);
      navigate('/', { replace: true });
    } catch (error) {
      if (reportAuthNetworkError(error)) {
        return;
      }
      setError(t('auth.submitFailed'));
    } finally {
      temporaryRegisterInFlightRef.current = false;
      setIsTemporaryRegistering(false);
    }
  }

  const trimmedEmail = email.trim();
  const trimmedCode = code.trim();

  return (
    <AuthShell
      title={t('auth.registerTitle')}
      showRegisterLink={false}
      loginLinkLabel={t('auth.toLoginPrompt')}
    >
      <form className="form-stack" onSubmit={(event) => void handleSubmit(event)}>
        <label>
          <span>{t('auth.email')}</span>
          <input
            type="email"
            value={email}
            maxLength={EMAIL_MAX_LENGTH}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          <span>{t('auth.displayName')}</span>
          <input
            value={displayName}
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        <label>
          <span>{t('auth.password')}</span>
          <input
            type="password"
            value={password}
            maxLength={PASSWORD_MAX_LENGTH}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label>
          <span>{t('auth.code')}</span>
          <div className="inline-control">
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.trim().slice(0, EMAIL_CODE_MAX_LENGTH))}
              maxLength={EMAIL_CODE_MAX_LENGTH}
            />
            <button
              type="button"
              className="secondary-button"
              disabled={isSendingCode || !trimmedEmail}
              onClick={() => void handleSendCode()}
            >
              {isSendingCode ? t('auth.sending') : t('auth.sendCode')}
            </button>
          </div>
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <button
          type="submit"
          className="primary-button"
          disabled={isSubmitting || !trimmedEmail || !password || !trimmedCode}
        >
          {isSubmitting ? t('auth.signingUp') : t('auth.register')}
        </button>
        <div className="temporary-register-box">
          <p className="form-hint">{t('auth.temporaryRegisterHint')}</p>
          <button
            type="button"
            className="secondary-button"
            disabled={isTemporaryRegistering || !trimmedEmail || !password}
            onClick={() => void handleTemporaryRegister()}
          >
            {isTemporaryRegistering ? t('auth.signingUp') : t('auth.temporaryRegister')}
          </button>
        </div>
      </form>
    </AuthShell>
  );
}
