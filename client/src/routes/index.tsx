import { Navigate, Route, Routes } from 'react-router-dom';
import { GuestLoginPage } from '../pages/auth/GuestLoginPage';
import { LoginPage } from '../pages/auth/LoginPage';
import { RegisterPage } from '../pages/auth/RegisterPage';
import { FriendsPage } from '../pages/main/FriendsPage';
import { ConversationSearchWindow } from '../pages/main/ConversationSearchWindow';
import { ImagePreviewWindow } from '../pages/main/ImagePreviewWindow';
import { MainLayout } from '../pages/main/MainLayout';
import { SettingsPage } from '../pages/main/SettingsPage';
import { useAuthStore } from '../stores/auth.store';

export function AppRoutes(): JSX.Element {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  return (
    <Routes>
      <Route path="/auth/login" element={<LoginPage />} />
      <Route path="/auth/register" element={<RegisterPage />} />
      <Route path="/auth/guest" element={<GuestLoginPage />} />
      <Route path="/preview/image" element={<ImagePreviewWindow />} />
      <Route path="/conversation-search" element={<ConversationSearchWindow />} />
      <Route
        path="/"
        element={isAuthenticated ? <MainLayout /> : <Navigate to="/auth/login" replace />}
      />
      <Route
        path="/settings"
        element={isAuthenticated ? <SettingsPage /> : <Navigate to="/auth/login" replace />}
      />
      <Route
        path="/friends"
        element={isAuthenticated ? <FriendsPage /> : <Navigate to="/auth/login" replace />}
      />
      <Route path="*" element={<Navigate to={isAuthenticated ? '/' : '/auth/login'} replace />} />
    </Routes>
  );
}
