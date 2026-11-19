import type { StorageObject } from '../types';
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const n = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4);
  return `${(bytes / 1024 ** n).toFixed(n === 0 ? 0 : 1)} ${['B', 'KB', 'MB', 'GB', 'TB'][n]}`;
}
export function extension(name: string) {
  return name.split('.').pop()?.toLowerCase() ?? '';
}
export function objectType(object: StorageObject) {
  if (object.kind === 'folder') return 'folder';
  const ext = extension(object.name);
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp'].includes(ext)) return 'image';
  if (['json', 'js', 'ts', 'html', 'css', 'xml', 'yaml', 'yml'].includes(ext)) return 'code';
  if (['zip', 'gz', 'tar', '7z', 'rar'].includes(ext)) return 'archive';
  if (['mp4', 'mov', 'webm'].includes(ext)) return 'video';
  if (ext === 'pdf') return 'pdf';
  return 'text';
}
export function sortObjects(
  objects: StorageObject[],
  field: 'name' | 'size' | 'lastModified',
  ascending: boolean,
) {
  return [...objects].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    const order =
      field === 'size'
        ? a.size - b.size
        : a[field].localeCompare(b[field], 'zh-CN', { numeric: true });
    return ascending ? order : -order;
  });
}
export function folderNameError(name: string): string | undefined {
  if (!name.trim()) return '请输入文件夹名称';
  if (/[\\/\x00-\x1f]/.test(name) || name === '.' || name === '..')
    return '名称不能包含斜线、控制字符或使用 . 和 ..';
  if (new TextEncoder().encode(name).length > 255) return '名称过长，请控制在 255 字节以内';
}
export function dateLabel(date: string) {
  if (!date) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(date));
}
