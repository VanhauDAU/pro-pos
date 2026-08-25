import {
  BellOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  CreditCardOutlined,
  PlayCircleFilled,
  ShopOutlined,
} from '@ant-design/icons';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  getGuestAssistantActions,
  getGuestAssistantNarration,
  type GuestAssistantAction,
  type GuestAssistantFeedback,
  type GuestAssistantPhase,
  type GuestAssistantTableStatus,
} from './guest-assistant';

const FEEDBACK_DURATION_MS = 4_200;

interface GuestRobotAssistantProps {
  token: string;
  tableStatus: GuestAssistantTableStatus;
  hasCart: boolean;
  actionPending?: boolean;
  feedback: GuestAssistantFeedback | null;
  onAction: (action: GuestAssistantAction) => void;
}

export type RobotExpression = 'neutral' | 'happy' | 'success' | 'error';

function actionIcon(action: GuestAssistantAction, disabled?: boolean) {
  if (disabled) return <ClockCircleOutlined />;
  if (action === 'BROWSE_MENU') return <ShopOutlined />;
  if (action === 'CALL_STAFF') return <BellOutlined />;
  if (action === 'CHECKOUT') return <CreditCardOutlined />;
  return <PlayCircleFilled />;
}

export function RobotVisual({
  expression,
  speaking,
  compact = false,
}: {
  expression: RobotExpression;
  speaking: boolean;
  compact?: boolean;
}) {
  const eyes =
    expression === 'success'
      ? 'success'
      : expression === 'error'
        ? 'error'
        : expression === 'happy'
          ? 'happy'
          : 'neutral';
  const mouth =
    expression === 'success'
      ? 'success'
      : expression === 'error'
        ? 'error'
        : expression === 'happy'
          ? 'happy'
          : 'neutral';
  const gesture = expression === 'success' ? 'thumbs-up' : expression === 'happy' ? 'wave' : null;

  return (
    <div
      className={`guest-robot ${compact ? 'guest-robot--compact' : ''} ${speaking ? 'is-speaking' : ''}`}
      aria-hidden="true"
    >
      <img
        className="guest-robot__layer guest-robot__shadow"
        src="/image/mascot/base/robot-shadow-floating.webp"
        alt=""
        draggable={false}
      />
      <img
        className="guest-robot__layer guest-robot__arm guest-robot__arm--right"
        src="/image/mascot/arms/neutral/robot-arm-right-neutral.webp"
        alt=""
        draggable={false}
      />
      <img
        className={`guest-robot__layer guest-robot__arm guest-robot__arm--left ${gesture ? `is-${gesture}` : ''}`}
        src={
          gesture === 'thumbs-up'
            ? '/image/mascot/arms/gestures/robot-arm-left-thumbs-up.webp'
            : gesture === 'wave'
              ? '/image/mascot/arms/gestures/robot-arm-left-wave.webp'
              : '/image/mascot/arms/neutral/robot-arm-left-neutral.webp'
        }
        alt=""
        draggable={false}
      />
      <img
        className="guest-robot__layer guest-robot__body"
        src="/image/mascot/base/robot-body-core.webp"
        alt=""
        draggable={false}
      />
      <span className="guest-robot__brand">Pro POS</span>
      <img
        className="guest-robot__layer guest-robot__head"
        src="/image/mascot/base/robot-head.webp"
        alt=""
        draggable={false}
      />
      <img
        className="guest-robot__layer guest-robot__eyes"
        src={`/image/mascot/face/eyes/robot-eyes-${eyes}.webp`}
        alt=""
        draggable={false}
      />
      {expression !== 'error' && expression !== 'success' ? (
        <img
          className="guest-robot__layer guest-robot__eyes-blink"
          src="/image/mascot/face/eyes/robot-eyes-blink.webp"
          alt=""
          draggable={false}
        />
      ) : null}
      {speaking ? (
        <>
          <img
            className="guest-robot__layer guest-robot__mouth guest-robot__mouth--talk-neutral"
            src="/image/mascot/face/mouths/robot-mouth-neutral.webp"
            alt=""
            draggable={false}
          />
          <img
            className="guest-robot__layer guest-robot__mouth guest-robot__mouth--talk-happy"
            src="/image/mascot/face/mouths/robot-mouth-happy.webp"
            alt=""
            draggable={false}
          />
        </>
      ) : (
        <img
          className="guest-robot__layer guest-robot__mouth"
          src={`/image/mascot/face/mouths/robot-mouth-${mouth}.webp`}
          alt=""
          draggable={false}
        />
      )}
    </div>
  );
}

export function GuestRobotAssistant({
  token: _token,
  tableStatus,
  hasCart,
  actionPending = false,
  feedback,
  onAction,
}: GuestRobotAssistantProps) {
  const [phase, setPhase] = useState<GuestAssistantPhase>('DOCKED');
  const [feedbackSpeaking, setFeedbackSpeaking] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const dockRef = useRef<HTMLElement>(null);
  const [message, setMessage] = useState(() => getGuestAssistantNarration(tableStatus));
  const actions = useMemo(() => getGuestAssistantActions(tableStatus), [tableStatus]);

  // Close panel when clicking/tapping outside the dock
  useEffect(() => {
    if (!panelOpen) return;
    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      if (dockRef.current && !dockRef.current.contains(e.target as Node)) {
        setPanelOpen(false);
        setPhase('DOCKED');
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [panelOpen]);

  useEffect(() => {
    if (phase !== 'FEEDBACK') setMessage(getGuestAssistantNarration(tableStatus));
  }, [phase, tableStatus]);

  useEffect(() => {
    if (!feedback) return;
    setMessage(feedback.message);
    setPhase('FEEDBACK');
    setPanelOpen(true);
    setFeedbackSpeaking(false);
    const timer = window.setTimeout(() => {
      if (feedback.tone === 'error') {
        setPhase('CHOOSING');
        setPanelOpen(true);
      } else {
        setPhase('DOCKED');
        setPanelOpen(false);
      }
    }, FEEDBACK_DURATION_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [feedback]);
  const chooseAction = (action: GuestAssistantAction, disabled?: boolean) => {
    if (disabled || actionPending) return;
    setPanelOpen(false);
    setPhase('DOCKED');
    onAction(action);
  };

  const toggleDock = () => {
    if (phase === 'SPEAKING') return;
    if (panelOpen) {
      setPanelOpen(false);
      setPhase('DOCKED');
      return;
    }
    setMessage(getGuestAssistantNarration(tableStatus));
    setPanelOpen(true);
    setPhase('CHOOSING');
  };

  const expression: RobotExpression =
    phase === 'FEEDBACK'
      ? feedback?.tone === 'error'
        ? 'error'
        : 'success'
      : phase === 'SPEAKING' || phase === 'CHOOSING'
        ? 'happy'
        : 'neutral';

  const actionList = (
    <div className="guest-assistant-actions" aria-label="Các hỗ trợ dành cho khách">
      {actions.map((option, index) => (
        <button
          key={`${option.action}-${option.label}`}
          type="button"
          className={`guest-assistant-action guest-assistant-action--${option.action.toLowerCase().replace('_', '-')}`}
          style={{ '--guest-action-index': index } as React.CSSProperties}
          disabled={option.disabled || actionPending}
          onClick={() => chooseAction(option.action, option.disabled)}
        >
          <span className="guest-assistant-action__icon">
            {actionPending && !option.disabled ? (
              <span className="guest-assistant-spinner" />
            ) : (
              actionIcon(option.action, option.disabled)
            )}
          </span>
          <span className="guest-assistant-action__copy">
            <strong>{option.label}</strong>
            <small>{option.description}</small>
          </span>
        </button>
      ))}
    </div>
  );

  return (
    <aside
      ref={dockRef}
      className={`guest-assistant-dock ${hasCart ? 'has-cart' : ''} ${panelOpen ? 'is-open' : ''}`}
      aria-label="Trợ lý Pro POS"
    >
      {panelOpen ? (
        <div className="guest-assistant-dock__panel">
          <div
            className={`guest-assistant-dock__message is-${feedback?.tone ?? 'normal'}`}
            aria-live="polite"
          >
            {message}
          </div>
          {phase === 'FEEDBACK' ? (
            <div className="guest-assistant-feedback-status">
              {feedback?.tone === 'success' ? <CheckCircleFilled /> : null}
              {feedback?.tone === 'success' ? 'Đã hoàn tất' : 'Bạn có thể thử lại'}
            </div>
          ) : (
            actionList
          )}
        </div>
      ) : null}
      {!panelOpen ? (
        <div className="guest-assistant-dock__quick-actions" aria-label="Chọn hỗ trợ nhanh">
          {actions.map((option) => (
            <button
              key={`quick-${option.action}-${option.label}`}
              type="button"
              disabled={option.disabled || actionPending}
              onClick={() => chooseAction(option.action, option.disabled)}
            >
              <span>{actionIcon(option.action, option.disabled)}</span>
              <strong>{option.label}</strong>
            </button>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className="guest-assistant-dock__button"
        aria-expanded={panelOpen}
        aria-label={panelOpen ? 'Thu gọn trợ lý Pro POS' : 'Mở trợ lý Pro POS'}
        onClick={toggleDock}
      >
        <RobotVisual
          expression={expression}
          speaking={phase === 'SPEAKING' || feedbackSpeaking}
          compact
        />
      </button>
    </aside>
  );
}
