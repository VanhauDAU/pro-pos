import { PrinterError } from '../printer-errors';

export async function triggerBrowserPrint(html: string): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new PrinterError(
      'RENDER_FAILED',
      'Không thể mở hộp thoại in trên môi trường phi trình duyệt.',
    );
  }

  return new Promise<void>((resolve, reject) => {
    try {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.setAttribute('aria-hidden', 'true');

      document.body.appendChild(iframe);

      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) {
        iframe.remove();
        throw new PrinterError('RENDER_FAILED', 'Không thể khởi tạo khung in trình duyệt.');
      }

      iframeDoc.open();
      iframeDoc.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>
              @page {
                margin: 0;
              }
              body {
                margin: 0;
                padding: 0;
                background: #fff;
              }
            </style>
          </head>
          <body>
            ${html}
          </body>
        </html>
      `);
      iframeDoc.close();

      const printWindow = iframe.contentWindow;
      if (!printWindow) {
        iframe.remove();
        throw new PrinterError('RENDER_FAILED', 'Không thể kết nối cửa sổ in.');
      }

      const cleanup = () => {
        setTimeout(() => {
          iframe.remove();
        }, 1000);
      };

      printWindow.focus();
      // Give images/fonts a moment to render inside iframe
      setTimeout(() => {
        try {
          printWindow.print();
          cleanup();
          resolve();
        } catch (err) {
          cleanup();
          reject(
            new PrinterError('PRINT_FAILED', 'Không thể kích hoạt hộp thoại in của trình duyệt.', {
              cause: err,
            }),
          );
        }
      }, 250);
    } catch (error) {
      reject(
        error instanceof PrinterError
          ? error
          : new PrinterError('PRINT_FAILED', undefined, { cause: error }),
      );
    }
  });
}
