import { Result, Spin } from 'antd';
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useSearchParams } from 'react-router';

import { DeviceActivationPage } from '@client/features/auth/DeviceActivationPage';
import { LoginPage } from '@client/features/auth/LoginPage';
import { PlatformAccessPage } from '@client/features/auth/PlatformAccessPage';
import { PwaUpdatePrompt } from '@client/features/pwa/PwaUpdatePrompt';

const OwnerPortalPage = lazy(async () => {
  const module = await import('@client/features/owner/OwnerPortalPage');
  return { default: module.OwnerPortalPage };
});

const StaffPosPortalPage = lazy(async () => {
  const module = await import('@client/features/pos/StaffPosPortalPage');
  return { default: module.StaffPosPortalPage };
});

const GuestOrderPage = lazy(async () => {
  const module = await import('@client/features/guest/GuestOrderPage');
  return { default: module.GuestOrderPage };
});

const SuperAdminPage = lazy(async () => {
  const module = await import('@client/features/platform/SuperAdminPage');
  return { default: module.SuperAdminPage };
});

function LogoutCallbackRoute() {
  const [searchParams] = useSearchParams();
  const target =
    searchParams.get('target') || searchParams.get('returnTo') || '/?tab=owner&loggedOut=1';
  return <Navigate to={target} replace />;
}

export function App() {
  return (
    <>
      <PwaUpdatePrompt />
      <Suspense fallback={<Spin fullscreen description="Đang tải Pro POS" />}>
        <Routes>
          <Route path="/" element={<LoginPage />} />
          <Route path="/logout-callback" element={<LogoutCallbackRoute />} />
          <Route path="/logout" element={<Navigate to="/?tab=owner&loggedOut=1" replace />} />
          <Route path="/owner/login" element={<Navigate to="/?tab=owner" replace />} />
          <Route path="/device-activation" element={<DeviceActivationPage />} />
          <Route path="/pos/login" element={<Navigate to="/?tab=employee" replace />} />
          <Route path="/platform/login" element={<PlatformAccessPage />} />
          <Route path="/owner/*" element={<OwnerPortalPage />} />
          <Route path="/pos/*" element={<StaffPosPortalPage />} />
          <Route path="/q/:token" element={<GuestOrderPage />} />
          <Route path="/platform/*" element={<SuperAdminPage />} />
          <Route path="*" element={<Result status="404" title="Không tìm thấy trang" />} />
        </Routes>
      </Suspense>
    </>
  );
}
