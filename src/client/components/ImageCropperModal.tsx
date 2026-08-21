import {
  CheckOutlined,
  CompressOutlined,
  ExpandOutlined,
  ReloadOutlined,
  RotateRightOutlined,
  ScissorOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@ant-design/icons';
import { Button, Modal, Radio, Slider, Typography } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface ImageCropperModalProps {
  open: boolean;
  imageSrc: string | null;
  onClose: () => void;
  onConfirm: (file: File) => Promise<void> | void;
  title?: string;
}

type AspectRatioMode = '1:1' | '4:3' | '3:4' | 'FREE';

export function ImageCropperModal({
  open,
  imageSrc,
  onClose,
  onConfirm,
  title = 'Chỉnh sửa & Căn khung ảnh sản phẩm',
}: ImageCropperModalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [imgElement, setImgElement] = useState<HTMLImageElement | null>(null);

  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [aspectRatio, setAspectRatio] = useState<AspectRatioMode>('1:1');
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [submitting, setSubmitting] = useState(false);

  // Load image element when imageSrc changes
  useEffect(() => {
    if (!imageSrc || !open) {
      setImgElement(null);
      setScale(1);
      setRotation(0);
      setPosition({ x: 0, y: 0 });
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.addEventListener(
      'load',
      () => {
        setImgElement(img);
        setScale(1);
        setRotation(0);
        setPosition({ x: 0, y: 0 });
      },
      { once: true },
    );
    img.src = imageSrc;
  }, [imageSrc, open]);

  // Handle Drag / Pan
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Touch handlers for mobile
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      if (!touch) return;
      setIsDragging(true);
      setDragStart({ x: touch.clientX - position.x, y: touch.clientY - position.y });
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging || e.touches.length !== 1) return;
    const touch = e.touches[0];
    if (!touch) return;
    setPosition({
      x: touch.clientX - dragStart.x,
      y: touch.clientY - dragStart.y,
    });
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  // Wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setScale((prev) => Math.min(Math.max(0.3, prev + delta), 4));
  };

  // Fit to frame: scales the image so the whole image fits inside the crop viewport
  const fitToFrame = useCallback(() => {
    if (!imgElement) return;
    const isRotated = rotation % 180 !== 0;
    const imgW = isRotated ? imgElement.naturalHeight : imgElement.naturalWidth;
    const imgH = isRotated ? imgElement.naturalWidth : imgElement.naturalHeight;

    const frameSize = 320;
    const targetW = frameSize;
    let targetH = frameSize;
    if (aspectRatio === '4:3') targetH = (frameSize * 3) / 4;
    if (aspectRatio === '3:4') targetH = (frameSize * 4) / 3;

    const scaleW = targetW / imgW;
    const scaleH = targetH / imgH;
    const fitScale = Math.min(scaleW, scaleH);

    setScale(Math.max(0.2, fitScale));
    setPosition({ x: 0, y: 0 });
  }, [imgElement, rotation, aspectRatio]);

  // Fill frame: scales the image so it fills the entire crop viewport
  const fillFrame = useCallback(() => {
    if (!imgElement) return;
    const isRotated = rotation % 180 !== 0;
    const imgW = isRotated ? imgElement.naturalHeight : imgElement.naturalWidth;
    const imgH = isRotated ? imgElement.naturalWidth : imgElement.naturalHeight;

    const frameSize = 320;
    const targetW = frameSize;
    let targetH = frameSize;
    if (aspectRatio === '4:3') targetH = (frameSize * 3) / 4;
    if (aspectRatio === '3:4') targetH = (frameSize * 4) / 3;

    const scaleW = targetW / imgW;
    const scaleH = targetH / imgH;
    const fillScale = Math.max(scaleW, scaleH);

    setScale(Math.max(0.3, fillScale));
    setPosition({ x: 0, y: 0 });
  }, [imgElement, rotation, aspectRatio]);

  // Export cropped area onto a canvas and generate File
  const handleConfirmCrop = async () => {
    if (!imgElement) return;
    setSubmitting(true);

    try {
      const outputDim = 900;
      let outW = outputDim;
      let outH = outputDim;

      if (aspectRatio === '4:3') outH = (outputDim * 3) / 4;
      if (aspectRatio === '3:4') outH = (outputDim * 4) / 3;

      const frameWidth = 320;

      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Không thể khởi tạo bộ dựng ảnh.');

      // Clear canvas to preserve full transparency for PNG / WebP images
      ctx.clearRect(0, 0, outW, outH);

      // Scale factor from preview frame to export canvas
      const exportRatio = outW / frameWidth;

      ctx.save();
      // Move origin to center of export canvas
      ctx.translate(outW / 2, outH / 2);

      // Apply offset scaled to export resolution
      ctx.translate(position.x * exportRatio, position.y * exportRatio);

      // Apply rotation
      ctx.rotate((rotation * Math.PI) / 180);

      // Apply scale
      const drawWidth = imgElement.naturalWidth * scale * exportRatio;
      const drawHeight = imgElement.naturalHeight * scale * exportRatio;

      ctx.drawImage(imgElement, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);

      ctx.restore();

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/webp', 0.95),
      );
      if (!blob) throw new Error('Không thể xuất tệp ảnh.');

      const file = new File([blob], `product_${Date.now()}.webp`, { type: 'image/webp' });
      await onConfirm(file);
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const getCropBoxStyle = () => {
    const baseWidth = 320;
    if (aspectRatio === '4:3') {
      return { width: `${baseWidth}px`, height: `${(baseWidth * 3) / 4}px` };
    }
    if (aspectRatio === '3:4') {
      return { width: `${baseWidth}px`, height: `${(baseWidth * 4) / 3}px` };
    }
    return { width: `${baseWidth}px`, height: `${baseWidth}px` };
  };

  return (
    <Modal
      open={open}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ScissorOutlined style={{ color: '#0975F7', fontSize: 18 }} />
          <span>{title}</span>
        </div>
      }
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      centered
      width={560}
      className="image-cropper-modal"
    >
      <div className="image-cropper-container">
        <Typography.Text
          type="secondary"
          style={{ fontSize: 13, marginBottom: 12, display: 'block', textAlign: 'center' }}
        >
          Kéo ảnh để di chuyển, cuộn chuột hoặc dùng thanh trượt để phóng to/thu nhỏ ảnh.
        </Typography.Text>

        {/* Viewport Frame */}
        <div
          ref={containerRef}
          className="image-cropper-viewport-wrap"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onWheel={handleWheel}
        >
          <div className="image-cropper-crop-box" style={getCropBoxStyle()}>
            {imgElement && (
              <img
                src={imgElement.src}
                alt="Chỉnh sửa"
                className="image-cropper-target-img"
                style={{
                  transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px)) rotate(${rotation}deg) scale(${scale})`,
                  cursor: isDragging ? 'grabbing' : 'grab',
                }}
                draggable={false}
              />
            )}
            <div className="image-cropper-grid-overlay" />
          </div>
        </div>

        {/* Aspect Ratio Selector */}
        <div className="image-cropper-toolbar-row">
          <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>Tỷ lệ khung:</span>
          <Radio.Group
            size="small"
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value as AspectRatioMode)}
          >
            <Radio.Button value="1:1">1:1 (Vuông - POS)</Radio.Button>
            <Radio.Button value="4:3">4:3 (Ngang)</Radio.Button>
            <Radio.Button value="3:4">3:4 (Dọc)</Radio.Button>
          </Radio.Group>
        </div>

        {/* Zoom & Quick Actions Slider */}
        <div className="image-cropper-controls-card">
          <div className="image-cropper-slider-row">
            <ZoomOutOutlined
              style={{ color: '#64748b' }}
              onClick={() => setScale((s) => Math.max(0.3, s - 0.1))}
            />
            <Slider
              min={0.3}
              max={3.5}
              step={0.05}
              value={scale}
              onChange={setScale}
              style={{ flex: 1, margin: '0 12px' }}
            />
            <ZoomInOutlined
              style={{ color: '#64748b' }}
              onClick={() => setScale((s) => Math.min(3.5, s + 0.1))}
            />
          </div>

          <div className="image-cropper-action-buttons">
            <Button
              size="small"
              icon={<CompressOutlined />}
              onClick={fitToFrame}
              title="Thu nhỏ để thấy trọn vẹn cả sản phẩm"
            >
              Vừa khung (Không cắt ảnh)
            </Button>
            <Button
              size="small"
              icon={<ExpandOutlined />}
              onClick={fillFrame}
              title="Phóng to để phủ kín khung"
            >
              Phủ kín khung
            </Button>
            <Button
              size="small"
              icon={<RotateRightOutlined />}
              onClick={() => setRotation((r) => (r + 90) % 360)}
            >
              Xoay 90°
            </Button>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => {
                setScale(1);
                setRotation(0);
                setPosition({ x: 0, y: 0 });
              }}
            >
              Đặt lại
            </Button>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="image-cropper-footer">
          <Button size="large" onClick={onClose} disabled={submitting}>
            Hủy bỏ
          </Button>
          <Button
            type="primary"
            size="large"
            icon={<CheckOutlined />}
            loading={submitting}
            onClick={handleConfirmCrop}
          >
            Lưu & Tải ảnh lên
          </Button>
        </div>
      </div>
    </Modal>
  );
}
