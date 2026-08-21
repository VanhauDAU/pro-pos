import { Result, Spin } from 'antd';
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';

import { DeviceActivationPage } from '@client/features/auth/DeviceActivationPage';
import { LoginPage } from '@client/features/auth/LoginPage';
import { PlatformAccessPage } from '@client/features/auth/PlatformAccessPage';
import { PwaUpdatePrompt } from '@client/features/pwa/PwaUpdatePrompt';
import { OwnerPortalPage } from '@client/features/owner/OwnerPortalPage';
import { StaffPosPortalPage } from '@client/features/pos/StaffPosPortalPage';
import { GuestOrderPage } from '@client/features/guest/GuestOrderPage';

const SuperAdminPage = lazy(async () => {
  const module = await import('@client/features/platform/SuperAdminPage');
  return { default: module.SuperAdminPage };
});

export function App() {
  return (
    <>
      <PwaUpdatePrompt />
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/owner/login" element={<Navigate to="/?tab=owner" replace />} />
        <Route path="/device-activation" element={<DeviceActivationPage />} />
        <Route path="/pos/login" element={<Navigate to="/?tab=employee" replace />} />
        <Route path="/platform/login" element={<PlatformAccessPage />} />
        <Route path="/owner/*" element={<OwnerPortalPage />} />
        <Route path="/pos/*" element={<StaffPosPortalPage />} />
        <Route path="/q/:token" element={<GuestOrderPage />} />
        <Route
          path="/platform/*"
          element={
            <Suspense fallback={<Spin fullscreen description="Đang mở cổng SUPER_ADMIN" />}>
              <SuperAdminPage />
            </Suspense>
          }
        />
        <Route path="*" element={<Result status="404" title="Không tìm thấy trang" />} />
      </Routes>
    </>
  );
}
