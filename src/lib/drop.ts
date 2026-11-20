import type { UploadItem } from '../types';
export async function readDroppedItems(items: DataTransferItemList): Promise<UploadItem[]> {
  const roots = Array.from(items).map((item) => ({
    entry: item.webkitGetAsEntry?.(),
    file: item.getAsFile(),
  }));
  const result: UploadItem[] = [];
  async function visit(entry: FileSystemEntry, parent = ''): Promise<void> {
    const relativePath = parent + entry.name;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      result.push({ name: file.name, file, relativePath });
    } else {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      let children: FileSystemEntry[];
      let empty = true;
      do {
        children = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (children.length) empty = false;
        for (const child of children) await visit(child, relativePath + '/');
      } while (children.length);
      if (empty)
        result.push({ name: entry.name, relativePath: relativePath + '/', directory: true });
    }
    if (result.length > 100000) throw new Error('单次最多上传 100000 项，请分目录处理');
  }
  for (const root of roots) {
    if (root.entry) await visit(root.entry);
    else if (root.file) result.push({ name: root.file.name, file: root.file });
  }
  return result;
}
