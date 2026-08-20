import { Alert, Result, Spin, Typography } from 'antd';
import { lazy, Suspense } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router';

import { DeviceActivationPage } from '@client/features/auth/DeviceActivationPage';
import { LoginPage } from '@client/features/auth/LoginPage';
import { PlatformAccessPage } from '@client/features/auth/PlatformAccessPage';

const SuperAdminPage = lazy(async () => {
  const module = await import('@client/features/platform/SuperAdminPage');
  return { default: module.SuperAdminPage };
});

function PlaceholderPage({ title }: { title: string }) {
  return (
    <main className="app-shell">
      <Typography.Title level={1}>{title}</Typography.Title>
      <Alert
        type="info"
        title="Đang chờ mẫu UI tham khảo"
        description="Contract và backend được triển khai trước; visual không được tự suy đoán."
      />
      <Link to="/">Quay lại</Link>
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="/owner/login" element={<Navigate to="/?tab=owner" replace />} />
      <Route path="/device-activation" element={<DeviceActivationPage />} />
      <Route path="/pos/login" element={<Navigate to="/?tab=employee" replace />} />
      <Route path="/platform/login" element={<PlatformAccessPage />} />
      <Route path="/owner/*" element={<PlaceholderPage title="Cổng Chủ cửa hàng" />} />
      <Route path="/pos/*" element={<PlaceholderPage title="Cổng Nhân viên" />} />
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
  );
}
