import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router';

import { Toaster } from 'sonner';

import { PosAppSplash } from '@client/features/pos/PosAppSplash';
import { PwaUpdatePrompt } from '@client/features/pwa/PwaUpdatePrompt';
import { appBootstrapQueryOptions } from '@client/features/bootstrap/app-bootstrap';

import type { AppBootstrapSurface } from '@contracts/app-bootstrap';

const OwnerPortalPage = lazy(async () => {
  const module = await import('@client/features/owner/OwnerPortalPage');
  return { default: module.OwnerPortalPage };
});

const LoginPage = lazy(async () => {
  const module = await import('@client/features/auth/LoginPage');
  return { default: module.LoginPage };
});

const DeviceActivationPage = lazy(async () => {
  const module = await import('@client/features/auth/DeviceActivationPage');
  return { default: module.DeviceActivationPage };
});

const PlatformAccessPage = lazy(async () => {
  const module = await import('@client/features/auth/PlatformAccessPage');
  return { default: module.PlatformAccessPage };
});

const StaffPosPortalPage = lazy(async () => {
  const module = await import('@client/features/pos/StaffPosPortalPage');
  return { default: module.StaffPosPortalPage };
});

const StaffPosAreasPage = lazy(async () => {
  const module = await import('@client/features/pos/StaffPosAreasPage');
  return { default: module.StaffPosAreasPage };
});

function posBootstrapSurface(pathname: string): AppBootstrapSurface {
  return pathname === '/pos' || pathname === '/pos/' || pathname === '/pos/areas'
    ? 'areas'
    : 'shell';
}

function StaffPosRoute() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const surface = posBootstrapSurface(location.pathname);
  const hasWarmAreasBootstrap = Boolean(queryClient.getQueryData(['app-bootstrap', 'areas']));
  const querySurface = surface === 'shell' && hasWarmAreasBootstrap ? 'areas' : surface;
  const bootstrap = useQuery(appBootstrapQueryOptions(queryClient, querySurface));
  const startupProps = {
    bootstrap: bootstrap.data,
    bootstrapError: bootstrap.error,
    bootstrapLoading: bootstrap.isLoading,
    retryBootstrap: () => void bootstrap.refetch(),
  };
  return (
    <Suspense fallback={<PosAppSplash />}>
      {surface === 'areas' ? (
        <StaffPosAreasPage {...startupProps} />
      ) : (
        <StaffPosPortalPage {...startupProps} />
      )}
    </Suspense>
  );
}

const GuestOrderPage = lazy(async () => {
  const module = await import('@client/features/guest/GuestOrderPage');
  return { default: module.GuestOrderPage };
});

const SuperAdminPage = lazy(async () => {
  const module = await import('@client/features/platform/SuperAdminPage');
  return { default: module.SuperAdminPage };
});

const NotFoundPage = lazy(async () => {
  const module = await import('@client/features/auth/LoginPage');
  return { default: module.NotFoundPage };
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
      <Toaster position="top-right" richColors closeButton duration={3500} />
      <Suspense fallback={<PosAppSplash />}>
        <Routes>
          <Route path="/" element={<LoginPage />} />
          <Route path="/logout-callback" element={<LogoutCallbackRoute />} />
          <Route path="/logout" element={<Navigate to="/?tab=owner&loggedOut=1" replace />} />
          <Route path="/owner/login" element={<Navigate to="/?tab=owner" replace />} />
          <Route path="/device-activation" element={<DeviceActivationPage />} />
          <Route path="/pos/login" element={<Navigate to="/?tab=employee" replace />} />
          <Route path="/platform/login" element={<PlatformAccessPage />} />
          <Route path="/owner/*" element={<OwnerPortalPage />} />
          <Route path="/pos/*" element={<StaffPosRoute />} />
          <Route path="/q/:token" element={<GuestOrderPage />} />
          <Route path="/platform/*" element={<SuperAdminPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </>
  );
}
