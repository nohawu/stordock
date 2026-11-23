import type {
  Bucket,
  Connection,
  ListRequest,
  ListResult,
  Preview,
  StorageBridge,
  StorageObject,
  Transfer,
  UploadItem,
} from '../types';
import { folderNameError } from './objects';
import { DemoTasks } from './transfers';

export const DEMO_ID = 'demo-studio';
export const demoConnection: Connection = {
  id: DEMO_ID,
  name: '设计工作空间',
  provider: 'aliyun',
  region: 'cn-hangzhou',
  endpoint: '',
  bucket: '',
  accessKeyId: '',
  hasSecret: false,
};
export const landscape = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 850"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#dce9e5"/><stop offset="1" stop-color="#f1edda"/></linearGradient><linearGradient id="hill" x2="0.3" y2="1"><stop stop-color="#587f70"/><stop offset="1" stop-color="#28584d"/></linearGradient><linearGradient id="front" x2="0" y2="1"><stop stop-color="#b6bf86"/><stop offset="1" stop-color="#789c77"/></linearGradient></defs><path fill="url(#sky)" d="M0 0h1200v850H0z"/><circle cx="860" cy="205" r="67" fill="#faf8e9"/><path d="M0 460Q190 280 420 445T870 430T1200 350V850H0" fill="#a3b6a1"/><path d="M0 585Q190 335 430 480T790 505T1200 390V850H0" fill="url(#hill)"/><path d="M0 690Q260 490 590 635T1200 570V850H0" fill="url(#front)"/><path d="M820 850Q610 730 720 642Q800 592 672 550Q615 528 640 509Q681 547 739 560Q875 602 786 661Q689 741 1015 850" fill="#ece6c9"/><g fill="#214e43"><path d="m109 657 17-85 17 85h-11v28h-12v-28zm58-30 12-62 13 62h-9v21h-9v-21zm858-52 14-80 15 80h-10v24h-10v-24z"/></g><text x="65" y="92" fill="#416457" font-family="Arial,sans-serif" font-size="20" letter-spacing="6">A LITTLE ROOM TO BREATHE.</text><text x="65" y="793" fill="#edf0dc" font-family="Arial,sans-serif" font-size="16" letter-spacing="3">STUDIO / COLLECTION 026</text></svg>`;
export const secondLandscape = landscape
  .replaceAll('#dce9e5', '#e5e0ed')
  .replaceAll('#587f70', '#8c829f')
  .replaceAll('#28584d', '#615d80')
  .replaceAll('#b6bf86', '#c1b2c4')
  .replaceAll('#789c77', '#9a88ac')
  .replace('A LITTLE ROOM TO BREATHE.', 'MAKE SPACE FOR NEW IDEAS.');
const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const today = '2026-11-19T02:30:00Z';
type DemoEntry = StorageObject & { content?: string; mime?: string };
const file = (
  key: string,
  size: number,
  content?: string,
  mime?: string,
  lastModified = today,
): DemoEntry => ({
  key,
  name: key.split('/').pop()!,
  kind: 'file',
  size:
    content !== undefined && !content.startsWith('data:')
      ? new TextEncoder().encode(content).length
      : size,
  lastModified,
  storageClass: 'Standard',
  etag: 'DEMO-9D402F8',
  content,
  mime,
});
const folder = (key: string): DemoEntry => ({
  key,
  name: key.split('/').filter(Boolean).pop()!,
  kind: 'folder',
  size: 0,
  lastModified: '',
  storageClass: '',
});
const defaults: Record<string, DemoEntry[]> = {
  'studio-assets': [
    folder('brand/'),
    folder('design/'),
    folder('documents/'),
    folder('images/'),
    file(
      'cover-landscape.svg',
      new TextEncoder().encode(landscape).length,
      landscape,
      'image/svg+xml',
    ),
    file(
      'design-tokens.json',
      826,
      JSON.stringify(
        {
          name: 'Studio Design System',
          version: '1.0.0',
          colors: { primary: '#2D6A58', surface: '#F7F8FA', ink: '#263831' },
          spacing: [4, 8, 12, 16, 24, 32],
          typography: { family: 'Inter', scale: [12, 14, 16, 24, 32] },
        },
        null,
        2,
      ),
      'text/plain',
    ),
    file(
      'README.md',
      1248,
      '# 欢迎来到 StorDock\n\n给你的云端文件，一个井然有序的家。\n\n## 开始探索\n\n- 双击文件夹，浏览目录\n- 点击文件，在右侧查看预览与详细信息\n- 搜索当前路径及子目录中的文件\n- 拖入文件，或点击「上传文件」\n- 勾选多个文件，即可批量下载\n\n这里是本地演示空间，所有操作不会影响真实云端数据。\n新增阿里云连接后，可以访问真实存储桶。\n\n图片预览上限 10 MB，文本预览上限 1 MB。',
      'text/plain',
    ),
    file(
      'release-notes.md',
      542,
      '# Release 0.1.0\n\n2026.11.19\n\n## 新功能\n\n连接管理、对象浏览、目录导航、搜索、图片与文本预览。\n多文件上传、批量下载、传输进度、系统凭据加密。',
      'text/plain',
      '2026-11-18T09:12:00Z',
    ),
    file(
      'brand/guidelines.md',
      980,
      '# Studio Brand\n\n保持清晰，留白，专注内容。\n\n主色：森林绿 #2D6A58\n辅助色：鼠尾草绿 #DDE7DC\n字体：Inter / 系统无衬线',
      'text/plain',
    ),
    file(
      'brand/logo.svg',
      384,
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" rx="80" fill="#245e4f"/><path d="m200 85 105 60v110l-105 60-105-60V145zm0 0v120m105-60-105 60-105-60m105 60v110" fill="none" stroke="#d6f3bd" stroke-width="12" stroke-linejoin="round"/></svg>',
      'image/svg+xml',
    ),
    file(
      'design/components.json',
      230,
      JSON.stringify(
        { components: ['Button', 'Input', 'Card', 'Dialog', 'Table'], status: 'ready' },
        null,
        2,
      ),
      'text/plain',
    ),
    file(
      'documents/onboarding.md',
      320,
      '# 团队快速入门\n\n1. 新建连接并测试\n2. 选择存储桶\n3. 上传或下载你的文件\n\n请使用最小权限的 RAM 用户凭据连接。',
      'text/plain',
    ),
    file(
      'images/morning-hills.svg',
      new TextEncoder().encode(landscape).length,
      landscape,
      'image/svg+xml',
      '2026-11-18T08:21:00Z',
    ),
    file(
      'images/quiet-afternoon.svg',
      new TextEncoder().encode(secondLandscape).length,
      secondLandscape,
      'image/svg+xml',
      '2026-11-17T11:05:00Z',
    ),
  ],
  'project-backups': [
    folder('2026/'),
    file(
      '2026/manifest.json',
      248,
      '{\n  "project": "studio",\n  "version": "2026.11",\n  "status": "archived"\n}',
      'text/plain',
    ),
  ],
  'public-resources': [
    file('hello.txt', 32, 'Hello, StorDock!\n欢迎来到公共资源空间。', 'text/plain'),
  ],
};
function loadData() {
  try {
    const saved = localStorage.getItem('ossdesk-demo-v1');
    if (saved) return JSON.parse(saved) as Record<string, DemoEntry[]>;
  } catch {}
  return structuredClone(defaults);
}
let data = loadData();
const listeners = new Set<(t: Transfer) => void>();
function persist() {
  const raw = JSON.stringify(data);
  if (raw.length > 8_000_000) throw new Error('演示空间已满，请使用桌面客户端连接真实 OSS');
  localStorage.setItem('ossdesk-demo-v1', raw);
}
const emit = (transfer: Transfer) => listeners.forEach((l) => l({ ...transfer }));
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const tasks = new DemoTasks(emit);
const plans = new Map<
  string,
  {
    bucket: string;
    operation: 'copy' | 'move' | 'rename' | 'delete';
    entries: DemoEntry[];
    targets: string[];
  }
>();
function selectedEntries(bucket: string, objects: StorageObject[]) {
  return data[bucket].filter((entry) =>
    objects.some(
      (object) =>
        entry.key === object.key || (object.kind === 'folder' && entry.key.startsWith(object.key)),
    ),
  );
}
function ensureDemoFolders(bucket: string, key: string) {
  const parts = key.replace(/\/$/, '').split('/');
  parts.pop();
  let prefix = '';
  for (const part of parts) {
    prefix += part + '/';
    if (!data[bucket].some((entry) => entry.key === prefix)) data[bucket].push(folder(prefix));
  }
}
export const demo: Pick<
  StorageBridge,
  | 'buckets'
  | 'list'
  | 'preview'
  | 'objectInfo'
  | 'upload'
  | 'download'
  | 'createFolder'
  | 'onTransfer'
  | 'prepareOperation'
  | 'executeOperation'
  | 'cancelTransfer'
  | 'retryTransfer'
  | 'clearTransfers'
> = {
  async buckets(): Promise<Bucket[]> {
    return Object.keys(data).map((name) => ({ name, region: 'cn-hangzhou' }));
  },
  async list(request: ListRequest): Promise<ListResult> {
    await pause(120);
    const entries = data[request.bucket] || [];
    const result = entries.filter((o) => {
      if (!o.key.startsWith(request.prefix) || o.key === request.prefix) return false;
      if (request.query)
        return o.kind === 'file' && o.key.toLowerCase().includes(request.query.toLowerCase());
      return !o.key.slice(request.prefix.length).replace(/\/$/, '').includes('/');
    });
    return {
      objects: result.map(({ content: _, mime: __, ...o }) => ({
        ...o,
        name: request.query ? o.key.slice(request.prefix.length) : o.name,
      })),
      scanned: entries.length,
    };
  },
  async preview(_id, bucket, object): Promise<Preview> {
    await pause(80);
    const entry = data[bucket]?.find((o) => o.key === object.key);
    if (!entry) throw new Error('文件已不存在');
    if (entry.mime?.startsWith('image/'))
      return {
        kind: 'image',
        content: entry.content?.startsWith('data:') ? entry.content : svgUrl(entry.content!),
        mime: entry.mime,
        size: entry.size,
      };
    if (entry.content !== undefined && entry.mime === 'text/plain')
      return { kind: 'text', content: entry.content, size: entry.size };
    return { kind: 'unsupported', size: entry.size };
  },
  async objectInfo(_id, bucket, key) {
    const entry = data[bucket]?.find((item) => item.key === key);
    if (!entry) throw new Error('文件已不存在');
    return {
      size: entry.size,
      lastModified: entry.lastModified,
      etag: entry.etag,
      storageClass: entry.storageClass,
      contentType: entry.mime,
      metadata: {},
    };
  },
  async createFolder(_id, bucket, prefix, name) {
    const error = folderNameError(name);
    if (error) throw new Error(error);
    const key = `${prefix}${name.trim()}/`;
    if (data[bucket].some((o) => o.key === key)) throw new Error('同名文件夹已存在');
    data[bucket].push(folder(key));
    persist();
  },
  async upload(_id, bucket, prefix, items, conflict = 'reject') {
    const summary = { completed: 0, failed: 0, skipped: 0, cancelled: 0 };
    for (const item of items) {
      const result = await tasks.run(
        {
          name: item.relativePath || item.name,
          size: item.file?.size || 0,
          bucket,
          direction: 'upload',
        },
        async (signal, report) => {
          signal.throwIfAborted();
          if (item.directory) {
            const key = prefix + item.relativePath;
            if (!data[bucket].some((entry) => entry.key === key)) {
              ensureDemoFolders(bucket, key);
              data[bucket].push(folder(key));
              persist();
            }
            return;
          }
          if (!item.file) throw new Error('演示空间请通过浏览器选择文件');
          if (item.file.size > 2_000_000)
            throw new Error('演示空间单文件限制为 2 MB，真实 OSS 不受此限制');
          let key = `${prefix}${item.relativePath || item.name}`;
          if (
            /[\\\x00-\x1f]/.test(key) ||
            key.split('/').some((part) => !part || part === '.' || part === '..')
          )
            throw new Error('文件相对路径无效');
          if (data[bucket].some((o) => o.key === key)) {
            if (conflict === 'skip') return 'skipped';
            if (conflict === 'rename') {
              const original = key;
              const slash = key.lastIndexOf('/');
              const dot = key.lastIndexOf('.');
              const split = dot > slash + 1 ? dot : key.length;
              let index = 1;
              do {
                key = `${original.slice(0, split)} (${index++})${original.slice(split)}`;
              } while (data[bucket].some((o) => o.key === key));
            } else if (conflict !== 'overwrite') throw new Error('同名文件已存在，本次上传未覆盖');
          }
          const content = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = reject;
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(item.file!);
          });
          for (const progress of [25, 60, 100]) {
            await pause(110);
            signal.throwIfAborted();
            report({ progress });
          }
          const mime = item.file.type;
          const textFile =
            /^(text\/|application\/(json|xml|javascript))/.test(mime) ||
            /\.(md|txt|json|csv|log|yaml|yml)$/i.test(item.name);
          const entry = file(
            key,
            item.file.size,
            textFile ? await item.file.text() : content,
            textFile ? 'text/plain' : mime,
            new Date().toISOString(),
          );
          const previous = [...data[bucket]];
          data[bucket] = data[bucket].filter((object) => object.key !== key);
          ensureDemoFolders(bucket, key);
          data[bucket].push(entry);
          try {
            persist();
          } catch (e) {
            data[bucket] = previous;
            throw e;
          }
        },
      );
      if (
        result.status === 'completed' ||
        result.status === 'failed' ||
        result.status === 'skipped' ||
        result.status === 'cancelled'
      )
        summary[result.status]++;
    }
    return summary;
  },
  async download(_id, bucket, objects) {
    for (const object of selectedEntries(bucket, objects).filter(
      (entry) => entry.kind === 'file',
    )) {
      if (window.ossDesk?.saveDemoDownload) {
        const entry = data[bucket].find((item) => item.key === object.key);
        if (!entry || entry.content === undefined) throw new Error('此文件没有可下载内容');
        const bytes = entry.content.startsWith('data:')
          ? Uint8Array.from(atob(entry.content.split(',')[1]), (character) =>
              character.charCodeAt(0),
            )
          : new TextEncoder().encode(entry.content);
        await window.ossDesk.saveDemoDownload(bucket, object.key, bytes.buffer);
        continue;
      }
      await tasks.run(
        { name: object.name, size: object.size, bucket, direction: 'download' },
        async (signal) => {
          await pause(200);
          signal.throwIfAborted();
          const entry = data[bucket].find((o) => o.key === object.key);
          if (!entry || entry.content === undefined) throw new Error('此文件没有可下载内容');
          const blob = entry.content.startsWith('data:')
            ? new Blob(
                [Uint8Array.from(atob(entry.content.split(',')[1]), (c) => c.charCodeAt(0))],
                {
                  type: entry.mime,
                },
              )
            : new Blob([entry.content], { type: entry.mime || 'application/octet-stream' });
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = object.key.split('/').pop()!;
          anchor.click();
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
        },
      );
    }
  },
  async prepareOperation(_id, bucket, objects, operation, target = '') {
    if (!['copy', 'move', 'rename', 'delete'].includes(operation)) throw new Error('操作无效');
    if (operation === 'rename' && objects.length !== 1) throw new Error('每次只能重命名一项');
    if (
      operation !== 'delete' &&
      (target.startsWith('/') ||
        /[\\\x00-\x1f]/.test(target) ||
        target.split('/').some((part) => part === '.' || part === '..'))
    )
      throw new Error('目标路径无效');
    const roots = objects.filter(
      (object) =>
        !objects.some(
          (other) =>
            other.kind === 'folder' && other.key !== object.key && object.key.startsWith(other.key),
        ),
    );
    const entries = selectedEntries(bucket, roots).map((entry) => ({ ...entry }));
    const targets = entries.map((entry) => {
      const root = roots.find(
        (object) =>
          entry.key === object.key ||
          (object.kind === 'folder' && entry.key.startsWith(object.key)),
      )!;
      const base =
        operation === 'rename'
          ? target
          : target +
            root.key.replace(/\/$/, '').split('/').pop() +
            (root.kind === 'folder' ? '/' : '');
      if (
        operation !== 'delete' &&
        (base === root.key || (root.kind === 'folder' && base.startsWith(root.key)))
      )
        throw new Error('目标不能是原路径或源文件夹的子目录');
      return base + entry.key.slice(root.key.length);
    });
    if (operation !== 'delete' && new Set(targets).size !== targets.length)
      throw new Error('目标名称重复，请分开操作');
    const id = `demo-plan-${crypto.randomUUID()}`;
    if (plans.size >= 20) plans.delete(plans.keys().next().value!);
    plans.set(id, { bucket, operation, entries, targets });
    return { id, count: entries.length, size: entries.reduce((sum, entry) => sum + entry.size, 0) };
  },
  async executeOperation(id) {
    const plan = plans.get(id);
    plans.delete(id);
    if (!plan) throw new Error('确认已过期，请重新操作');
    const { bucket, operation, entries, targets } = plan;
    return tasks.run(
      {
        name: `${operation === 'delete' ? '删除' : operation === 'copy' ? '复制' : '移动'} ${entries.length} 个对象`,
        direction: operation === 'rename' ? 'move' : operation,
        bucket,
        size: entries.reduce((sum, entry) => sum + entry.size, 0),
      },
      async (signal, report) => {
        await pause(150);
        signal.throwIfAborted();
        for (let index = 0; index < entries.length; index++) {
          const source = data[bucket].find((entry) => entry.key === entries[index].key);
          if (
            !source ||
            source.content !== entries[index].content ||
            source.lastModified !== entries[index].lastModified
          )
            throw new Error('源对象已变化，请刷新后重新操作');
          if (operation !== 'delete' && data[bucket].some((entry) => entry.key === targets[index]))
            throw new Error('目标已存在，未覆盖；源对象保留');
        }
        const previous = [...data[bucket]];
        if (operation !== 'copy')
          data[bucket] = data[bucket].filter(
            (entry) => !entries.some((source) => source.key === entry.key),
          );
        if (operation !== 'delete')
          entries.forEach((entry, index) => {
            ensureDemoFolders(bucket, targets[index]);
            data[bucket].push({
              ...entry,
              key: targets[index],
              name: targets[index].replace(/\/$/, '').split('/').pop()!,
              lastModified: new Date().toISOString(),
            });
          });
        try {
          persist();
          report({ progress: 100 });
        } catch (error) {
          data[bucket] = previous;
          throw error;
        }
      },
    );
  },
  cancelTransfer: (id) => tasks.cancel(id),
  retryTransfer: (id) => tasks.retry(id),
  clearTransfers: () => tasks.clear(),
  onTransfer(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
export const demoThumbnail = (key: string) =>
  key.includes('quiet')
    ? svgUrl(secondLandscape)
    : key.endsWith('.svg') && !key.includes('logo')
      ? svgUrl(landscape)
      : undefined;
