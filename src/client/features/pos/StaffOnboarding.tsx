import {
  AppstoreOutlined,
  BellOutlined,
  MutedOutlined,
  QrcodeOutlined,
  ShoppingCartOutlined,
  SoundOutlined,
} from '@ant-design/icons';
import { Button, Modal, Switch, Tour, Typography } from 'antd';
import type { TourProps } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import type { AuthContextResponse } from '@contracts/auth';
import { onboardingAudioPlayer } from '@client/lib/onboarding-audio';

const ONBOARDING_VERSION = 1;
const DEFER_MS = 24 * 60 * 60_000;
const VOICE_MUTED_STORAGE_KEY = 'propos:staff-onboarding:voice-muted';

interface OnboardingProgress {
  version: typeof ONBOARDING_VERSION;
  basicsCompleted: boolean;
  orderCompleted: boolean;
  basicStep: number;
  deferredUntil?: number | undefined;
  orderDeferredUntil?: number | undefined;
  completedAt?: number | undefined;
}

function initialProgress(): OnboardingProgress {
  return {
    version: ONBOARDING_VERSION,
    basicsCompleted: false,
    orderCompleted: false,
    basicStep: 0,
  };
}

function getInitialVoiceMuted(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(VOICE_MUTED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function target(selector: string) {
  return () => document.querySelector<HTMLElement>(selector) ?? document.body;
}

function isOrderEditor(pathname: string) {
  return (
    pathname.startsWith('/pos/orders/') &&
    !pathname.endsWith('/detail') &&
    !pathname.endsWith('/payment')
  );
}

export function StaffOnboarding({
  auth,
  restartToken,
}: {
  auth: AuthContextResponse;
  restartToken: number;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const storageKey = useMemo(() => {
    const storeId = auth.actor?.storeId ?? auth.device?.storeId ?? 'unknown-store';
    const deviceId = auth.device?.id ?? 'unknown-device';
    const actorId = auth.actor?.id ?? 'unknown-employee';
    return `propos:staff-onboarding:v${ONBOARDING_VERSION}:${storeId}:${deviceId}:${actorId}`;
  }, [auth.actor?.id, auth.actor?.storeId, auth.device?.id, auth.device?.storeId]);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState<OnboardingProgress>(initialProgress);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [basicTourOpen, setBasicTourOpen] = useState(false);
  const [basicStep, setBasicStep] = useState(0);
  const [orderTourOpen, setOrderTourOpen] = useState(false);
  const [orderStep, setOrderStep] = useState(0);
  const [audioReady, setAudioReady] = useState(false);
  const [voiceMuted, setVoiceMutedState] = useState(getInitialVoiceMuted);
  const [pushPromptFinished, setPushPromptFinished] = useState(
    () => typeof Notification === 'undefined' || Notification.permission !== 'default',
  );
  const previousRestartToken = useRef(restartToken);

  const toggleVoiceMute = useCallback(() => {
    onboardingAudioPlayer.unlock();
    setVoiceMutedState((prev) => {
      const next = !prev;
      onboardingAudioPlayer.setMuted(next);
      try {
        localStorage.setItem(VOICE_MUTED_STORAGE_KEY, String(next));
      } catch {
        // The preference still applies in-memory when private browsing blocks localStorage.
      }
      return next;
    });
  }, []);

  const setVoiceMuted = useCallback((muted: boolean) => {
    onboardingAudioPlayer.unlock();
    setVoiceMutedState(muted);
    onboardingAudioPlayer.setMuted(muted);
    try {
      localStorage.setItem(VOICE_MUTED_STORAGE_KEY, String(muted));
    } catch {
      // The preference still applies in-memory when private browsing blocks localStorage.
    }
  }, []);

  useEffect(() => {
    const initialMuted = getInitialVoiceMuted();
    onboardingAudioPlayer.setMuted(initialMuted);
    void onboardingAudioPlayer.preload().then(() => setAudioReady(true));
    return () => onboardingAudioPlayer.stop();
  }, []);

  useEffect(() => {
    const unlock = () => void onboardingAudioPlayer.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
    window.addEventListener('keydown', unlock, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
  }, []);

  const persist = (next: OnboardingProgress) => {
    setProgress(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // The tour still works when private browsing blocks persistent storage.
    }
  };

  useEffect(() => {
    let next = initialProgress();
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<OnboardingProgress>;
        if (parsed.version === ONBOARDING_VERSION) {
          next = { ...next, ...parsed, version: ONBOARDING_VERSION };
        }
      }
    } catch {
      // Start from a safe default when local storage is unavailable or corrupted.
    }
    setProgress(next);
    setBasicStep(next.basicStep);
    setReady(true);
  }, [storageKey]);

  useEffect(() => {
    const finishPushPrompt = () => setPushPromptFinished(true);
    window.addEventListener('propos:push-prompt-finished', finishPushPrompt);
    return () => window.removeEventListener('propos:push-prompt-finished', finishPushPrompt);
  }, []);

  useEffect(() => {
    if (!ready || !pushPromptFinished || progress.basicsCompleted) return;
    if ((progress.deferredUntil ?? 0) > Date.now()) return;
    setWelcomeOpen(true);
  }, [progress.basicsCompleted, progress.deferredUntil, pushPromptFinished, ready]);

  useEffect(() => {
    if (
      !ready ||
      !progress.basicsCompleted ||
      progress.orderCompleted ||
      !isOrderEditor(location.pathname)
    ) {
      return undefined;
    }
    if ((progress.orderDeferredUntil ?? 0) > Date.now()) return undefined;
    const timer = window.setTimeout(() => {
      setOrderStep(0);
      setOrderTourOpen(true);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [
    location.pathname,
    progress.basicsCompleted,
    progress.orderCompleted,
    progress.orderDeferredUntil,
    ready,
  ]);

  useEffect(() => {
    if (restartToken === previousRestartToken.current) return;
    previousRestartToken.current = restartToken;
    const next = initialProgress();
    persist(next);
    setBasicStep(0);
    setOrderTourOpen(false);
    onboardingAudioPlayer.stop();
    setWelcomeOpen(true);
  }, [restartToken]);

  useEffect(() => {
    if (!basicTourOpen) return;
    if (basicStep === 1 || basicStep === 2 || basicStep === 3) {
      if (!location.pathname.startsWith('/pos/areas')) navigate('/pos/areas');
    } else if (basicStep >= 4 && location.pathname !== '/pos') {
      navigate('/pos');
    }
  }, [basicStep, basicTourOpen, location.pathname, navigate]);

  const currentTourTrack = basicTourOpen ? basicStep : orderTourOpen ? orderStep + 8 : null;

  useEffect(() => {
    if (currentTourTrack === null) {
      onboardingAudioPlayer.stop();
      return;
    }
    if (voiceMuted) {
      onboardingAudioPlayer.stop();
      return;
    }
    onboardingAudioPlayer.play(currentTourTrack);
  }, [currentTourTrack, voiceMuted]);

  const renderStepTitle = (title: string) => (
    <div className="staff-onboarding-step-header">
      <span className="staff-onboarding-step-title">{title}</span>
      <button
        type="button"
        className={`staff-onboarding-voice-btn ${voiceMuted ? 'is-muted' : 'is-active'}`}
        onClick={(e) => {
          e.stopPropagation();
          toggleVoiceMute();
        }}
        title={voiceMuted ? 'Bật giọng đọc hướng dẫn' : 'Tắt giọng đọc hướng dẫn'}
        aria-label={voiceMuted ? 'Bật giọng đọc hướng dẫn' : 'Tắt giọng đọc hướng dẫn'}
      >
        {voiceMuted ? <MutedOutlined /> : <SoundOutlined />}
      </button>
    </div>
  );

  const basicSteps: NonNullable<TourProps['steps']> = [
    {
      title: renderStepTitle('Chào mừng đến Pro POS'),
      description:
        'Hướng dẫn nhanh này không tạo dữ liệu. Bạn chỉ cần xem các khu vực chính, sau đó tự chọn một bàn để thực hành.',
      nextButtonProps: { children: 'Bắt đầu' },
    },
    {
      target: target('.staff-area-list'),
      title: renderStepTitle('1. Chọn khu vực'),
      description:
        'Mỗi khu vực chứa một nhóm bàn. Trên điện thoại, khu vực được hiển thị thành các tab ngang.',
      nextButtonProps: { children: 'Tiếp tục' },
      prevButtonProps: { children: 'Quay lại' },
    },
    {
      target: target('.staff-table-grid'),
      title: renderStepTitle('2. Chọn bàn'),
      description:
        'Bàn trống có thể mở đơn mới; bàn đang sử dụng sẽ mở đơn hiện tại. Bàn tạm ngưng không thể chọn.',
      nextButtonProps: { children: 'Tiếp tục' },
      prevButtonProps: { children: 'Quay lại' },
    },
    {
      target: target('[data-nav-key="orders"]'),
      title: renderStepTitle('3. Danh sách đơn hàng'),
      description: 'Chạm Đơn hàng để xem tất cả đơn tại chỗ và mang đi đang hoạt động.',
      nextButtonProps: { children: 'Xem danh sách đơn' },
      prevButtonProps: { children: 'Quay lại' },
    },
    {
      target: target('.staff-order-results'),
      title: renderStepTitle('4. Theo dõi đơn đang mở'),
      description:
        'Tìm theo mã đơn, bàn hoặc khu vực. Chạm một thẻ đơn để thêm món, sửa chi tiết hoặc thanh toán.',
      nextButtonProps: { children: 'Tiếp tục' },
      prevButtonProps: { children: 'Quay lại' },
    },
    {
      target: target('[data-nav-key="qr"]'),
      title: renderStepTitle('5. QR Order'),
      description:
        'Badge đỏ báo số yêu cầu chưa xử lý. Tại đây bạn xác nhận mở bàn, món khách gọi, gọi nhân viên và yêu cầu thanh toán.',
      nextButtonProps: { children: 'Tiếp tục' },
      prevButtonProps: { children: 'Quay lại' },
    },
    {
      target: target('.staff-header-notification-btn'),
      title: renderStepTitle('6. Trung tâm thông báo'),
      description:
        'Nút chuông lưu hoạt động POS trong 3 ngày: tạo đơn, thêm/sửa món, chuyển bàn và thanh toán.',
      nextButtonProps: { children: 'Tiếp tục' },
      prevButtonProps: { children: 'Quay lại' },
    },
    {
      target: target('[data-nav-key="more"]'),
      title: renderStepTitle('7. Trợ giúp và thiết lập'),
      description:
        'Mục Thêm có các chức năng bạn được cấp quyền thực hiện, thông tin cửa hàng và Đăng xuất.',
      nextButtonProps: { children: 'Hoàn tất phần cơ bản' },
      prevButtonProps: { children: 'Quay lại' },
    },
  ];

  const orderSteps: NonNullable<TourProps['steps']> = [
    {
      target: target('.staff-order-editor__header, .staff-order-mobile-header'),
      title: renderStepTitle('Đơn hàng của bàn'),
      description: 'Kiểm tra đúng khu vực, bàn, loại đơn và mã đơn trước khi thao tác.',
      nextButtonProps: { children: 'Tiếp tục' },
    },
    {
      target: target('.staff-product-grid button, .staff-order-mobile-fab'),
      title: renderStepTitle('Chọn và gọi món'),
      description:
        'Chọn sản phẩm, phiên bản, số lượng và ghi chú. Trên điện thoại hãy dùng nút Thêm món.',
      nextButtonProps: { children: 'Tiếp tục' },
      prevButtonProps: { children: 'Quay lại' },
    },
    {
      target: target('.staff-cart-panel, .staff-order-mobile-content'),
      title: renderStepTitle('Kiểm tra chi tiết đơn'),
      description:
        'Món mới nằm trong phần gọi thêm trước khi lưu. Chạm món để sửa số lượng, biến thể, giảm giá hoặc ghi chú.',
      nextButtonProps: { children: 'Tiếp tục' },
      prevButtonProps: { children: 'Quay lại' },
    },
    {
      target: target('.staff-cart-note, .staff-order-mobile-note'),
      title: renderStepTitle('Ghi chú đơn hàng'),
      description: 'Ghi thông tin chung cho cả đơn, khác với ghi chú riêng của từng món.',
      nextButtonProps: { children: 'Tiếp tục' },
      prevButtonProps: { children: 'Quay lại' },
    },
    {
      target: target('.staff-cart-actions, .staff-order-mobile-actions'),
      title: renderStepTitle('Lưu đơn hoặc thanh toán'),
      description:
        'Bấm Lưu đơn để ghi món vào hệ thống. Chỉ chọn Thanh toán sau khi đã kiểm tra tổng tiền và phương thức thu tiền.',
      nextButtonProps: { children: 'Hoàn tất hướng dẫn' },
      prevButtonProps: { children: 'Quay lại' },
    },
  ];

  const startBasics = async () => {
    await onboardingAudioPlayer.preload();
    setWelcomeOpen(false);
    const step = Math.min(progress.basicStep, (basicSteps?.length ?? 1) - 1);
    setBasicStep(step);
    setBasicTourOpen(true);
  };

  const deferBasics = () => {
    onboardingAudioPlayer.stop();
    const next = { ...progress, basicStep, deferredUntil: Date.now() + DEFER_MS };
    persist(next);
    setWelcomeOpen(false);
    setBasicTourOpen(false);
  };

  const skipAll = () => {
    onboardingAudioPlayer.stop();
    persist({
      ...progress,
      basicsCompleted: true,
      orderCompleted: true,
      basicStep: 0,
      deferredUntil: undefined,
      orderDeferredUntil: undefined,
      completedAt: Date.now(),
    });
    setWelcomeOpen(false);
    setBasicTourOpen(false);
    setOrderTourOpen(false);
  };

  return (
    <>
      <Modal
        open={welcomeOpen}
        title={
          <div className="staff-onboarding-modal-header">
            <span>Hướng dẫn nhanh cho nhân viên</span>
            <button
              type="button"
              className={`staff-onboarding-voice-btn ${voiceMuted ? 'is-muted' : 'is-active'}`}
              onClick={toggleVoiceMute}
              title={voiceMuted ? 'Bật giọng đọc hướng dẫn' : 'Tắt giọng đọc hướng dẫn'}
              aria-label={voiceMuted ? 'Bật giọng đọc hướng dẫn' : 'Tắt giọng đọc hướng dẫn'}
            >
              {voiceMuted ? <MutedOutlined /> : <SoundOutlined />}
            </button>
          </div>
        }
        closable={false}
        footer={[
          <Button key="never" type="text" onClick={skipAll}>
            Không hiển thị lại
          </Button>,
          <Button key="later" onClick={deferBasics}>
            Để sau 24 giờ
          </Button>,
          <Button
            key="start"
            type="primary"
            loading={!audioReady}
            onClick={() => void startBasics()}
          >
            {audioReady ? 'Bắt đầu hướng dẫn' : 'Đang tải hướng dẫn'}
          </Button>,
        ]}
      >
        <div className="staff-onboarding-welcome">
          <div className="staff-onboarding-welcome__icons">
            <AppstoreOutlined />
            <ShoppingCartOutlined />
            <QrcodeOutlined />
            <BellOutlined />
          </div>
          <Typography.Paragraph>
            Tour mất khoảng 2 phút và được lưu riêng cho nhân viên này trên thiết bị hiện tại.
          </Typography.Paragraph>

          <div
            className="staff-onboarding-voice-banner"
            role="button"
            tabIndex={0}
            onClick={toggleVoiceMute}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleVoiceMute();
              }
            }}
          >
            <div className="staff-onboarding-voice-banner__info">
              <span
                className={`staff-onboarding-voice-banner__icon ${voiceMuted ? 'is-muted' : 'is-active'}`}
              >
                {voiceMuted ? <MutedOutlined /> : <SoundOutlined />}
              </span>
              <div>
                <div className="staff-onboarding-voice-banner__title">
                  Giọng đọc hướng dẫn {voiceMuted ? '(Đang tắt)' : '(Đang bật)'}
                </div>
                <div className="staff-onboarding-voice-banner__desc">
                  {voiceMuted
                    ? 'Đang tắt âm thanh thuyết minh. Chạm để bật lại bất kỳ lúc nào.'
                    : 'Tự động phát giọng đọc thuyết minh qua từng bước hướng dẫn.'}
                </div>
              </div>
            </div>
            <div
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              <Switch
                size="small"
                checked={!voiceMuted}
                onChange={(checked) => setVoiceMuted(!checked)}
                aria-label="Bật hoặc tắt giọng đọc hướng dẫn"
              />
            </div>
          </div>

          <Typography.Text type="secondary">
            Tour không tự mở bàn, không thêm món và không thay đổi dữ liệu bán hàng.
          </Typography.Text>
        </div>
      </Modal>

      <Tour
        open={basicTourOpen}
        current={basicStep}
        steps={basicSteps}
        type="primary"
        rootClassName="staff-onboarding-tour"
        getPopupContainer={false}
        zIndex={1600}
        onChange={(step) => {
          setBasicStep(step);
          persist({ ...progress, basicStep: step, deferredUntil: undefined });
        }}
        onClose={(step) => {
          onboardingAudioPlayer.stop();
          persist({ ...progress, basicStep: step, deferredUntil: Date.now() + DEFER_MS });
          setBasicTourOpen(false);
        }}
        onFinish={() => {
          onboardingAudioPlayer.stop();
          persist({
            ...progress,
            basicsCompleted: true,
            basicStep: 0,
            deferredUntil: undefined,
          });
          setBasicTourOpen(false);
          navigate('/pos/areas');
        }}
      />

      <Tour
        open={orderTourOpen}
        current={orderStep}
        steps={orderSteps}
        type="primary"
        rootClassName="staff-onboarding-tour"
        getPopupContainer={false}
        zIndex={1600}
        onChange={setOrderStep}
        onClose={() => {
          onboardingAudioPlayer.stop();
          persist({ ...progress, orderDeferredUntil: Date.now() + DEFER_MS });
          setOrderTourOpen(false);
        }}
        onFinish={() => {
          persist({
            ...progress,
            orderCompleted: true,
            orderDeferredUntil: undefined,
            completedAt: Date.now(),
          });
          setOrderTourOpen(false);
          if (!voiceMuted) {
            void onboardingAudioPlayer.play(13);
          }
        }}
      />
    </>
  );
}
