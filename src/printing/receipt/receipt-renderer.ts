import html2canvas from 'html2canvas';

import { PrinterError } from '../printer-errors';
import { receiptRasterCss } from './receipt-template';
import type { ReceiptRenderRequest, ReceiptRenderer } from './receipt-types';

type ImageCache = Map<string, Promise<string | null>>;

export function receiptImageCredentials(source: string, appOrigin: string): RequestCredentials {
  return new URL(source, appOrigin).origin === appOrigin ? 'include' : 'omit';
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)), { once: true });
    reader.addEventListener('error', () => reject(reader.error), { once: true });
    reader.readAsDataURL(blob);
  });
}

async function inlineImages(root: HTMLElement, cache: ImageCache) {
  const images = Array.from(root.querySelectorAll('img'));
  await Promise.all(
    images.map(async (image) => {
      const source = image.getAttribute('src');
      if (!source || source.startsWith('data:')) return;
      const imageUrl = new URL(source, window.location.origin);
      let pending = cache.get(source);
      if (!pending) {
        pending = fetch(imageUrl, {
          credentials: receiptImageCredentials(source, window.location.origin),
          mode: 'cors',
        })
          .then((response) => {
            if (!response.ok) throw new Error(`Image request failed (${response.status})`);
            return response.blob();
          })
          .then(blobToDataUrl)
          .catch(() => null);
        cache.set(source, pending);
      }
      const dataUrl = await pending;
      if (dataUrl) {
        image.setAttribute('src', dataUrl);
        image.removeAttribute('crossorigin');
      } else {
        // Keep the source for html2canvas's CORS loader. With allowTaint=false it will skip an
        // unsupported image instead of making the complete receipt unreadable.
        image.crossOrigin = 'anonymous';
      }
    }),
  );
}

async function renderOne(request: ReceiptRenderRequest, cache: ImageCache) {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    throw new PrinterError(
      'RENDER_FAILED',
      'Trình duyệt hiện tại không hỗ trợ raster hóa hóa đơn.',
    );
  }
  const dots = request.profile.defaultPrintableDots;
  if (dots <= 0 || dots > 1200) throw new PrinterError('RENDER_FAILED');

  const staging = document.createElement('div');
  staging.setAttribute('aria-hidden', 'true');
  staging.style.cssText = `position:fixed;left:-100000px;top:0;width:${dots}px;background:#fff;`;
  staging.innerHTML = `<style>${receiptRasterCss(dots)}</style><div class="receipt-raster-root">${request.html}</div>`;
  document.body.appendChild(staging);
  try {
    await inlineImages(staging, cache);
    await document.fonts?.ready;
    const receiptRoot = staging.querySelector<HTMLElement>('.receipt-raster-root');
    if (!receiptRoot) throw new PrinterError('RENDER_FAILED');
    const height = Math.max(1, Math.ceil(receiptRoot.scrollHeight));
    if (height > 65_535) throw new PrinterError('RENDER_FAILED', 'Hóa đơn quá dài để in.');

    const canvas = await html2canvas(receiptRoot, {
      allowTaint: false,
      backgroundColor: '#ffffff',
      foreignObjectRendering: false,
      height,
      imageTimeout: 3_000,
      logging: false,
      removeContainer: true,
      scale: 1,
      useCORS: true,
      width: dots,
      windowWidth: dots,
    });
    if (canvas.width !== dots) {
      throw new PrinterError('RENDER_FAILED', `Ảnh hóa đơn phải rộng đúng ${dots} dots.`);
    }
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!context) throw new PrinterError('RENDER_FAILED');
    return context.getImageData(0, 0, canvas.width, canvas.height);
  } catch (error) {
    if (error instanceof PrinterError) throw error;
    throw new PrinterError('RENDER_FAILED', undefined, { cause: error });
  } finally {
    staging.remove();
  }
}

export const browserReceiptRenderer: ReceiptRenderer = {
  async renderCopies(requests) {
    const imageCache: ImageCache = new Map();
    return Promise.all(requests.map((request) => renderOne(request, imageCache)));
  },
};
