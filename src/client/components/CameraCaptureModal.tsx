import {
  CameraOutlined,
  CheckOutlined,
  RedoOutlined,
  SwapOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { Alert, Button, Modal, Typography } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';

interface CameraCaptureModalProps {
  open: boolean;
  onClose: () => void;
  onCapture?: (file: File) => Promise<void> | void;
  onSnap?: (dataUrl: string) => void;
  title?: string;
}

export function CameraCaptureModal({
  open,
  onClose,
  onCapture,
  onSnap,
  title = 'Chụp ảnh sản phẩm',
}: CameraCaptureModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
  }, [stream]);

  const startCamera = useCallback(
    async (mode: 'environment' | 'user') => {
      stopStream();
      setCameraError(null);
      setCapturedDataUrl(null);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError(
          'Trình duyệt hoặc thiết bị của bạn không hỗ trợ truy cập camera trực tiếp. Vui lòng sử dụng tính năng tải ảnh từ thiết bị.',
        );
        return;
      }

      try {
        let newStream: MediaStream;
        try {
          newStream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: mode },
              width: { ideal: 1280 },
              height: { ideal: 1280 },
            },
            audio: false,
          });
        } catch {
          // Fallback if specific facingMode fails
          newStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }

        setStream(newStream);
        if (videoRef.current) {
          videoRef.current.srcObject = newStream;
        }

        // Check if there are multiple video devices
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter((d) => d.kind === 'videoinput');
        setHasMultipleCameras(videoInputs.length > 1);
      } catch (err: unknown) {
        const error = err as { name?: string; message?: string };
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
          setCameraError(
            'Quyền truy cập camera bị từ chối. Vui lòng cho phép quyền camera trên trình duyệt hoặc chọn tải ảnh từ máy tính/điện thoại.',
          );
        } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
          setCameraError('Không tìm thấy thiết bị camera nào trên máy của bạn.');
        } else {
          setCameraError(
            `Không thể khởi động camera: ${error.message || 'Lỗi không xác định'}. Vui lòng thử lại hoặc tải ảnh từ file.`,
          );
        }
      }
    },
    [stopStream],
  );

  useEffect(() => {
    if (open) {
      void startCamera(facingMode);
    } else {
      stopStream();
      setCapturedDataUrl(null);
      setCameraError(null);
    }
    return () => {
      stopStream();
    };
  }, [open, facingMode, startCamera, stopStream]);

  // Keep video source updated
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const toggleFacingMode = () => {
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextMode);
  };

  const handleTakeSnapshot = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    setIsCapturing(true);
    setTimeout(() => setIsCapturing(false), 200);

    const videoWidth = video.videoWidth || 640;
    const videoHeight = video.videoHeight || 480;

    canvas.width = videoWidth;
    canvas.height = videoHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (facingMode === 'user') {
      // Mirror user selfie camera
      ctx.translate(videoWidth, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(video, 0, 0, videoWidth, videoHeight);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    setCapturedDataUrl(dataUrl);
    stopStream();

    if (onSnap) {
      onSnap(dataUrl);
      onClose();
    }
  };

  const handleRetake = () => {
    setCapturedDataUrl(null);
    void startCamera(facingMode);
  };

  const handleConfirm = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !capturedDataUrl) return;

    setUploading(true);
    try {
      if (onCapture) {
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/jpeg', 0.92),
        );
        if (!blob) throw new Error('Không thể xử lý ảnh đã chụp.');

        const fileName = `camera_product_${Date.now()}.jpg`;
        const file = new File([blob], fileName, { type: 'image/jpeg' });

        await onCapture(file);
      }
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal
      open={open}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CameraOutlined style={{ color: '#0975F7', fontSize: 18 }} />
          <span>{title}</span>
        </div>
      }
      onCancel={() => {
        stopStream();
        onClose();
      }}
      footer={null}
      destroyOnHidden
      centered
      width={520}
      className="camera-capture-modal"
    >
      <div className="camera-capture-container">
        {cameraError ? (
          <div className="camera-capture-error">
            <Alert
              type="warning"
              showIcon
              icon={<WarningOutlined />}
              message="Không thể sử dụng Camera"
              description={cameraError}
            />
            <div style={{ marginTop: 16, textAlign: 'center' }}>
              <Button type="primary" onClick={() => startCamera(facingMode)}>
                Thử lại
              </Button>
            </div>
          </div>
        ) : capturedDataUrl ? (
          <div className="camera-capture-review">
            <div className="camera-capture-preview-frame">
              <img
                src={capturedDataUrl}
                alt="Ảnh vừa chụp"
                className="camera-capture-preview-img"
              />
            </div>
            <Typography.Text type="secondary" style={{ display: 'block', margin: '10px 0 16px' }}>
              Kiểm tra ảnh vừa chụp. Bấm &quot;Sử dụng ảnh này&quot; để lưu làm ảnh đại diện duy
              nhất của sản phẩm.
            </Typography.Text>
            <div className="camera-capture-review-actions">
              <Button
                icon={<RedoOutlined />}
                size="large"
                disabled={uploading}
                onClick={handleRetake}
              >
                Chụp lại
              </Button>
              <Button
                type="primary"
                icon={<CheckOutlined />}
                size="large"
                loading={uploading}
                onClick={handleConfirm}
              >
                Sử dụng ảnh này
              </Button>
            </div>
          </div>
        ) : (
          <div className="camera-capture-live">
            <div className={`camera-capture-viewport ${isCapturing ? 'is-flashing' : ''}`}>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`camera-capture-video ${facingMode === 'user' ? 'is-mirrored' : ''}`}
              />
              <div className="camera-capture-overlay-grid">
                <div className="camera-capture-target-box" />
              </div>
            </div>

            <div className="camera-capture-controls">
              {hasMultipleCameras && (
                <Button
                  shape="circle"
                  size="large"
                  icon={<SwapOutlined />}
                  onClick={toggleFacingMode}
                  title="Đổi camera trước/sau"
                  className="camera-capture-switch-btn"
                />
              )}
              <button
                type="button"
                className="camera-shutter-button"
                onClick={handleTakeSnapshot}
                aria-label="Chụp ảnh"
              >
                <div className="camera-shutter-inner" />
              </button>
              <div className="camera-capture-controls-spacer" />
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
              Đặt sản phẩm vào giữa khung hình rồi nhấn nút chụp.
            </Typography.Text>
          </div>
        )}

        <canvas ref={canvasRef} style={{ display: 'none' }} />
      </div>
    </Modal>
  );
}
