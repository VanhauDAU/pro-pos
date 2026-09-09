/**
 * Format raw bytes into human-readable unit string (e.g. 0 B, 820 B, 1.2 KB, 664 KB, 1.21 MB, 2.4 GB).
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  if (i === 0) return `${Math.round(bytes)} B`;

  const val = bytes / Math.pow(k, i);
  let formatted: string;
  if (val < 10) {
    formatted = val.toFixed(2).replace(/\.?0+$/, '');
  } else if (val < 100) {
    formatted = val.toFixed(1).replace(/\.?0+$/, '');
  } else {
    formatted = Math.round(val).toString();
  }

  return `${formatted} ${sizes[i]}`;
}
