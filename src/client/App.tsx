import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router';

import { Toaster } from 'sonner';
import { AnimatePresence, motion } from 'framer-motion';

import { PosAppSplash } from '@client/features/pos/PosAppSplash';
import { PwaUpdatePrompt } from '@client/features/pwa/PwaUpdatePrompt';
import { appBootstrapQueryOptions } from '@client/features/bootstrap/app-bootstrap';
import { ApiError } from '@client/lib/api';
import { registerPushNotificationSoundListener } from '@client/lib/sound';

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

type StaffPosPortalModule = typeof import('@client/features/pos/StaffPosPortalPage');
type StaffPosAreasModule = typeof import('@client/features/pos/StaffPosAreasPage');

let staffPosPortalModule: StaffPosPortalModule | null = null;
let staffPosAreasModule: StaffPosAreasModule | null = null;
let staffPosPortalPagePromise: Promise<StaffPosPortalModule> | null = null;
let staffPosAreasPagePromise: Promise<StaffPosAreasModule> | null = null;

function loadStaffPosPortalPage() {
  staffPosPortalPagePromise ??= import('@client/features/pos/StaffPosPortalPage').then((module) => {
    staffPosPortalModule = module;
    return module;
  });
  return staffPosPortalPagePromise;
}

function loadStaffPosAreasPage() {
  staffPosAreasPagePromise ??= import('@client/features/pos/StaffPosAreasPage').then((module) => {
    staffPosAreasModule = module;
    return module;
  });
  return staffPosAreasPagePromise;
}

function preloadStaffPosSurface(surface: AppBootstrapSurface) {
  return surface === 'areas' ? loadStaffPosAreasPage() : loadStaffPosPortalPage();
}

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
  const [, setSurfaceModuleVersion] = useState(0);
  const [surfaceLoadError, setSurfaceLoadError] = useState<Error | null>(null);
  const surfaceModulePromise = preloadStaffPosSurface(surface);
  const hasTableTransition = Boolean(
    (location.state as { transitionTableId?: string } | null)?.transitionTableId,
  );
  const SurfacePage =
    surface === 'areas'
      ? staffPosAreasModule?.StaffPosAreasPage
      : staffPosPortalModule?.StaffPosPortalPage;

  useEffect(() => {
    let cancelled = false;
    setSurfaceLoadError(null);

    void surfaceModulePromise
      .then(() => {
        if (!cancelled) setSurfaceModuleVersion((version) => version + 1);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSurfaceLoadError(
            error instanceof Error ? error : new Error('Không thể tải giao diện POS.'),
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [surfaceModulePromise]);

  if (!bootstrap.data && bootstrap.error) {
    if (
      (bootstrap.error instanceof ApiError && bootstrap.error.status === 401) ||
      bootstrap.error.message.includes('Phiên đăng nhập không hợp lệ') ||
      bootstrap.error.message.includes('Vui lòng đăng nhập')
    ) {
      return <Navigate to="/?tab=employee&authError=SESSION_EXPIRED" replace />;
    }
    return (
      <div className="pos-app-splash" role="alert">
        <div className="pos-app-splash__content">
          <strong>Chưa thể tải dữ liệu POS</strong>
          <div className="pos-app-splash__message">
            {bootstrap.error instanceof Error
              ? bootstrap.error.message
              : 'Không thể kết nối máy chủ.'}
          </div>
          <button
            type="button"
            onClick={() => void bootstrap.refetch()}
            style={{
              marginTop: 16,
              padding: '8px 20px',
              borderRadius: 8,
              background: '#0975f7',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Thử lại
          </button>
        </div>
      </div>
    );
  }

  if (surfaceLoadError) {
    return (
      <div className="pos-app-splash" role="alert">
        <div className="pos-app-splash__content">
          <strong>Chưa thể tải giao diện POS</strong>
          <div className="pos-app-splash__message">{surfaceLoadError.message}</div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: 16,
              padding: '8px 20px',
              borderRadius: 8,
              background: '#0975f7',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Tải lại ứng dụng
          </button>
        </div>
      </div>
    );
  }

  if (bootstrap.isLoading || !bootstrap.data || !SurfacePage) {
    return <PosAppSplash message="Đang nạp dữ liệu POS..." />;
  }

  if (bootstrap.data.auth.actor?.kind !== 'EMPLOYEE' || !bootstrap.data.pos) {
    return <Navigate to="/?tab=employee&authError=SESSION_EXPIRED" replace />;
  }

  const startupProps = {
    bootstrap: bootstrap.data,
    bootstrapError: null,
    bootstrapLoading: false,
    retryBootstrap: () => void bootstrap.refetch(),
  };

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={surface === 'areas' ? 'areas-screen' : 'portal-screen'}
        className="staff-pos-surface-wrapper"
        initial={{ opacity: surface === 'shell' && hasTableTransition ? 1 : 0 }}
        animate={{
          opacity: 1,
          transition: { duration: surface === 'shell' && hasTableTransition ? 0 : 0.14 },
        }}
        exit={{ opacity: 0, transition: { duration: 0.12 } }}
      >
        <SurfacePage {...startupProps} />
      </motion.div>
    </AnimatePresence>
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
  useEffect(() => {
    return registerPushNotificationSoundListener();
  }, []);

  return (
    <>
      <PwaUpdatePrompt />
      <Toaster
        position="top-right"
        richColors
        closeButton
        duration={3500}
        mobileOffset={{
          top: 'calc(62px + env(safe-area-inset-top, 0px))',
          left: '16px',
          right: '16px',
        }}
      />
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
