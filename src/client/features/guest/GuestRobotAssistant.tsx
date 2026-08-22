import {
  BellOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  CreditCardOutlined,
  PlayCircleFilled,
  ReloadOutlined,
  ShopOutlined,
} from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  getGuestAssistantActions,
  getGuestAssistantNarration,
  guestAssistantStorageKey,
  type GuestAssistantAction,
  type GuestAssistantFeedback,
  type GuestAssistantPhase,
  type GuestAssistantTableStatus,
} from './guest-assistant';

const FALLBACK_SPEECH_DURATION_MS = 2_400;
const AUDIO_SAFETY_TIMEOUT_MS = 15_000;
const FEEDBACK_DURATION_MS = 4_200;

interface GuestRobotAssistantProps {
  token: string;
  tableStatus: GuestAssistantTableStatus;
  hasCart: boolean;
  actionPending?: boolean;
  feedback: GuestAssistantFeedback | null;
  audioSrc?: string;
  onAction: (action: GuestAssistantAction) => void;
}

type RobotExpression = 'neutral' | 'happy' | 'success' | 'error';

function wasIntroSeen(token: string) {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(guestAssistantStorageKey(token)) === '1';
  } catch {
    return false;
  }
}

function markIntroSeen(token: string) {
  try {
    window.sessionStorage.setItem(guestAssistantStorageKey(token), '1');
  } catch {
    // The assistant still works when storage is unavailable.
  }
}

function actionIcon(action: GuestAssistantAction, disabled?: boolean) {
  if (disabled) return <ClockCircleOutlined />;
  if (action === 'BROWSE_MENU') return <ShopOutlined />;
  if (action === 'CALL_STAFF') return <BellOutlined />;
  if (action === 'CHECKOUT') return <CreditCardOutlined />;
  return <PlayCircleFilled />;
}

function RobotVisual({
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
  token,
  tableStatus,
  hasCart,
  actionPending = false,
  feedback,
  audioSrc,
  onAction,
}: GuestRobotAssistantProps) {
  const introWasSeen = useMemo(() => wasIntroSeen(token), [token]);
  const [phase, setPhase] = useState<GuestAssistantPhase>(introWasSeen ? 'DOCKED' : 'CHOOSING');
  const [introActive, setIntroActive] = useState(!introWasSeen);
  const [introSpeaking, setIntroSpeaking] = useState(!introWasSeen);
  const [feedbackSpeaking, setFeedbackSpeaking] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [message, setMessage] = useState(() => getGuestAssistantNarration(tableStatus));
  const actions = useMemo(() => getGuestAssistantActions(tableStatus), [tableStatus]);

  const finishSpeech = useCallback(() => {
    markIntroSeen(token);
    setPhase('CHOOSING');
    setPanelOpen(true);
  }, [token]);

  useEffect(() => {
    if (phase !== 'FEEDBACK') setMessage(getGuestAssistantNarration(tableStatus));
  }, [phase, tableStatus]);

  useEffect(() => {
    if (introActive) markIntroSeen(token);
  }, [introActive, token]);

  useEffect(() => {
    if (!introSpeaking || !introActive) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setIntroSpeaking(false);
      return;
    }
    let audio: HTMLAudioElement | null = null;
    let timer = window.setTimeout(
      () => setIntroSpeaking(false),
      audioSrc ? AUDIO_SAFETY_TIMEOUT_MS : FALLBACK_SPEECH_DURATION_MS,
    );
    const stopSpeaking = () => {
      window.clearTimeout(timer);
      setIntroSpeaking(false);
    };
    if (audioSrc) {
      audio = new Audio(audioSrc);
      audio.addEventListener('ended', stopSpeaking, { once: true });
      void audio.play().catch(() => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => setIntroSpeaking(false), FALLBACK_SPEECH_DURATION_MS);
      });
    }
    return () => {
      window.clearTimeout(timer);
      if (audio) {
        audio.pause();
        audio.removeEventListener('ended', stopSpeaking);
      }
    };
  }, [audioSrc, introActive, introSpeaking]);

  useEffect(() => {
    if (!introActive) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [introActive]);

  useEffect(() => {
    if (phase !== 'SPEAKING') return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      finishSpeech();
      return;
    }

    let audio: HTMLAudioElement | null = null;
    let timer = window.setTimeout(
      finishSpeech,
      audioSrc ? AUDIO_SAFETY_TIMEOUT_MS : FALLBACK_SPEECH_DURATION_MS,
    );
    const handleAudioEnded = () => {
      window.clearTimeout(timer);
      finishSpeech();
    };
    if (audioSrc) {
      audio = new Audio(audioSrc);
      audio.addEventListener('ended', handleAudioEnded, { once: true });
      void audio.play().catch(() => {
        window.clearTimeout(timer);
        timer = window.setTimeout(finishSpeech, FALLBACK_SPEECH_DURATION_MS);
      });
    }

    return () => {
      window.clearTimeout(timer);
      if (audio) {
        audio.pause();
        audio.removeEventListener('ended', handleAudioEnded);
      }
    };
  }, [audioSrc, finishSpeech, phase]);

  useEffect(() => {
    if (!feedback) return;
    setMessage(feedback.message);
    setPhase('FEEDBACK');
    setPanelOpen(true);
    let audio: HTMLAudioElement | null = null;
    let audioTimer: number | null = null;
    const stopFeedbackAudio = () => {
      setFeedbackSpeaking(false);
      if (audioTimer !== null) window.clearTimeout(audioTimer);
    };
    if (feedback.audioSrc) {
      setFeedbackSpeaking(true);
      audio = new Audio(feedback.audioSrc);
      audio.addEventListener('ended', stopFeedbackAudio, { once: true });
      audioTimer = window.setTimeout(stopFeedbackAudio, AUDIO_SAFETY_TIMEOUT_MS);
      void audio.play().catch(stopFeedbackAudio);
    } else {
      setFeedbackSpeaking(false);
    }
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
      if (audioTimer !== null) window.clearTimeout(audioTimer);
      if (audio) {
        audio.pause();
        audio.removeEventListener('ended', stopFeedbackAudio);
      }
    };
  }, [feedback]);

  const startSpeaking = () => {
    setMessage(getGuestAssistantNarration(tableStatus));
    setPanelOpen(false);
    setPhase('SPEAKING');
  };

  const skipIntro = () => {
    markIntroSeen(token);
    setIntroActive(false);
    setPanelOpen(false);
    setPhase('DOCKED');
  };

  const chooseAction = (action: GuestAssistantAction, disabled?: boolean) => {
    if (disabled || actionPending) return;
    setIntroActive(false);
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
    <>
      {introActive ? (
        <section className="guest-assistant-intro" aria-label="Trợ lý Pro POS">
          <div className="guest-assistant-intro__backdrop" />
          <div className="guest-assistant-intro__card">
            <button type="button" className="guest-assistant-intro__skip" onClick={skipIntro}>
              Bỏ qua
            </button>
            <div className="guest-assistant-intro__heading">
              <span>TRỢ LÝ PRO POS</span>
              <strong>Tôi luôn sẵn sàng hỗ trợ bạn</strong>
            </div>
            <RobotVisual expression={expression} speaking={phase === 'SPEAKING' || introSpeaking} />
            <div
              className={`guest-assistant-bubble ${phase === 'SPEAKING' || introSpeaking ? 'is-speaking' : ''}`}
              aria-live="polite"
            >
              {message}
            </div>
            {phase === 'CHOOSING' ? (
              actionList
            ) : (
              <div className="guest-assistant-listening" aria-hidden="true">
                <span />
                <span />
                <span />
                <small>Đang nói...</small>
              </div>
            )}
          </div>
        </section>
      ) : (
        <aside
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
              {phase !== 'FEEDBACK' ? (
                <button type="button" className="guest-assistant-replay" onClick={startSpeaking}>
                  <ReloadOutlined /> Nghe lại lời chào
                </button>
              ) : null}
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
      )}
    </>
  );
}
