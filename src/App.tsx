import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Box,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cloud,
  Database,
  Download,
  Files,
  FolderOpen,
  FolderPlus,
  HardDrive,
  HelpCircle,
  LayoutGrid,
  List,
  Loader2,
  LockKeyhole,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { Bucket, Connection, Preview, StorageObject, Transfer, UploadItem } from './types';
import { storage } from './lib/storage';
import { demoConnection, demoThumbnail, DEMO_ID } from './lib/demo';
import { dateLabel, folderNameError, formatBytes, objectType, sortObjects } from './lib/objects';
import { ConnectionDialog } from './components/ConnectionDialog';
import { Modal } from './components/Modal';
import { ObjectIcon } from './components/ObjectIcon';
import { PreviewPanel } from './components/PreviewPanel';
import { Transfers } from './components/Transfers';

type WorkspaceTab = {
  id: string;
  connectionId: string;
  bucket: string;
  region: string;
  prefix: string;
  query: string;
  history: string[];
  position: number;
};
const initialTab: WorkspaceTab = {
  id: `${DEMO_ID}/studio-assets`,
  connectionId: DEMO_ID,
  bucket: 'studio-assets',
  region: 'cn-hangzhou',
  prefix: '',
  query: '',
  history: [''],
  position: 0,
};
const errorMessage = (e: unknown) =>
  e instanceof Error
    ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : '操作失败，请重试';
const classLabel = (s: string) =>
  ({ Standard: '标准存储', IA: '低频访问', Archive: '归档存储', ColdArchive: '冷归档' })[s] || s;
export default function App() {
  const [connections, setConnections] = useState<Connection[]>([demoConnection]);
  const [bucketMap, setBucketMap] = useState<Record<string, Bucket[]>>({});
  const [expanded, setExpanded] = useState(new Set([DEMO_ID]));
  const [bucketLoading, setBucketLoading] = useState<string>();
  const [tabs, setTabs] = useState<WorkspaceTab[]>([initialTab]);
  const [activeId, setActiveId] = useState(initialTab.id);
  const [page, setPage] = useState<'files' | 'transfers'>('files');
  const [objects, setObjects] = useState<StorageObject[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [scanned, setScanned] = useState(0);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState('cover-landscape.svg');
  const [checked, setChecked] = useState(new Set<string>());
  const [inspector, setInspector] = useState(true);
  const [preview, setPreview] = useState<Preview>();
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [layout, setLayout] = useState<'list' | 'grid'>(() =>
    localStorage.getItem('ossdesk-layout') === 'grid' ? 'grid' : 'list',
  );
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState<{ field: 'name' | 'size' | 'lastModified'; ascending: boolean }>(
    { field: 'name', ascending: true },
  );
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [modal, setModal] = useState<
    'connection' | 'folder' | 'settings' | 'help' | 'command' | null
  >(null);
  const [folderName, setFolderName] = useState('');
  const [folderError, setFolderError] = useState('');
  const [folderBusy, setFolderBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean }>();
  const [commandQuery, setCommandQuery] = useState('');
  const [theme, setTheme] = useState(() => localStorage.getItem('ossdesk-theme') || 'light');
  const [compact, setCompact] = useState(() => localStorage.getItem('ossdesk-compact') === 'true');
  const [removeId, setRemoveId] = useState<string>();
  const [connectionMenu, setConnectionMenu] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const dragDepth = useRef(0);
  const current = tabs.find((t) => t.id === activeId);
  const connection = connections.find((c) => c.id === current?.connectionId);
  const isDemo = current?.connectionId === DEMO_ID;
  const selectedObject = objects.find((o) => o.key === selected && o.kind === 'file');
  const running = transfers.filter((t) => t.status === 'running').length;
  const notify = useCallback((text: string, error = false) => setToast({ text, error }), []);
  useEffect(() => {
    const h = setTimeout(() => setToast(undefined), 5000);
    return () => clearTimeout(h);
  }, [toast]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('ossdesk-theme', theme);
  }, [theme]);
  useEffect(() => {
    localStorage.setItem('ossdesk-layout', layout);
  }, [layout]);
  useEffect(() => {
    localStorage.setItem('ossdesk-compact', String(compact));
  }, [compact]);
  useEffect(() => {
    let alive = true;
    storage
      .connections()
      .then((c) => {
        if (alive) setConnections(c);
      })
      .catch((e) => notify(errorMessage(e), true));
    storage.buckets(DEMO_ID).then((b) => {
      if (alive) setBucketMap((m) => ({ ...m, [DEMO_ID]: b }));
    });
    return () => {
      alive = false;
    };
  }, [notify]);
  useEffect(
    () =>
      storage.onTransfer((t) =>
        setTransfers((prev) => {
          const index = prev.findIndex((p) => p.id === t.id);
          if (index < 0) return [t, ...prev].slice(0, 200);
          const next = [...prev];
          next[index] = t;
          return next;
        }),
      ),
    [],
  );
  useEffect(() => {
    function keyboard(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setModal('command');
        setCommandQuery('');
      }
      if (
        e.key === '/' &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !document.querySelector('dialog[open]')
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) {
        setChecked(new Set());
        setConnectionMenu(undefined);
      }
    }
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, []);
  useEffect(() => {
    const id = ++requestId.current;
    setChecked(new Set());
    setListError('');
    setCursor(undefined);
    setObjects([]);
    setScanned(0);
    setLoading(!!current);
    setFilter('all');
    if (!current) {
      setLoading(false);
      return;
    }
    let alive = true;
    const timer = setTimeout(
      async () => {
        try {
          const result = await storage.list({
            connectionId: current.connectionId,
            bucket: current.bucket,
            prefix: current.prefix,
            query: current.query.trim(),
          });
          if (alive && requestId.current === id) {
            setObjects(result.objects);
            setCursor(result.cursor);
            setScanned(result.scanned || 0);
          }
        } catch (e) {
          if (alive) setListError(errorMessage(e));
        } finally {
          if (alive) setLoading(false);
        }
      },
      current.query ? 300 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [current?.connectionId, current?.bucket, current?.prefix, current?.query, revision]);
  useEffect(() => {
    let alive = true;
    setPreview(undefined);
    setPreviewError('');
    if (!selectedObject || !current || !inspector) {
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    storage
      .preview(current.connectionId, current.bucket, selectedObject)
      .then((p) => {
        if (alive) setPreview(p);
      })
      .catch((e) => {
        if (alive) setPreviewError(errorMessage(e));
      })
      .finally(() => {
        if (alive) setPreviewLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [
    selectedObject?.key,
    selectedObject?.etag,
    selectedObject?.lastModified,
    current?.connectionId,
    current?.bucket,
    inspector,
    revision,
  ]);
  const visibleObjects = useMemo(
    () =>
      sortObjects(
        objects.filter(
          (o) =>
            filter === 'all' ||
            (filter === 'image'
              ? objectType(o) === 'image'
              : filter === 'document'
                ? ['text', 'code', 'pdf'].includes(objectType(o)) && o.kind === 'file'
                : o.kind === 'folder'),
        ),
        sort.field,
        sort.ascending,
      ),
    [objects, filter, sort],
  );
  const files = objects.filter((o) => o.kind === 'file');
  const selectedFiles = files.filter((o) => checked.has(o.key));
  const visibleFiles = visibleObjects.filter((o) => o.kind === 'file');
  const allChecked = visibleFiles.length > 0 && visibleFiles.every((o) => checked.has(o.key));
  function updateTab(patch: Partial<WorkspaceTab>) {
    setTabs((prev) => prev.map((t) => (t.id === activeId ? { ...t, ...patch } : t)));
  }
  function navigate(prefix: string) {
    if (!current) return;
    updateTab({
      prefix,
      query: '',
      history: [...current.history.slice(0, current.position + 1), prefix],
      position: current.position + 1,
    });
    setSelected('');
  }
  function goHistory(delta: number) {
    if (!current) return;
    const position = current.position + delta;
    if (position >= 0 && position < current.history.length) {
      updateTab({ prefix: current.history[position], query: '', position });
      setSelected('');
    }
  }
  function openBucket(connectionId: string, bucket: Bucket) {
    const id = `${connectionId}/${bucket.name}`;
    setTabs((prev) =>
      prev.some((t) => t.id === id)
        ? prev
        : [
            ...prev,
            {
              id,
              connectionId,
              bucket: bucket.name,
              region: bucket.region,
              prefix: '',
              query: '',
              history: [''],
              position: 0,
            },
          ],
    );
    setActiveId(id);
    setPage('files');
    setSelected('');
    setChecked(new Set());
    setConnectionMenu(undefined);
  }
  function closeTab(id: string) {
    const remaining = tabs.filter((t) => t.id !== id);
    setTabs(remaining);
    if (activeId === id) setActiveId(remaining.at(-1)?.id || '');
    setSelected('');
  }
  async function expandConnection(id: string, force = false) {
    setConnectionMenu(undefined);
    const next = new Set(expanded);
    if (next.has(id) && !force) {
      next.delete(id);
      setExpanded(next);
      return;
    }
    next.add(id);
    setExpanded(next);
    setBucketLoading(id);
    try {
      const buckets = await storage.buckets(id);
      setBucketMap((prev) => ({ ...prev, [id]: buckets }));
      return buckets;
    } catch (e) {
      notify(errorMessage(e), true);
    } finally {
      setBucketLoading(undefined);
    }
  }
  async function saveConnection(c: Connection) {
    setConnections((prev) => [...prev.filter((p) => p.id !== c.id), c]);
    setModal(null);
    const buckets = await expandConnection(c.id, true);
    if (buckets?.[0]) openBucket(c.id, buckets[0]);
    notify('连接已保存');
  }
  async function removeConnection() {
    if (!removeId) return;
    try {
      await storage.removeConnection(removeId);
      setConnections((prev) => prev.filter((c) => c.id !== removeId));
      setTabs((prev) => prev.filter((t) => t.connectionId !== removeId));
      if (tabs.find((t) => t.id === activeId)?.connectionId === removeId)
        setActiveId(tabs.find((t) => t.connectionId !== removeId)?.id || '');
      setRemoveId(undefined);
      notify('连接已移除');
    } catch (e) {
      notify(errorMessage(e), true);
    }
  }
  async function loadMore() {
    if (!current || !cursor || moreLoading) return;
    const id = requestId.current;
    setMoreLoading(true);
    try {
      const result = await storage.list({
        connectionId: current.connectionId,
        bucket: current.bucket,
        prefix: current.prefix,
        query: current.query.trim(),
        cursor,
      });
      if (id === requestId.current) {
        setObjects((prev) => [
          ...new Map([...prev, ...result.objects].map((o) => [o.key, o])).values(),
        ]);
        setCursor(result.cursor);
        setScanned((p) => p + (result.scanned || 0));
      }
    } catch (e) {
      notify(errorMessage(e), true);
    } finally {
      setMoreLoading(false);
    }
  }
  function toggleChecked(key: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }
  function selectObject(o: StorageObject) {
    if (o.kind === 'file') {
      setSelected(o.key);
      setInspector(true);
    }
  }
  async function download(items: StorageObject[]) {
    if (!current || !items.length || downloadBusy) return;
    setDownloadBusy(true);
    try {
      await storage.download(current.connectionId, current.bucket, items);
    } catch (e) {
      notify(errorMessage(e), true);
    } finally {
      setDownloadBusy(false);
    }
  }
  async function upload(items: UploadItem[]) {
    if (!current || !items.length || uploadBusy) return;
    setUploadBusy(true);
    try {
      await storage.upload(current.connectionId, current.bucket, current.prefix, items);
      setRevision((r) => r + 1);
      notify('上传任务已处理，可在传输中心查看结果');
    } catch (e) {
      notify(errorMessage(e), true);
    } finally {
      setUploadBusy(false);
    }
  }
  async function pickUpload() {
    if (!current) return;
    if (isDemo || !window.ossDesk) {
      inputRef.current?.click();
      return;
    }
    try {
      await upload(await storage.pickUpload());
    } catch (e) {
      notify(errorMessage(e), true);
    }
  }
  function droppedFiles(list: FileList | File[]) {
    void upload(
      Array.from(list).map((file) => ({
        name: file.name,
        file,
        path: !isDemo ? window.ossDesk?.filePath(file) : undefined,
      })),
    );
  }
  async function createFolder() {
    if (!current) return;
    const name = folderName.trim();
    const error = folderNameError(name);
    if (error) {
      setFolderError(error);
      return;
    }
    setFolderBusy(true);
    try {
      await storage.createFolder(current.connectionId, current.bucket, current.prefix, name);
      setModal(null);
      setRevision((r) => r + 1);
      notify('文件夹已创建');
    } catch (e) {
      setFolderError(errorMessage(e));
    } finally {
      setFolderBusy(false);
    }
  }
  function changeSort(field: typeof sort.field) {
    setSort((s) => ({ field, ascending: s.field === field ? !s.ascending : true }));
  }
  const crumbs = current?.prefix.split('/').filter(Boolean) || [];
  return (
    <div
      className={`app-shell ${compact ? 'compact' : ''}`}
      onClick={() => connectionMenu && setConnectionMenu(undefined)}
    >
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage('files');
          }}
        >
          <span className="brand-mark">
            <Box size={25} strokeWidth={1.6} />
          </span>
          <span>
            Stor<span className="brand-light">Dock</span>
            <small>A SPACE FOR YOUR OBJECTS</small>
          </span>
          <span className="version-label">BETA</span>
        </a>
        <div className="workspace-switcher">
          <span className="workspace-avatar">S</span>
          <div>
            <strong>本地工作空间</strong>
            <small>你的云端，井然有序</small>
          </div>
          <LockKeyhole size={13} />
        </div>
        <div className="sidebar-label">工作台</div>
        <nav className="main-navigation">
          <button className={page === 'files' ? 'active' : ''} onClick={() => setPage('files')}>
            <Files size={17} />
            <span>文件浏览</span>
            <span className="nav-shortcut">01</span>
          </button>
          <button
            className={page === 'transfers' ? 'active' : ''}
            onClick={() => setPage('transfers')}
          >
            <ArrowDownToLine size={17} />
            <span>传输中心</span>
            {running ? (
              <span className="nav-count">{running}</span>
            ) : (
              <span className="nav-shortcut">02</span>
            )}
          </button>
        </nav>
        <div className="sidebar-label connection-label">
          存储连接 <span>{connections.length}</span>
          <button title="新建连接" aria-label="新建连接" onClick={() => setModal('connection')}>
            <Plus size={16} />
          </button>
        </div>
        <div className="connection-tree">
          {connections.map((c) => (
            <div className="connection-group" key={c.id}>
              <div className={`connection-item ${expanded.has(c.id) ? 'expanded' : ''}`}>
                <button
                  className="connection-expand"
                  onClick={() => expandConnection(c.id)}
                  aria-expanded={expanded.has(c.id)}
                >
                  {bucketLoading === c.id ? (
                    <Loader2 size={12} className="spin" />
                  ) : expanded.has(c.id) ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                  <span className="cloud-provider">
                    <Cloud size={17} />
                  </span>
                  <span className="connection-name">{c.name}</span>
                  {c.id === DEMO_ID && <span className="demo-mini">DEMO</span>}
                </button>
                {c.id !== DEMO_ID && (
                  <button
                    className="tree-more"
                    aria-label={`${c.name}连接菜单`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setConnectionMenu(connectionMenu === c.id ? undefined : c.id);
                    }}
                  >
                    <MoreHorizontal size={15} />
                  </button>
                )}
                {connectionMenu === c.id && (
                  <div className="connection-menu" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => expandConnection(c.id, true)}>
                      <RefreshCw size={13} />
                      刷新存储桶
                    </button>
                    <button
                      className="danger"
                      onClick={() => {
                        setRemoveId(c.id);
                        setConnectionMenu(undefined);
                      }}
                    >
                      <Trash2 size={13} />
                      移除连接
                    </button>
                  </div>
                )}
              </div>
              {expanded.has(c.id) && (
                <div className="bucket-tree">
                  {bucketMap[c.id]?.map((b) => (
                    <button
                      key={b.name}
                      title={`${b.name} · ${b.region}`}
                      className={
                        current?.connectionId === c.id && current.bucket === b.name ? 'active' : ''
                      }
                      onClick={() => openBucket(c.id, b)}
                    >
                      <Database size={14} strokeWidth={1.6} />
                      <span>{b.name}</span>
                      {current?.connectionId === c.id && current.bucket === b.name && (
                        <span className="tree-active-dot" />
                      )}
                    </button>
                  ))}
                  {bucketMap[c.id]?.length === 0 && (
                    <span className="tree-empty">没有可访问的存储桶</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        <button className="add-connection" onClick={() => setModal('connection')}>
          <Plus size={15} />
          新建存储连接
        </button>
        <div className="sidebar-bottom">
          <div className="local-note">
            <ShieldCheck size={17} />
            <div>
              <strong>本机安全存储</strong>
              <small>凭据由操作系统加密保护</small>
            </div>
            <span className="secure-dot" />
          </div>
          <div className="sidebar-utilities">
            <button onClick={() => setModal('settings')}>
              <Settings2 size={16} />
              偏好设置
            </button>
            <button aria-label="帮助与快捷键" title="帮助与快捷键" onClick={() => setModal('help')}>
              <HelpCircle size={17} />
            </button>
          </div>
          <div className="sidebar-bottom-caption">
            <span>STORDOCK</span>
            <span>v0.1.0</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-location">
            <span className="topbar-square">
              <Box size={13} />
            </span>
            工作空间
            <ChevronRight size={12} />
            <strong>{page === 'files' ? '对象存储' : '传输中心'}</strong>
          </div>
          <div className="topbar-right">
            <button
              className="command-trigger"
              onClick={() => {
                setCommandQuery('');
                setModal('command');
              }}
            >
              <Search size={13} />
              <span>快速跳转</span>
              <kbd>Ctrl K</kbd>
            </button>
            <div className="topbar-divider" />
            <span className="environment-badge">
              <span className="status-dot" />
              {window.ossDesk ? '桌面客户端' : '本地演示'}
            </span>
            <button
              className="profile-avatar"
              title="偏好设置"
              onClick={() => setModal('settings')}
            >
              S
            </button>
          </div>
        </header>
        <div className="workspace-tabs">
          <div className="tabs-scroll">
            {tabs.map((t) => (
              <div
                key={t.id}
                className={`workspace-tab ${activeId === t.id && page === 'files' ? 'active' : ''}`}
              >
                <button
                  className="tab-main"
                  onClick={() => {
                    setActiveId(t.id);
                    setPage('files');
                    setSelected('');
                  }}
                >
                  <Database size={13} />
                  <span>{t.bucket}</span>
                </button>
                <button
                  className="tab-close"
                  aria-label={`关闭 ${t.bucket} 标签`}
                  onClick={() => closeTab(t.id)}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            <button
              className="new-tab"
              title="新建连接"
              aria-label="新建工作区连接"
              onClick={() => setModal('connection')}
            >
              <Plus size={15} />
            </button>
          </div>
          <span className="tabs-hint">让每个对象，各得其所。</span>
        </div>
        <main className="content-shell">
          {page === 'transfers' ? (
            <Transfers
              transfers={transfers}
              onClear={() => setTransfers((prev) => prev.filter((t) => t.status === 'running'))}
            />
          ) : !current ? (
            <div className="large-empty no-workspace">
              <span className="empty-preview-icon">
                <Cloud size={36} />
              </span>
              <h2>连接你的云端空间</h2>
              <p>从左侧选择一个存储桶，或创建新的连接。</p>
              <button className="button primary" onClick={() => setModal('connection')}>
                <Plus size={15} />
                新建连接
              </button>
              <button
                className="button ghost"
                onClick={() =>
                  openBucket(DEMO_ID, { name: 'studio-assets', region: 'cn-hangzhou' })
                }
              >
                浏览演示空间
                <ArrowRight size={14} />
              </button>
            </div>
          ) : (
            <div className={`file-workspace ${inspector ? 'with-inspector' : ''}`}>
              <section
                className="explorer"
                onDragEnter={(e) => {
                  if (e.dataTransfer.types.includes('Files')) {
                    e.preventDefault();
                    dragDepth.current++;
                    setDragging(true);
                  }
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  dragDepth.current--;
                  if (dragDepth.current <= 0) {
                    setDragging(false);
                    dragDepth.current = 0;
                  }
                }}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes('Files')) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  dragDepth.current = 0;
                  if (e.dataTransfer.files.length) droppedFiles(e.dataTransfer.files);
                }}
              >
                <div className="explorer-top">
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">
                        OBJECT EXPLORER
                        <span className="eyebrow-line" />
                      </div>
                      <h1>
                        文件浏览<span className="heading-dot">.</span>
                      </h1>
                      <p>有序管理，轻松流转。你的云端文件，尽在眼前。</p>
                    </div>
                    <div className="page-actions">
                      <button
                        className="button secondary new-folder-button"
                        onClick={() => {
                          setFolderName('');
                          setFolderError('');
                          setModal('folder');
                        }}
                      >
                        <FolderPlus size={15} />
                        新建文件夹
                      </button>
                      <button className="button primary" disabled={uploadBusy} onClick={pickUpload}>
                        {uploadBusy ? <Loader2 size={15} className="spin" /> : <Upload size={15} />}
                        上传文件
                      </button>
                    </div>
                  </div>
                  <div className="bucket-overview">
                    <div className="bucket-overview-main">
                      <span className="bucket-symbol">
                        <Database size={22} strokeWidth={1.5} />
                      </span>
                      <div>
                        <div className="bucket-title">
                          {current.bucket}
                          <span className="connected-badge">
                            <span className="status-dot" />
                            {isDemo ? '演示空间' : '已连接'}
                          </span>
                        </div>
                        <div className="bucket-subtitle">
                          <Cloud size={12} />
                          {connection?.name || '阿里云 OSS'}
                          <i />
                          {current.region}
                          <i />
                          <LockKeyhole size={11} />
                          {isDemo ? '本地数据' : 'HTTPS'}
                        </div>
                      </div>
                    </div>
                    <div className="overview-metrics">
                      <div>
                        <span>当前目录</span>
                        <strong>
                          {loading ? '—' : objects.length}
                          <small>个对象{cursor ? '+' : ''}</small>
                        </strong>
                      </div>
                      <div>
                        <span>已加载文件</span>
                        <strong>
                          {loading ? '—' : formatBytes(files.reduce((sum, f) => sum + f.size, 0))}
                        </strong>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="browser-panel">
                  <div className="path-toolbar">
                    <div className="history-buttons">
                      <button
                        className="icon-button"
                        disabled={!current.position}
                        title="后退"
                        aria-label="后退"
                        onClick={() => goHistory(-1)}
                      >
                        <ArrowLeft size={15} />
                      </button>
                      <button
                        className="icon-button"
                        disabled={current.position === current.history.length - 1}
                        title="前进"
                        aria-label="前进"
                        onClick={() => goHistory(1)}
                      >
                        <ArrowRight size={15} />
                      </button>
                    </div>
                    <div className="breadcrumbs">
                      <button title="根目录" onClick={() => navigate('')}>
                        <HardDrive size={14} />
                        <span>{current.bucket}</span>
                      </button>
                      {crumbs.map((crumb, index) => (
                        <span className="crumb" key={index}>
                          <ChevronRight size={12} />
                          <button
                            onClick={() => navigate(`${crumbs.slice(0, index + 1).join('/')}/`)}
                          >
                            {crumb}
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="path-actions">
                      <button
                        className="icon-button"
                        aria-label="刷新文件"
                        title="刷新"
                        onClick={() => setRevision((r) => r + 1)}
                        disabled={loading}
                      >
                        <RefreshCw size={15} className={loading ? 'spin' : ''} />
                      </button>
                      <button
                        className={`icon-button ${inspector ? 'is-active' : ''}`}
                        title="切换详情面板"
                        aria-label="切换详情面板"
                        onClick={() => setInspector((v) => !v)}
                      >
                        <SlidersHorizontal size={15} />
                      </button>
                    </div>
                  </div>
                  <div className="file-toolbar">
                    <div className="filter-tabs">
                      {[
                        ['all', '全部文件'],
                        ['folder', '文件夹'],
                        ['image', '图片'],
                        ['document', '文档'],
                      ].map(([value, label]) => (
                        <button
                          key={value}
                          className={filter === value ? 'active' : ''}
                          onClick={() => setFilter(value)}
                        >
                          {label}
                          {value === 'all' && <span>{objects.length}</span>}
                        </button>
                      ))}
                    </div>
                    <div className="file-toolbar-right">
                      <label className="file-search">
                        <Search size={14} />
                        <input
                          ref={searchRef}
                          aria-label="搜索文件"
                          placeholder="搜索此路径及子目录…"
                          value={current.query}
                          onChange={(e) => updateTab({ query: e.target.value })}
                        />
                        {current.query ? (
                          <button aria-label="清除搜索" onClick={() => updateTab({ query: '' })}>
                            <X size={12} />
                          </button>
                        ) : (
                          <kbd>/</kbd>
                        )}
                      </label>
                      <div className="layout-switch">
                        <button
                          className={layout === 'list' ? 'active' : ''}
                          title="列表视图"
                          aria-label="列表视图"
                          onClick={() => setLayout('list')}
                        >
                          <List size={15} />
                        </button>
                        <button
                          className={layout === 'grid' ? 'active' : ''}
                          title="网格视图"
                          aria-label="网格视图"
                          onClick={() => setLayout('grid')}
                        >
                          <LayoutGrid size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                  {checked.size > 0 && (
                    <div className="selection-bar">
                      <span>
                        <CheckCircle2 size={15} />
                        已选择 <strong>{checked.size}</strong> 个文件
                      </span>
                      <button
                        className="button mini"
                        disabled={downloadBusy}
                        onClick={() => download(selectedFiles)}
                      >
                        <Download size={13} />
                        下载所选
                      </button>
                      <button
                        className="icon-button"
                        aria-label="取消选择"
                        onClick={() => setChecked(new Set())}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                  {current.query && (
                    <div className="search-summary">
                      <Search size={12} />
                      <span>
                        在「{current.prefix || current.bucket}」及子目录中搜索 “{current.query}”
                      </span>
                      {!loading && (
                        <small>
                          已扫描 {scanned} 个对象{cursor ? '，可继续扫描' : ''}
                        </small>
                      )}
                    </div>
                  )}
                  <div className="file-list-area">
                    {listError ? (
                      <div className="large-empty error-state">
                        <Cloud size={32} />
                        <h3>暂时无法读取存储桶</h3>
                        <p>{listError}</p>
                        <button
                          className="button secondary"
                          onClick={() => setRevision((r) => r + 1)}
                        >
                          <RefreshCw size={14} />
                          重新加载
                        </button>
                      </div>
                    ) : loading ? (
                      <div className="table-skeleton" aria-label="正在加载文件">
                        <div className="skeleton-head" />
                        {Array.from({ length: 7 }, (_, i) => (
                          <div className="skeleton-row" key={i}>
                            <i />
                            <span style={{ width: `${35 + (i % 3) * 12}%` }} />
                            <em />
                          </div>
                        ))}
                      </div>
                    ) : !visibleObjects.length ? (
                      <div className="large-empty">
                        <span className="empty-preview-icon">
                          {current.query ? (
                            <Search size={30} strokeWidth={1.3} />
                          ) : (
                            <FolderOpen size={32} strokeWidth={1.3} />
                          )}
                        </span>
                        <h3>
                          {current.query
                            ? '没有找到匹配文件'
                            : filter !== 'all'
                              ? '没有此类型的文件'
                              : '这里，等待一些新内容'}
                        </h3>
                        <p>
                          {current.query
                            ? cursor
                              ? '搜索按页扫描云端对象，继续扫描以查找更多结果。'
                              : '试试其他关键词，或返回上一级目录。'
                            : filter !== 'all'
                              ? '切换类型筛选，查看其他文件。'
                              : '拖入文件，或点击上传，让工作从这里开始。'}
                        </p>
                        {!current.query && filter === 'all' && (
                          <button className="button secondary" onClick={pickUpload}>
                            <Upload size={14} />
                            上传第一个文件
                          </button>
                        )}
                      </div>
                    ) : layout === 'list' ? (
                      <table className="objects-table">
                        <thead>
                          <tr>
                            <th className="checkbox-cell">
                              <input
                                aria-label="选择当前列表所有文件"
                                type="checkbox"
                                checked={allChecked}
                                disabled={!visibleFiles.length}
                                onChange={() =>
                                  setChecked((prev) => {
                                    const next = new Set(prev);
                                    visibleFiles.forEach((o) =>
                                      allChecked ? next.delete(o.key) : next.add(o.key),
                                    );
                                    return next;
                                  })
                                }
                              />
                            </th>
                            <th>
                              <button onClick={() => changeSort('name')}>
                                文件名称
                                {sort.field === 'name' ? (
                                  sort.ascending ? (
                                    <ArrowUp size={11} />
                                  ) : (
                                    <ArrowDown size={11} />
                                  )
                                ) : (
                                  <ChevronDown size={11} />
                                )}
                              </button>
                            </th>
                            <th className="size-column">
                              <button onClick={() => changeSort('size')}>
                                大小
                                {sort.field === 'size' &&
                                  (sort.ascending ? (
                                    <ArrowUp size={11} />
                                  ) : (
                                    <ArrowDown size={11} />
                                  ))}
                              </button>
                            </th>
                            <th className="storage-column">存储类型</th>
                            <th className="date-column">
                              <button onClick={() => changeSort('lastModified')}>
                                修改时间
                                {sort.field === 'lastModified' &&
                                  (sort.ascending ? (
                                    <ArrowUp size={11} />
                                  ) : (
                                    <ArrowDown size={11} />
                                  ))}
                              </button>
                            </th>
                            <th className="row-actions-column" />
                          </tr>
                        </thead>
                        <tbody>
                          {visibleObjects.map((o) => (
                            <tr
                              key={o.key}
                              className={`${selected === o.key ? 'selected' : ''} ${checked.has(o.key) ? 'checked-row' : ''}`}
                              onClick={() => selectObject(o)}
                              onDoubleClick={() => o.kind === 'folder' && navigate(o.key)}
                            >
                              <td className="checkbox-cell">
                                {o.kind === 'file' ? (
                                  <input
                                    type="checkbox"
                                    aria-label={`选择 ${o.name}`}
                                    checked={checked.has(o.key)}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={() => toggleChecked(o.key)}
                                  />
                                ) : (
                                  <span className="folder-indent" />
                                )}
                              </td>
                              <td className="name-cell">
                                <button
                                  title={o.key}
                                  onClick={() =>
                                    o.kind === 'folder' ? navigate(o.key) : selectObject(o)
                                  }
                                >
                                  <ObjectIcon object={o} />
                                  <span>{o.name}</span>
                                  {o.kind === 'folder' && (
                                    <ChevronRight className="folder-chevron" size={12} />
                                  )}
                                </button>
                              </td>
                              <td className="size-column">
                                {o.kind === 'folder' ? '—' : formatBytes(o.size)}
                              </td>
                              <td className="storage-column">
                                {o.kind === 'folder' ? (
                                  '—'
                                ) : (
                                  <span className="storage-class">
                                    {classLabel(o.storageClass)}
                                  </span>
                                )}
                              </td>
                              <td className="date-column">{dateLabel(o.lastModified)}</td>
                              <td className="row-actions-column">
                                {o.kind === 'file' ? (
                                  <button
                                    className="icon-button row-download"
                                    title="下载文件"
                                    aria-label={`下载 ${o.name}`}
                                    disabled={downloadBusy}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      download([o]);
                                    }}
                                  >
                                    <ArrowDownToLine size={14} />
                                  </button>
                                ) : (
                                  <ChevronRight size={13} />
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="objects-grid">
                        {visibleObjects.map((o) => (
                          <div
                            key={o.key}
                            className={`object-card ${selected === o.key ? 'selected' : ''}`}
                            onClick={() => selectObject(o)}
                            onDoubleClick={() => o.kind === 'folder' && navigate(o.key)}
                          >
                            <div
                              className={`object-card-art ${o.kind === 'folder' ? 'folder-art' : ''}`}
                            >
                              <button
                                className="card-open"
                                aria-label={`打开 ${o.name}`}
                                onClick={() =>
                                  o.kind === 'folder' ? navigate(o.key) : selectObject(o)
                                }
                              >
                                {isDemo && objectType(o) === 'image' && demoThumbnail(o.key) ? (
                                  <img src={demoThumbnail(o.key)} alt="" />
                                ) : (
                                  <ObjectIcon
                                    object={o}
                                    size={o.kind === 'folder' ? 44 : 35}
                                    boxed={false}
                                  />
                                )}
                              </button>
                              {o.kind === 'file' && (
                                <input
                                  className="card-checkbox"
                                  type="checkbox"
                                  aria-label={`选择 ${o.name}`}
                                  checked={checked.has(o.key)}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={() => toggleChecked(o.key)}
                                />
                              )}
                            </div>
                            <div className="object-card-caption">
                              <button
                                onClick={() =>
                                  o.kind === 'folder' ? navigate(o.key) : selectObject(o)
                                }
                                title={o.name}
                              >
                                {o.name}
                              </button>
                              <small>{o.kind === 'folder' ? '文件夹' : formatBytes(o.size)}</small>
                              {o.kind === 'file' && (
                                <button
                                  className="icon-button"
                                  aria-label={`下载 ${o.name}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    download([o]);
                                  }}
                                >
                                  <Download size={13} />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {!loading && cursor && (
                      <div className="load-more">
                        <button
                          className="button secondary"
                          disabled={moreLoading}
                          onClick={loadMore}
                        >
                          {moreLoading ? (
                            <Loader2 className="spin" size={14} />
                          ) : (
                            <ChevronDown size={14} />
                          )}{' '}
                          {current.query ? '继续扫描更多对象' : '加载更多'}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="list-footer">
                    <span>
                      {visibleObjects.length} 个对象
                      {filter !== 'all' && ` / ${objects.length} 个已加载`}
                      <i />
                      {files.length} 个文件{cursor ? ' · 还有更多' : ''}
                    </span>
                    <span>
                      <span className="tiny-key">↵</span>打开文件{' '}
                      <span className="footer-tip-separator" />
                      <Upload size={11} /> 拖放文件即可上传
                    </span>
                  </div>
                </div>
                <div className="explorer-note">
                  <ShieldCheck size={13} />
                  <span>
                    {isDemo
                      ? '这是一个本地演示空间。探索、上传，尽管试试。'
                      : '凭据保存在本机，所有文件通过 HTTPS 直接连接 OSS。'}
                  </span>
                  {isDemo && (
                    <button onClick={() => setModal('connection')}>
                      连接真实 OSS
                      <ArrowUpRight size={12} />
                    </button>
                  )}
                </div>
                {dragging && (
                  <div className="drop-overlay">
                    <div>
                      <Upload size={38} strokeWidth={1.4} />
                      <h2>松开，文件即刻启程</h2>
                      <p>
                        上传到 {current.bucket}/{current.prefix}
                      </p>
                      <small>同名文件将保留，不会自动覆盖</small>
                    </div>
                  </div>
                )}
              </section>
              {inspector && (
                <PreviewPanel
                  object={selectedObject}
                  preview={preview}
                  loading={previewLoading}
                  error={previewError}
                  onClose={() => setInspector(false)}
                  onDownload={() => selectedObject && download([selectedObject])}
                  bucket={current.bucket}
                />
              )}
            </div>
          )}
        </main>
        <footer className="statusbar">
          <span>
            <span className="status-dot" />
            {isDemo ? '演示模式' : current ? 'OSS 工作空间' : '就绪'}
            <i />
            {current?.region || '本地工作空间'}
          </span>
          <button onClick={() => setPage('transfers')}>
            {running ? <Loader2 size={11} className="spin" /> : <CheckCircle2 size={11} />}{' '}
            {running
              ? `${running} 个任务正在传输`
              : transfers.length
                ? `${transfers.filter((t) => t.status === 'completed').length} 个传输已完成`
                : '所有传输已就绪'}
            <ChevronRight size={11} />
          </button>
          <span className="statusbar-platform">
            {window.ossDesk?.platform || 'Web Preview'}
            <i />
            UTF-8
          </span>
        </footer>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="visually-hidden"
        tabIndex={-1}
        onChange={(e) => {
          if (e.target.files) droppedFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {toast && (
        <div
          className={`toast ${toast.error ? 'toast-error' : ''}`}
          role={toast.error ? 'alert' : 'status'}
        >
          {toast.error ? <HelpCircle size={17} /> : <CheckCircle2 size={17} />}
          <span>{toast.text}</span>
          <button aria-label="关闭通知" onClick={() => setToast(undefined)}>
            <X size={14} />
          </button>
        </div>
      )}
      {modal === 'connection' && (
        <ConnectionDialog onClose={() => setModal(null)} onSaved={saveConnection} />
      )}
      {modal === 'folder' && (
        <Modal
          title="新建文件夹"
          subtitle={`在 ${current?.bucket}/${current?.prefix} 中创建一个新目录`}
          onClose={() => !folderBusy && setModal(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createFolder();
            }}
          >
            <label className="field">
              文件夹名称
              <input
                autoFocus
                required
                maxLength={200}
                placeholder="例如：project-assets"
                value={folderName}
                onChange={(e) => {
                  setFolderName(e.target.value);
                  setFolderError('');
                }}
              />
            </label>
            {folderError && (
              <div className="inline-error" role="alert">
                {folderError}
              </div>
            )}
            <div className="modal-footer right">
              <button
                type="button"
                className="button secondary"
                disabled={folderBusy}
                onClick={() => setModal(null)}
              >
                取消
              </button>
              <button className="button primary" disabled={folderBusy}>
                {folderBusy ? <Loader2 size={15} className="spin" /> : <FolderPlus size={15} />}
                创建文件夹
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === 'settings' && (
        <Modal
          title="偏好设置"
          subtitle="让工作空间，更像你的习惯。"
          onClose={() => setModal(null)}
        >
          <div className="settings-row">
            <div>
              <strong>外观主题</strong>
              <small>选择适合你的工作环境</small>
            </div>
            <div className="segmented-control">
              <button
                className={theme === 'light' ? 'active' : ''}
                onClick={() => setTheme('light')}
              >
                浅色
              </button>
              <button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}>
                深色
              </button>
            </div>
          </div>
          <div className="settings-row">
            <div>
              <strong>紧凑列表</strong>
              <small>在同样的空间中显示更多文件</small>
            </div>
            <button
              className={`toggle ${compact ? 'on' : ''}`}
              role="switch"
              aria-checked={compact}
              aria-label="紧凑列表"
              onClick={() => setCompact((v) => !v)}
            >
              <span />
            </button>
          </div>
          <div className="settings-about">
            <Box size={25} />
            <strong>
              StorDock <span>0.1.0</span>
            </strong>
            <p>
              一个简单、专注的对象存储工作空间。
              <br />为 Windows、macOS 和 Linux 而构建。
            </p>
          </div>
          <div className="modal-footer right">
            <button className="button primary" onClick={() => setModal(null)}>
              完成
            </button>
          </div>
        </Modal>
      )}
      {modal === 'help' && (
        <Modal
          title="一点帮助，很多从容"
          subtitle="熟悉这些操作，让管理文件更轻松。"
          onClose={() => setModal(null)}
        >
          <div className="help-list">
            <div>
              <span>快速跳转存储桶</span>
              <kbd>Ctrl / ⌘ K</kbd>
            </div>
            <div>
              <span>聚焦文件搜索</span>
              <kbd>/</kbd>
            </div>
            <div>
              <span>取消文件选择</span>
              <kbd>Esc</kbd>
            </div>
            <div>
              <span>进入文件夹</span>
              <span>点击名称或双击行</span>
            </div>
            <div>
              <span>预览文件</span>
              <span>点击文件名称</span>
            </div>
            <div>
              <span>上传文件</span>
              <span>拖入列表或点击上传</span>
            </div>
          </div>
          <div className="help-note">
            <ShieldCheck size={18} />
            <p>
              真实 OSS 连接请使用桌面客户端。推荐使用 RAM 子账号凭据；指定 Bucket
              可避免申请列举全部存储桶权限。搜索会按页扫描当前路径下的对象，产生正常的 OSS
              请求费用。
            </p>
          </div>
          <div className="modal-footer right">
            <button className="button primary" onClick={() => setModal(null)}>
              知道了
            </button>
          </div>
        </Modal>
      )}
      {modal === 'command' && (
        <Modal title="快速跳转" onClose={() => setModal(null)}>
          <label className="command-search">
            <Search size={18} />
            <input
              autoFocus
              aria-label="查找存储桶"
              placeholder="输入存储桶名称…"
              value={commandQuery}
              onChange={(e) => setCommandQuery(e.target.value)}
            />
            <kbd>ESC</kbd>
          </label>
          <div className="command-results">
            {connections.flatMap((c) =>
              (bucketMap[c.id] || [])
                .filter((b) =>
                  `${b.name} ${c.name}`.toLowerCase().includes(commandQuery.toLowerCase()),
                )
                .map((b) => (
                  <button
                    key={`${c.id}/${b.name}`}
                    onClick={() => {
                      openBucket(c.id, b);
                      setModal(null);
                    }}
                  >
                    <Database size={17} />
                    <div>
                      <strong>{b.name}</strong>
                      <small>
                        {c.name} · {b.region}
                      </small>
                    </div>
                    <ArrowUpRight size={15} />
                  </button>
                )),
            )}
            <button onClick={() => setModal('connection')}>
              <Plus size={17} />
              <div>
                <strong>新建存储连接</strong>
                <small>连接另一个云端空间</small>
              </div>
              <ArrowRight size={15} />
            </button>
          </div>
        </Modal>
      )}
      {removeId && (
        <Modal
          title="移除此连接？"
          subtitle="仅删除本机连接配置和凭据，存储桶中的文件不受影响。"
          onClose={() => setRemoveId(undefined)}
        >
          <p className="remove-connection-name">
            {connections.find((c) => c.id === removeId)?.name}
          </p>
          <div className="modal-footer right">
            <button className="button secondary" onClick={() => setRemoveId(undefined)}>
              取消
            </button>
            <button className="button danger-button" onClick={removeConnection}>
              <Trash2 size={14} />
              移除连接
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
