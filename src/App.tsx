import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
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
  Copy,
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
  MoreHorizontal,
  Moon,
  Sun,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
  Link,
  Star,
  FolderSync,
  Import,
} from 'lucide-react';
import type {
  Bucket,
  Connection,
  ConnectionInput,
  Preview,
  StorageObject,
  Transfer,
  UploadItem,
  ConflictPolicy,
  ObjectOperation,
} from './types';
import { storage } from './lib/storage';
import { demoConnection, demoThumbnail, DEMO_ID } from './lib/demo';
import { dateLabel, folderNameError, formatBytes, objectType, sortObjects } from './lib/objects';
import { ConnectionDialog } from './components/ConnectionDialog';
import { Modal } from './components/Modal';
import { ObjectIcon } from './components/ObjectIcon';
import { PreviewPanel } from './components/PreviewPanel';
import { Transfers } from './components/Transfers';
import { OperationDialog, type OperationContext } from './components/OperationDialog';
import { UploadDialog, type UploadContext } from './components/UploadDialog';
import { isActiveTransfer } from './lib/transfers';
import { readDroppedItems } from './lib/drop';
import { DirectoryTree } from './components/DirectoryTree';
import { copyText } from './lib/clipboard';
import { ShareDialog, type ShareContext } from './components/ShareDialog';
import { ObjectToolsDialog } from './components/ObjectToolsDialog';
import { SyncDialog } from './components/SyncDialog';
import { ConnectionToolsDialog } from './components/ConnectionToolsDialog';
import { UpdateControls } from './components/UpdateControls';
import { readWorkspace, saveWorkspace, type WorkspaceTab, type Bookmark } from './lib/workspace';

const initialTab: WorkspaceTab = {
  id: `${DEMO_ID}/studio-assets`,
  connectionId: DEMO_ID,
  bucket: 'studio-assets',
  region: 'cn-hangzhou',
  prefix: '',
  query: '',
  searchMode: 'loaded',
  searchQuery: '',
  filter: 'all',
  sort: { field: 'name', ascending: true },
  selection: [],
  anchor: '',
  scrollTop: 0,
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
  const [connectionQuery, setConnectionQuery] = useState('');
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => readWorkspace(initialTab).tabs);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => readWorkspace(initialTab).bookmarks);
  const [activeId, setActiveId] = useState(() => readWorkspace(initialTab).activeId);
  const [page, setPage] = useState<'files' | 'transfers'>('files');
  const [objects, setObjects] = useState<StorageObject[]>([]);
  const [objectsKey, setObjectsKey] = useState('');
  const [cursor, setCursor] = useState<string>();
  const [scanned, setScanned] = useState(0);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [revision, setRevision] = useState(0);
  const [inspector, setInspector] = useState(
    () => localStorage.getItem('ossdesk-inspector') !== 'false',
  );
  const [preview, setPreview] = useState<Preview>();
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [layout, setLayout] = useState<'list' | 'grid'>(() =>
    localStorage.getItem('ossdesk-layout') === 'grid' ? 'grid' : 'list',
  );
  const [previewRevision, setPreviewRevision] = useState(0);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [pathEditing, setPathEditing] = useState(false);
  const [pathDraft, setPathDraft] = useState('');
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    object?: StorageObject;
  }>();
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [modal, setModal] = useState<
    | 'connection'
    | 'folder'
    | 'settings'
    | 'help'
    | 'command'
    | 'object-tools'
    | 'sync'
    | 'connections-tools'
    | null
  >(null);
  const [folderName, setFolderName] = useState('');
  const [folderError, setFolderError] = useState('');
  const [folderBusy, setFolderBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [editConnection, setEditConnection] = useState<Connection>();
  const [connectionDraft, setConnectionDraft] = useState<Partial<ConnectionInput>>();
  const [operationContext, setOperationContext] = useState<OperationContext>();
  const [pendingUpload, setPendingUpload] = useState<UploadContext>();
  const [shareContext, setShareContext] = useState<ShareContext>();
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean; transfers?: boolean }>();
  const [commandQuery, setCommandQuery] = useState('');
  const [theme, setTheme] = useState(() => localStorage.getItem('ossdesk-theme') || 'light');
  const [compact, setCompact] = useState(() => localStorage.getItem('ossdesk-compact') === 'true');
  const [removeId, setRemoveId] = useState<string>();
  const [connectionMenu, setConnectionMenu] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pathRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuOrigin = useRef<HTMLElement | null>(null);
  const selectionCursor = useRef('');
  const selectionRef = useRef<HTMLInputElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const listCache = useRef(
    new Map<
      string,
      { objects: StorageObject[]; cursor?: string; scanned: number; revision: number }
    >(),
  );
  const uploadRunning = useRef(false);
  const requestId = useRef(0);
  const dragDepth = useRef(0);
  const current = tabs.find((t) => t.id === activeId);
  const checked = useMemo(() => new Set(current?.selection || []), [current?.selection]);
  const selected = checked.size === 1 ? [...checked][0] : '';
  const filter = current?.filter || 'all';
  const sort = current?.sort || initialTab.sort;
  const listKey = current ? JSON.stringify([current.id, current.prefix, current.searchQuery]) : '';
  const connection = connections.find((c) => c.id === current?.connectionId);
  const isDemo = current?.connectionId === DEMO_ID;
  const selectedObject =
    objectsKey === listKey
      ? objects.find((o) => o.key === selected && o.kind === 'file')
      : undefined;
  const running = transfers.filter(isActiveTransfer).length;
  const failed = transfers.filter((t) => t.status === 'failed').length;
  const activeTransfers = transfers.filter(isActiveTransfer);
  const activeBytes = activeTransfers.reduce((sum, t) => sum + t.size, 0);
  const transferProgress = activeBytes
    ? Math.round(activeTransfers.reduce((sum, t) => sum + t.size * t.progress, 0) / activeBytes)
    : Math.round(activeTransfers.reduce((sum, t) => sum + t.progress, 0) / (running || 1));
  const notify = useCallback((text: string, error = false) => setToast({ text, error }), []);
  useEffect(() => {
    const h = setTimeout(() => setToast(undefined), 5000);
    return () => clearTimeout(h);
  }, [toast]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('ossdesk-theme', theme);
    void window.ossDesk?.setAppearance?.(theme === 'dark' ? 'dark' : 'light').catch(() => {});
  }, [theme]);
  useEffect(() => {
    localStorage.setItem('ossdesk-layout', layout);
  }, [layout]);
  useEffect(() => {
    localStorage.setItem('ossdesk-compact', String(compact));
  }, [compact]);
  useEffect(() => {
    localStorage.setItem('ossdesk-inspector', String(inspector));
  }, [inspector]);
  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeId)) setActiveId(tabs[0]?.id || '');
  }, [tabs, activeId]);
  useEffect(() => {
    saveWorkspace(tabs, activeId, bookmarks);
  }, [tabs, activeId, bookmarks]);
  useEffect(() => {
    let alive = true;
    storage
      .connections()
      .then((c) => {
        if (alive) {
          setConnections(c);
          const ids = new Set(c.map((item) => item.id));
          setTabs((previous) => {
            const available = previous.filter((tab) => ids.has(tab.connectionId));
            return available.length ? available : [initialTab];
          });
          setBookmarks((previous) => previous.filter((item) => ids.has(item.connectionId)));
          const restoredIds = [
            ...new Set(readWorkspace(initialTab).tabs.map((tab) => tab.connectionId)),
          ].filter((id) => id !== DEMO_ID && ids.has(id));
          void Promise.allSettled(
            restoredIds.map(async (id) => {
              const buckets = await storage.buckets(id);
              if (alive) setBucketMap((previous) => ({ ...previous, [id]: buckets }));
            }),
          ).then(() => {
            if (alive && restoredIds.length) setRevision((value) => value + 1);
          });
        }
      })
      .catch((e) => notify(errorMessage(e), true));
    storage.buckets(DEMO_ID).then((b) => {
      if (alive) setBucketMap((m) => ({ ...m, [DEMO_ID]: b }));
    });
    return () => {
      alive = false;
    };
  }, [notify]);
  useEffect(() => {
    let alive = true;
    const off = storage.onTransfer((t) => {
      setTransfers((prev) => {
        const index = prev.findIndex((p) => p.id === t.id);
        if (index < 0) {
          let ended = 0;
          return [t, ...prev].filter(
            (item) => isActiveTransfer(item) || item.status === 'paused' || ++ended <= 200,
          );
        }
        const next = [...prev];
        next[index] = t;
        return next;
      });
    });
    void storage
      .listTransfers()
      .then((saved) => {
        if (alive)
          setTransfers((previous) =>
            [...new Map([...saved, ...previous].map((task) => [task.id, task])).values()].sort(
              (a, b) => b.startedAt - a.startedAt,
            ),
          );
      })
      .catch((error) => notify(errorMessage(error), true));
    return () => {
      alive = false;
      off();
    };
  }, [notify]);
  useEffect(() => {
    const id = ++requestId.current;
    setContextMenu(undefined);
    setPathEditing(false);
    setListError('');
    setCursor(undefined);
    setObjects([]);
    setScanned(0);
    setLoading(!!current);
    setMoreLoading(false);
    if (!current) {
      setLoading(false);
      return;
    }
    const cached = listCache.current.get(listKey);
    if (cached?.revision === revision) {
      setObjects(cached.objects);
      setObjectsKey(listKey);
      setCursor(cached.cursor);
      setScanned(cached.scanned);
      setLoading(false);
      return;
    }
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const result = await storage.list({
          connectionId: current.connectionId,
          bucket: current.bucket,
          prefix: current.prefix,
          query: current.searchQuery,
        });
        if (alive && requestId.current === id) {
          setObjects(result.objects);
          setObjectsKey(listKey);
          setCursor(result.cursor);
          setScanned(result.scanned || 0);
          listCache.current.set(listKey, { ...result, scanned: result.scanned || 0, revision });
        }
      } catch (e) {
        if (alive) setListError(errorMessage(e));
      } finally {
        if (alive) setLoading(false);
      }
    }, 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [listKey, revision]);
  useLayoutEffect(() => {
    if (!loading && objectsKey === listKey && listRef.current) {
      listRef.current.scrollTop = scrollPositions.current.get(listKey) ?? current?.scrollTop ?? 0;
    }
  }, [listKey, objectsKey, loading, page]);
  useEffect(() => {
    if (pathEditing) {
      pathRef.current?.focus();
      pathRef.current?.select();
    }
  }, [pathEditing]);
  useEffect(() => {
    selectionCursor.current = current?.anchor || '';
  }, [listKey]);
  useEffect(() => {
    if (!contextMenu) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const dismiss = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) setContextMenu(undefined);
    };
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('resize', dismiss);
    document.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('resize', dismiss);
      document.removeEventListener('scroll', dismiss, true);
    };
  }, [contextMenu]);
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
    previewRevision,
  ]);
  const visibleObjects = useMemo(
    () =>
      sortObjects(
        objects.filter(
          (o) =>
            (current?.searchQuery ||
              current?.searchMode === 'recursive' ||
              !current?.query.trim() ||
              o.name.toLowerCase().includes(current.query.trim().toLowerCase())) &&
            (filter === 'all' ||
              (filter === 'image'
                ? objectType(o) === 'image'
                : filter === 'document'
                  ? ['text', 'code', 'pdf'].includes(objectType(o)) && o.kind === 'file'
                  : o.kind === 'folder')),
        ),
        sort.field,
        sort.ascending,
      ),
    [objects, filter, sort, current?.query, current?.searchMode, current?.searchQuery],
  );
  const files = objectsKey === listKey ? objects.filter((o) => o.kind === 'file') : [];
  const selectedObjects = objectsKey === listKey ? objects.filter((o) => checked.has(o.key)) : [];
  const selectedFiles = files.filter((o) => checked.has(o.key));
  const allChecked = visibleObjects.length > 0 && visibleObjects.every((o) => checked.has(o.key));
  useEffect(() => {
    if (selectionRef.current) selectionRef.current.indeterminate = checked.size > 0 && !allChecked;
  }, [checked, allChecked, layout, loading]);
  // A filter or refreshed listing must never leave invisible objects selected.
  useEffect(() => {
    if (loading || objectsKey !== listKey) return;
    const visibleKeys = new Set(visibleObjects.map((o) => o.key));
    if ([...checked].some((key) => !visibleKeys.has(key)))
      setChecked(new Set([...checked].filter((key) => visibleKeys.has(key))));
  }, [visibleObjects, loading, objectsKey, listKey]);
  function updateTab(
    patch: Partial<WorkspaceTab> | ((tab: WorkspaceTab) => Partial<WorkspaceTab>),
  ) {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeId ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t,
      ),
    );
  }
  function setChecked(value: Set<string> | ((previous: Set<string>) => Set<string>)) {
    updateTab((tab) => ({
      selection: [...(typeof value === 'function' ? value(new Set(tab.selection)) : value)],
    }));
  }
  function setSelected(key: string) {
    selectionCursor.current = key;
    updateTab({ selection: key ? [key] : [], anchor: key });
  }
  function setFilter(value: string) {
    updateTab({ filter: value, selection: [], anchor: '', scrollTop: 0 });
    scrollPositions.current.delete(listKey);
    if (listRef.current) listRef.current.scrollTop = 0;
  }
  function setSort(value: (previous: WorkspaceTab['sort']) => WorkspaceTab['sort']) {
    updateTab((tab) => ({ sort: value(tab.sort) }));
  }
  function navigate(prefix: string) {
    if (!current || (prefix === current.prefix && !current.query)) return;
    updateTab({
      prefix,
      query: '',
      searchQuery: '',
      selection: [],
      anchor: '',
      scrollTop: 0,
      history: [...current.history.slice(0, current.position + 1), prefix],
      position: current.position + 1,
    });
    setSelected('');
  }
  function goHistory(delta: number) {
    if (!current) return;
    const position = current.position + delta;
    if (position >= 0 && position < current.history.length) {
      updateTab({
        prefix: current.history[position],
        query: '',
        searchQuery: '',
        position,
        selection: [],
        anchor: '',
        scrollTop: 0,
      });
      setSelected('');
    }
  }
  function openBucket(connectionId: string, bucket: Bucket, prefix?: string) {
    const id = `${connectionId}/${bucket.name}`;
    setTabs((prev) =>
      prev.some((t) => t.id === id)
        ? prev.map((tab) =>
            tab.id === id && prefix !== undefined
              ? {
                  ...tab,
                  prefix,
                  query: '',
                  searchQuery: '',
                  selection: [],
                  anchor: '',
                  scrollTop: 0,
                  history: [...tab.history.slice(0, tab.position + 1), prefix],
                  position: tab.position + 1,
                }
              : tab,
          )
        : [
            ...prev,
            {
              ...initialTab,
              id,
              connectionId,
              bucket: bucket.name,
              region: bucket.region,
              prefix: prefix || '',
              query: '',
              history: [prefix || ''],
              position: 0,
            },
          ],
    );
    setActiveId(id);
    setPage('files');
    setConnectionMenu(undefined);
  }
  function closeTab(id: string) {
    const remaining = tabs.filter((t) => t.id !== id);
    setTabs(remaining);
    if (activeId === id) setActiveId(remaining.at(-1)?.id || '');
    listCache.current.forEach((_value, key) => {
      if (JSON.parse(key)[0] === id) {
        listCache.current.delete(key);
        scrollPositions.current.delete(key);
      }
    });
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
    if (editConnection) {
      setTabs((previous) => previous.filter((tab) => tab.connectionId !== c.id));
      listCache.current.clear();
      setRevision((value) => value + 1);
    }
    setEditConnection(undefined);
    const buckets = await expandConnection(c.id, true);
    if (buckets?.[0]) openBucket(c.id, buckets[0]);
    setConnectionDraft(undefined);
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
        query: current.searchQuery,
        cursor,
      });
      if (id === requestId.current) {
        const merged = [
          ...new Map([...objects, ...result.objects].map((o) => [o.key, o])).values(),
        ];
        setObjects(merged);
        setCursor(result.cursor);
        setScanned((p) => p + (result.scanned || 0));
        listCache.current.set(listKey, {
          objects: merged,
          cursor: result.cursor,
          scanned: scanned + (result.scanned || 0),
          revision,
        });
      }
    } catch (e) {
      notify(errorMessage(e), true);
    } finally {
      if (id === requestId.current) setMoreLoading(false);
    }
  }
  function toggleChecked(key: string) {
    selectionCursor.current = key;
    updateTab({ anchor: key });
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }
  function selectObject(
    o: StorageObject,
    event?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
  ) {
    selectionCursor.current = o.key;
    listRef.current?.focus({ preventScroll: true });
    if (event?.shiftKey && current?.anchor) {
      const start = visibleObjects.findIndex((item) => item.key === current.anchor);
      const end = visibleObjects.findIndex((item) => item.key === o.key);
      if (start >= 0 && end >= 0) {
        const range = visibleObjects
          .slice(Math.min(start, end), Math.max(start, end) + 1)
          .map((item) => item.key);
        setChecked(
          (previous) => new Set([...(event.ctrlKey || event.metaKey ? previous : []), ...range]),
        );
        return;
      }
    }
    if (event?.ctrlKey || event?.metaKey) toggleChecked(o.key);
    else setSelected(o.key);
  }
  function openObject(o: StorageObject) {
    if (o.kind === 'folder') navigate(o.key);
    else {
      setSelected(o.key);
      setInspector(true);
      setPreviewVersion((value) => value + 1);
    }
  }
  function showContextMenu(e: ReactMouseEvent, object?: StorageObject) {
    e.preventDefault();
    e.stopPropagation();
    menuOrigin.current = listRef.current;
    if (object && !checked.has(object.key)) setSelected(object.key);
    if (!object) setSelected('');
    setContextMenu({
      x: Math.max(8, Math.min(e.clientX, window.innerWidth - 210)),
      y: Math.max(8, Math.min(e.clientY, window.innerHeight - 315)),
      object,
    });
  }
  function closeContextMenu() {
    setContextMenu(undefined);
    menuOrigin.current?.focus({ preventScroll: true });
  }
  async function copyPath(path: string) {
    try {
      await copyText(path);
      notify('对象路径已复制');
    } catch {
      notify('复制失败，请重试', true);
    }
  }
  function startPathEditing() {
    setPathDraft(current?.prefix || '');
    setPathEditing(true);
  }
  function newFolder() {
    setFolderName('');
    setFolderError('');
    setModal('folder');
  }
  function goUp() {
    if (current?.prefix) {
      const parentEnd = current.prefix.lastIndexOf('/', current.prefix.length - 2);
      navigate(parentEnd >= 0 ? current.prefix.slice(0, parentEnd + 1) : '');
    }
  }
  function submitSearch() {
    if (current?.searchMode !== 'recursive') return;
    const query = current.query.trim();
    updateTab({ searchQuery: query, selection: [], anchor: '', scrollTop: 0 });
    const key = JSON.stringify([current.id, current.prefix, query]);
    scrollPositions.current.delete(key);
    listCache.current.delete(key);
    if (query === current.searchQuery) setRevision((value) => value + 1);
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
  function beginOperation(operation: ObjectOperation) {
    if (!current || !selectedObjects.length) return;
    closeContextMenu();
    setOperationContext({
      connectionId: current.connectionId,
      bucket: current.bucket,
      objects: selectedObjects,
      operation,
    });
  }
  async function executeOperation(id: string) {
    setOperationContext(undefined);
    try {
      const task = await storage.executeOperation(id);
      setRevision((value) => value + 1);
      setToast({
        text:
          task.status === 'completed'
            ? '对象操作已完成'
            : task.status === 'cancelled'
              ? '操作已取消，已完成的更改保留，请查看任务记录'
              : task.error || '操作未全部完成，请查看任务记录',
        error: task.status === 'failed',
        transfers: true,
      });
    } catch (error) {
      notify(errorMessage(error), true);
    }
  }
  async function transferAction(id: string, action: 'cancel' | 'retry' | 'pause' | 'reveal') {
    try {
      if (action === 'cancel') await storage.cancelTransfer(id);
      else if (action === 'pause') await storage.pauseTransfer(id);
      else if (action === 'reveal') await storage.revealTransfer(id);
      else {
        await storage.retryTransfer(id);
        setRevision((value) => value + 1);
      }
    } catch (error) {
      notify(errorMessage(error), true);
    }
  }
  function stageUpload(items: UploadItem[]) {
    if (!current || !items.length || uploadBusy) return;
    setPendingUpload({
      connectionId: current.connectionId,
      bucket: current.bucket,
      prefix: current.prefix,
      items,
    });
  }
  async function upload(context: UploadContext, conflict: ConflictPolicy) {
    const { connectionId, bucket, prefix, items } = context;
    if (!items.length || uploadBusy || uploadRunning.current) return;
    setPendingUpload(undefined);
    setUploadBusy(true);
    uploadRunning.current = true;
    try {
      const summary = await storage.upload(connectionId, bucket, prefix, items, conflict);
      setRevision((r) => r + 1);
      const { completed, failed: failures, skipped, cancelled, paused = 0 } = summary;
      setToast({
        text: `上传任务已处理：${completed} 个成功，${failures} 个失败${skipped ? `，${skipped} 个跳过` : ''}${cancelled ? `，${cancelled} 个取消` : ''}${paused ? `，${paused} 个暂停，可到传输中心继续` : ''}`,
        error: failures > 0,
        transfers: true,
      });
    } catch (e) {
      notify(errorMessage(e), true);
    } finally {
      setUploadBusy(false);
      uploadRunning.current = false;
    }
  }
  async function pickUpload(mode: 'files' | 'folder' = 'files') {
    if (!current) return;
    if (isDemo || !window.ossDesk) {
      (mode === 'folder' ? folderInputRef : inputRef).current?.click();
      return;
    }
    try {
      stageUpload(await storage.pickUpload(mode));
    } catch (e) {
      notify(errorMessage(e), true);
    }
  }
  function droppedFiles(list: FileList | File[]) {
    stageUpload(
      Array.from(list).map((file) => ({
        name: file.name,
        file,
        relativePath: file.webkitRelativePath || undefined,
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
  useEffect(() => {
    function keyboard(e: KeyboardEvent) {
      const target = e.target instanceof HTMLElement ? e.target : null;
      const editing = !!target?.closest(
        'input:not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea, select, [contenteditable="true"]',
      );
      if (document.querySelector('dialog[open]')) return;
      if (contextMenu) {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeContextMenu();
        }
        return;
      }
      if (editing) return;
      const modifier = e.metaKey || e.ctrlKey;
      if (modifier && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setModal('command');
        setCommandQuery('');
        return;
      }
      if (page !== 'files' || !current) return;
      const inWorkspace = !!target?.closest('.file-workspace') || target === document.body;
      if (!inWorkspace) return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (modifier && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        startPathEditing();
      } else if (e.altKey && ['ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        if (e.key === 'ArrowUp') goUp();
        else goHistory(e.key === 'ArrowLeft' ? -1 : 1);
      } else if (e.key === 'Escape') {
        setChecked(new Set());
        setConnectionMenu(undefined);
      } else if (listRef.current?.contains(target)) {
        if (e.key === 'Delete' || e.key === 'F2') {
          if (selectedObjects.length && (e.key === 'Delete' || selectedObjects.length === 1)) {
            e.preventDefault();
            beginOperation(e.key === 'Delete' ? 'delete' : 'rename');
          }
        } else if (modifier && e.key.toLowerCase() === 'a') {
          e.preventDefault();
          setChecked(new Set(visibleObjects.map((o) => o.key)));
        } else if (
          ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) &&
          visibleObjects.length
        ) {
          e.preventDefault();
          const focused = visibleObjects.findIndex(
            (o) => o.key === (selected || selectionCursor.current || current.anchor),
          );
          const index =
            e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? visibleObjects.length - 1
                : Math.max(
                    0,
                    Math.min(visibleObjects.length - 1, focused + (e.key === 'ArrowDown' ? 1 : -1)),
                  );
          selectObject(visibleObjects[index], e);
          listRef.current
            .querySelectorAll<HTMLElement>('[data-object-key]')
            [index]?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter' && selectedObject && target === listRef.current) {
          e.preventDefault();
          openObject(selectedObject);
        } else if (e.key === 'Enter' && checked.size === 1 && target === listRef.current) {
          const object = visibleObjects.find((o) => checked.has(o.key));
          if (object) {
            e.preventDefault();
            openObject(object);
          }
        } else if (e.key === ' ' && target === listRef.current && checked.size === 1) {
          e.preventDefault();
          setInspector((value) => !value);
        } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
          e.preventDefault();
          const bounds = listRef.current.getBoundingClientRect();
          menuOrigin.current = listRef.current;
          setContextMenu({
            x: Math.max(8, Math.min(bounds.left + 40, window.innerWidth - 210)),
            y: Math.max(8, Math.min(bounds.top + 40, window.innerHeight - 205)),
            object: selectedObjects[0],
          });
        }
      }
    }
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  });
  const crumbs = current?.prefix.split('/').filter(Boolean) || [];
  const connectionNeedle = connectionQuery.trim().toLowerCase();
  const visibleConnections = connections.filter(
    (c) =>
      !connectionNeedle ||
      c.name.toLowerCase().includes(connectionNeedle) ||
      bucketMap[c.id]?.some((b) => b.name.toLowerCase().includes(connectionNeedle)),
  );
  const inspectorOpen = inspector && page === 'files' && !!current;
  return (
    <div
      className={`app-shell ${compact ? 'compact' : ''} ${inspectorOpen ? 'inspector-open' : ''} ${window.ossDesk ? `platform-${window.ossDesk.platform}` : ''}`}
      onClick={() => connectionMenu && setConnectionMenu(undefined)}
    >
      <header className="topbar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage('files');
          }}
          aria-label="StorDock 首页"
        >
          <Box size={20} strokeWidth={1.7} />
          <span>StorDock</span>
        </a>
        <nav className="main-navigation" aria-label="主工具栏">
          <button onClick={() => setModal('connection')}>
            <Database size={17} />
            <span>新建连接</span>
          </button>
          <button className={page === 'files' ? 'active' : ''} onClick={() => setPage('files')}>
            <Files size={17} />
            <span>文件浏览</span>
          </button>
          <button
            className={page === 'transfers' ? 'active' : ''}
            onClick={() => setPage('transfers')}
          >
            <ArrowDownToLine size={17} />
            <span>传输中心</span>
            {running > 0 && <span className="nav-count">{running}</span>}
          </button>
        </nav>
        <div className="topbar-right">
          <button
            className="command-trigger"
            title="快速跳转 (Ctrl / ⌘ K)"
            onClick={() => {
              setCommandQuery('');
              setModal('command');
            }}
          >
            <Search size={16} />
            <span>快速跳转</span>
            <kbd>Ctrl K</kbd>
          </button>
          <span className="topbar-divider" />
          <button
            className="icon-button"
            aria-label={theme === 'dark' ? '切换浅色主题' : '切换深色主题'}
            title={theme === 'dark' ? '切换浅色主题' : '切换深色主题'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <button
            className="icon-button"
            aria-label="帮助与快捷键"
            title="帮助与快捷键"
            onClick={() => setModal('help')}
          >
            <HelpCircle size={18} />
          </button>
          <button
            className="icon-button"
            aria-label="偏好设置"
            title="偏好设置"
            onClick={() => setModal('settings')}
          >
            <Settings2 size={18} />
          </button>
        </div>
      </header>
      <aside className="sidebar">
        <div className="sidebar-heading">
          <strong>连接</strong>
          <div>
            <button
              className="icon-button"
              title="刷新存储桶"
              aria-label="刷新存储桶"
              onClick={() => expandConnection(current?.connectionId || DEMO_ID, true)}
            >
              <RefreshCw size={15} />
            </button>
            <button
              className="icon-button"
              title="新建连接"
              aria-label="新建连接"
              onClick={() => setModal('connection')}
            >
              <Plus size={17} />
            </button>
          </div>
        </div>
        <label className="connection-search">
          <Search size={14} />
          <input
            aria-label="搜索连接"
            placeholder="搜索连接或存储桶…"
            value={connectionQuery}
            onChange={(e) => setConnectionQuery(e.target.value)}
          />
          {connectionQuery && (
            <button aria-label="清除连接搜索" onClick={() => setConnectionQuery('')}>
              <X size={13} />
            </button>
          )}
        </label>
        <div className="connection-tree">
          {bookmarks.length > 0 && (
            <div className="bookmarks">
              <div className="section-label">收藏路径</div>
              {bookmarks.map((item, index) => (
                <div
                  className="bookmark-row"
                  key={`${item.connectionId}/${item.bucket}/${item.prefix}`}
                >
                  <button
                    title={`${item.bucket}/${item.prefix}`}
                    onClick={() =>
                      openBucket(
                        item.connectionId,
                        { name: item.bucket, region: item.region },
                        item.prefix,
                      )
                    }
                  >
                    <Star size={12} />
                    <span>{item.name}</span>
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`移除收藏 ${item.name}`}
                    onClick={() =>
                      setBookmarks((previous) => previous.filter((_, i) => i !== index))
                    }
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {visibleConnections.map((c) => (
            <div className="connection-group" key={c.id}>
              <div
                className={`connection-item ${expanded.has(c.id) || !!connectionNeedle ? 'expanded' : ''}`}
              >
                <button
                  className="connection-expand"
                  onClick={() => expandConnection(c.id)}
                  aria-expanded={expanded.has(c.id) || !!connectionNeedle}
                >
                  {bucketLoading === c.id ? (
                    <Loader2 size={12} className="spin" />
                  ) : expanded.has(c.id) || !!connectionNeedle ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                  <span className={`cloud-provider provider-${c.provider}`}>
                    {c.provider === 's3' ? <Box size={17} /> : <Cloud size={17} />}
                  </span>
                  <span className="connection-name">{c.name}</span>
                  {c.id === DEMO_ID ? (
                    <span className="demo-mini">DEMO</span>
                  ) : (
                    <span className="provider-mini">{c.provider === 's3' ? 'S3' : 'OSS'}</span>
                  )}
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
                    <button
                      onClick={() => {
                        setEditConnection(c);
                        setConnectionMenu(undefined);
                        setModal('connection');
                      }}
                    >
                      <Settings2 size={13} />
                      编辑连接
                    </button>
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
              {(expanded.has(c.id) || !!connectionNeedle) && (
                <div className="bucket-tree">
                  {bucketMap[c.id]
                    ?.filter(
                      (b) =>
                        !connectionNeedle ||
                        c.name.toLowerCase().includes(connectionNeedle) ||
                        b.name.toLowerCase().includes(connectionNeedle),
                    )
                    .map((b) => (
                      <DirectoryTree
                        key={b.name}
                        connectionId={c.id}
                        bucket={b}
                        currentPrefix={
                          current?.connectionId === c.id && current.bucket === b.name
                            ? current.prefix
                            : undefined
                        }
                        revision={revision}
                        onOpen={(prefix) => openBucket(c.id, b, prefix)}
                      />
                    ))}
                  {bucketMap[c.id]?.length === 0 && (
                    <span className="tree-empty">没有可访问的存储桶</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {visibleConnections.length === 0 && <p className="tree-empty">没有匹配的连接或存储桶</p>}
        <button className="add-connection" onClick={() => setModal('connection')}>
          <Plus size={15} />
          新建存储连接
        </button>
        {window.ossDesk && (
          <button className="add-connection" onClick={() => setModal('connections-tools')}>
            <Import size={15} />
            连接导入 / 导出
          </button>
        )}
        <div className="sidebar-bottom">
          <span>
            <ShieldCheck size={13} />
            凭据仅保存在本机
          </span>
          <span>v0.2.0</span>
        </div>
      </aside>
      <div className="main-shell">
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
        </div>
        <main className="content-shell">
          {page === 'transfers' ? (
            <Transfers
              transfers={transfers}
              onClear={() => {
                void storage
                  .clearTransfers()
                  .then(() =>
                    setTransfers((prev) =>
                      prev.filter((task) => isActiveTransfer(task) || task.status === 'paused'),
                    ),
                  )
                  .catch((error) => notify(errorMessage(error), true));
              }}
              onCancel={(id) => void transferAction(id, 'cancel')}
              onRetry={(id) => void transferAction(id, 'retry')}
              onPause={(id) => void transferAction(id, 'pause')}
              onReveal={(id) => void transferAction(id, 'reveal')}
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
                onDrop={async (e) => {
                  e.preventDefault();
                  setDragging(false);
                  dragDepth.current = 0;
                  try {
                    if (window.ossDesk && !isDemo) droppedFiles(e.dataTransfer.files);
                    else stageUpload(await readDroppedItems(e.dataTransfer.items));
                  } catch (error) {
                    notify(errorMessage(error), true);
                  }
                }}
              >
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
                      <button
                        className="icon-button"
                        title="上一级 (Alt+↑)"
                        aria-label="上一级"
                        disabled={!current.prefix}
                        onClick={goUp}
                      >
                        <ArrowUp size={15} />
                      </button>
                    </div>
                    {pathEditing ? (
                      <form
                        className="path-editor"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const path = pathDraft.replace(/^\/+/, '');
                          if (/[\x00-\x1f]/.test(path)) {
                            notify('路径不能包含控制字符', true);
                            return;
                          }
                          navigate(path && !path.endsWith('/') ? `${path}/` : path);
                          setPathEditing(false);
                          listRef.current?.focus();
                        }}
                      >
                        <input
                          ref={pathRef}
                          aria-label="目录路径"
                          value={pathDraft}
                          placeholder="输入相对 Bucket 的目录路径，Enter 跳转"
                          onChange={(e) => setPathDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              e.stopPropagation();
                              setPathEditing(false);
                              listRef.current?.focus();
                            }
                          }}
                          onBlur={() => setPathEditing(false)}
                        />
                      </form>
                    ) : (
                      <div className="breadcrumbs" title={`${current.bucket}/${current.prefix}`}>
                        <button title="根目录" onClick={() => navigate('')}>
                          <HardDrive size={14} />
                          <span>{current.bucket}</span>
                        </button>
                        {crumbs.length > 2 && (
                          <span className="crumb">
                            <ChevronRight size={12} />
                            <details className="crumb-overflow">
                              <summary aria-label="展开上级路径">…</summary>
                              <div>
                                {crumbs.slice(0, -2).map((crumb, index) => (
                                  <button
                                    key={index}
                                    onClick={(e) => {
                                      e.currentTarget.closest('details')?.removeAttribute('open');
                                      navigate(`${crumbs.slice(0, index + 1).join('/')}/`);
                                    }}
                                  >
                                    {crumb}
                                  </button>
                                ))}
                              </div>
                            </details>
                          </span>
                        )}
                        {crumbs.slice(-2).map((crumb, offset) => {
                          const index = Math.max(0, crumbs.length - 2) + offset;
                          return (
                            <span className="crumb" key={index}>
                              <ChevronRight size={12} />
                              <button
                                onClick={() => navigate(`${crumbs.slice(0, index + 1).join('/')}/`)}
                              >
                                {crumb}
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    )}
                    {!pathEditing && (
                      <button
                        className="icon-button path-edit-button"
                        title="编辑路径 (Ctrl/⌘+L)"
                        aria-label="编辑路径"
                        onClick={startPathEditing}
                      >
                        <MoreHorizontal size={14} />
                      </button>
                    )}
                    <button
                      className="icon-button path-copy-button"
                      title="复制当前路径"
                      aria-label="复制当前路径"
                      onClick={() => copyPath(`${current.bucket}/${current.prefix}`)}
                    >
                      <Copy size={13} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="收藏当前路径"
                      title="收藏当前路径"
                      onClick={() => {
                        const exists = bookmarks.some(
                          (item) =>
                            item.connectionId === current.connectionId &&
                            item.bucket === current.bucket &&
                            item.prefix === current.prefix,
                        );
                        if (exists) {
                          notify('该路径已收藏');
                          return;
                        }
                        if (bookmarks.length >= 100) {
                          notify('最多收藏 100 个路径', true);
                          return;
                        }
                        setBookmarks((previous) => [
                          ...previous,
                          {
                            connectionId: current.connectionId,
                            bucket: current.bucket,
                            region: current.region,
                            prefix: current.prefix,
                            name: current.prefix.split('/').filter(Boolean).pop() || current.bucket,
                          },
                        ]);
                      }}
                    >
                      <Star size={15} />
                    </button>
                    {!isDemo && (
                      <button
                        className="icon-button"
                        aria-label="同步本地目录"
                        title="同步本地目录"
                        onClick={() => setModal('sync')}
                      >
                        <FolderSync size={16} />
                      </button>
                    )}

                    <div className="page-actions">
                      <button className="button secondary new-folder-button" onClick={newFolder}>
                        <FolderPlus size={14} />
                        新建文件夹
                      </button>
                      <button
                        className="button primary"
                        disabled={uploadBusy}
                        onClick={() => void pickUpload()}
                      >
                        {uploadBusy ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
                        上传文件
                      </button>
                      <button
                        className="button secondary folder-upload-button"
                        disabled={uploadBusy}
                        title="上传文件夹"
                        aria-label="上传文件夹"
                        onClick={() => void pickUpload('folder')}
                      >
                        <FolderPlus size={14} />
                      </button>
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
                    {checked.size > 0 ? (
                      <div className="selection-bar">
                        <span>
                          <CheckCircle2 size={14} />
                          已选择 <strong>{checked.size}</strong> 项
                        </span>
                        <button
                          className="button mini"
                          disabled={downloadBusy || !selectedObjects.length}
                          onClick={() => download(selectedObjects)}
                        >
                          <Download size={13} />
                          下载所选
                        </button>
                        <button
                          className="icon-button"
                          aria-label="更多文件操作"
                          title="更多操作"
                          onClick={(e) => showContextMenu(e, selectedObjects[0])}
                        >
                          <MoreHorizontal size={14} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label="取消选择"
                          onClick={() => setChecked(new Set())}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
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
                    )}
                    <div className="file-toolbar-right">
                      <select
                        className="search-scope"
                        aria-label="搜索范围"
                        value={current.searchMode}
                        onChange={(e) =>
                          updateTab({
                            searchMode: e.target.value as WorkspaceTab['searchMode'],
                            searchQuery: '',
                            selection: [],
                            anchor: '',
                            scrollTop: 0,
                          })
                        }
                      >
                        <option value="loaded">当前列表</option>
                        <option value="recursive">搜索子目录</option>
                      </select>
                      <label className="file-search">
                        <Search size={14} />
                        <input
                          ref={searchRef}
                          aria-label="搜索文件"
                          placeholder={
                            current.searchMode === 'recursive'
                              ? '输入关键词，Enter 搜索…'
                              : '筛选已加载文件…'
                          }
                          value={current.query}
                          onChange={(e) => {
                            updateTab({ query: e.target.value, selection: [], anchor: '' });
                            if (!e.target.value) updateTab({ searchQuery: '' });
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              submitSearch();
                            }
                          }}
                        />
                        {current.query ? (
                          <button
                            aria-label="清除搜索"
                            onClick={() =>
                              updateTab({ query: '', searchQuery: '', selection: [], anchor: '' })
                            }
                          >
                            <X size={12} />
                          </button>
                        ) : (
                          <kbd>/</kbd>
                        )}
                      </label>
                      {current.searchMode === 'recursive' && (
                        <button
                          className="icon-button"
                          aria-label="开始搜索子目录"
                          title="按页扫描当前路径及子目录"
                          disabled={!current.query.trim() || loading}
                          onClick={submitSearch}
                        >
                          <Search size={14} />
                        </button>
                      )}
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
                  {(current.searchQuery || current.query) && (
                    <div className="search-summary">
                      <Search size={12} />
                      <span>
                        {current.searchQuery
                          ? `在「${current.prefix || current.bucket}」及子目录中搜索 “${current.searchQuery}”`
                          : current.searchMode === 'recursive'
                            ? '按 Enter 搜索当前路径及子目录，扫描会产生正常请求费用'
                            : `筛选当前已加载列表：${visibleObjects.length} 项匹配`}
                        {current.searchQuery &&
                          current.query.trim() !== current.searchQuery &&
                          ' · 关键词已修改，按 Enter 重新搜索'}
                      </span>
                      {current.searchQuery && (
                        <small>
                          {loading || moreLoading
                            ? '正在扫描…'
                            : `已扫描 ${scanned} 个对象${cursor ? '，可继续扫描' : '，扫描完成'}`}
                        </small>
                      )}
                    </div>
                  )}
                  <div
                    className="file-list-area"
                    ref={listRef}
                    tabIndex={0}
                    aria-label="文件列表"
                    onScroll={(e) => {
                      if (!loading && objectsKey === listKey)
                        scrollPositions.current.set(listKey, e.currentTarget.scrollTop);
                    }}
                    onClick={(e) => {
                      if (!(e.target as HTMLElement).closest('button, input, [data-object-key]'))
                        setChecked(new Set());
                    }}
                    onContextMenu={(e) => showContextMenu(e)}
                  >
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
                    ) : loading || objectsKey !== listKey ? (
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
                          <button className="button secondary" onClick={() => void pickUpload()}>
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
                                ref={selectionRef}
                                aria-label="选择筛选后已加载的所有项目"
                                title="全选仅作用于筛选后已加载的项目"
                                type="checkbox"
                                checked={allChecked}
                                disabled={!visibleObjects.length}
                                onChange={() =>
                                  setChecked((prev) => {
                                    const next = new Set(prev);
                                    visibleObjects.forEach((o) =>
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
                              data-object-key={o.key}
                              aria-selected={checked.has(o.key)}
                              className={checked.has(o.key) ? 'selected checked-row' : ''}
                              onClick={(e) => selectObject(o, e)}
                              onDoubleClick={() => openObject(o)}
                              onContextMenu={(e) => showContextMenu(e, o)}
                            >
                              <td className="checkbox-cell">
                                <input
                                  type="checkbox"
                                  aria-label={`选择 ${o.name}`}
                                  checked={checked.has(o.key)}
                                  onClick={(e) => e.stopPropagation()}
                                  onDoubleClick={(e) => e.stopPropagation()}
                                  onChange={(e) =>
                                    selectObject(o, {
                                      ctrlKey: true,
                                      metaKey: false,
                                      shiftKey: (e.nativeEvent as MouseEvent).shiftKey,
                                    })
                                  }
                                />
                              </td>
                              <td className="name-cell">
                                <button
                                  title={o.key}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      openObject(o);
                                    }
                                  }}
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
                                    onDoubleClick={(e) => e.stopPropagation()}
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
                            data-object-key={o.key}
                            aria-selected={checked.has(o.key)}
                            className={`object-card ${checked.has(o.key) ? 'selected' : ''}`}
                            onClick={(e) => selectObject(o, e)}
                            onDoubleClick={() => openObject(o)}
                            onContextMenu={(e) => showContextMenu(e, o)}
                          >
                            <div
                              className={`object-card-art ${o.kind === 'folder' ? 'folder-art' : ''}`}
                            >
                              <button
                                className="card-open"
                                aria-label={`选择 ${o.name}`}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    openObject(o);
                                  }
                                }}
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
                              <input
                                className="card-checkbox"
                                type="checkbox"
                                aria-label={`选择 ${o.name}`}
                                checked={checked.has(o.key)}
                                onClick={(e) => e.stopPropagation()}
                                onDoubleClick={(e) => e.stopPropagation()}
                                onChange={(e) =>
                                  selectObject(o, {
                                    ctrlKey: true,
                                    metaKey: false,
                                    shiftKey: (e.nativeEvent as MouseEvent).shiftKey,
                                  })
                                }
                              />
                            </div>
                            <div className="object-card-caption">
                              <button
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    openObject(o);
                                  }
                                }}
                                title={o.name}
                              >
                                {o.name}
                              </button>
                              <small>{o.kind === 'folder' ? '文件夹' : formatBytes(o.size)}</small>
                              {o.kind === 'file' && (
                                <button
                                  className="icon-button"
                                  aria-label={`下载 ${o.name}`}
                                  onDoubleClick={(e) => e.stopPropagation()}
                                  disabled={downloadBusy}
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
                          {current.searchQuery ? '继续扫描更多对象' : '加载更多'}
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
                      <i />
                      {formatBytes(files.reduce((sum, file) => sum + file.size, 0))}
                    </span>
                    <span>
                      <span className="tiny-key">↵</span>打开 · Ctrl/⌘ 加选 · Shift 连选{' '}
                      <span className="footer-tip-separator" />
                      <Upload size={11} /> 拖放文件即可上传
                    </span>
                  </div>
                </div>
                {dragging && (
                  <div className="drop-overlay">
                    <div>
                      <Upload size={38} strokeWidth={1.4} />
                      <h2>拖放文件到此处上传</h2>
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
                  selection={selectedObjects}
                  preview={preview}
                  loading={previewLoading}
                  error={previewError}
                  onClose={() => setInspector(false)}
                  onDownload={() => download(selectedObjects)}
                  onShare={
                    !isDemo && selectedObject
                      ? () =>
                          setShareContext({
                            connectionId: current.connectionId,
                            bucket: current.bucket,
                            objectKey: selectedObject.key,
                          })
                      : undefined
                  }
                  downloadBusy={downloadBusy}
                  onRetry={() => setPreviewRevision((value) => value + 1)}
                  onCopyError={() => notify('复制失败，请重试', true)}
                  previewVersion={previewVersion}
                  onManage={!isDemo && selectedObject ? () => setModal('object-tools') : undefined}
                  bucket={current.bucket}
                  connection={connection}
                  region={current.region}
                />
              )}
            </div>
          )}
        </main>
      </div>
      <footer className="statusbar">
        <span>
          <span className="status-dot" />
          {isDemo
            ? '演示模式'
            : current
              ? connection?.provider === 's3'
                ? 'S3 工作空间'
                : 'OSS 工作空间'
              : '就绪'}
          <i />
          {current?.region || '本地工作空间'}
        </span>
        <button onClick={() => setPage('transfers')} aria-label="查看传输任务">
          {running ? <Loader2 size={11} className="spin" /> : <CheckCircle2 size={11} />}{' '}
          {running
            ? `${running} 个任务正在传输 · ${transferProgress}%`
            : transfers.length
              ? `${transfers.filter((t) => t.status === 'completed').length} 个传输已完成`
              : '所有传输已就绪'}
          {running > 0 && (
            <span
              className="status-progress"
              role="progressbar"
              aria-label="正在传输任务总体进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={transferProgress}
            >
              <i style={{ width: `${transferProgress}%` }} />
            </span>
          )}
          {failed > 0 && <span className="error-text">{failed} 个失败</span>}
          <ChevronRight size={11} />
        </button>
        <span className="statusbar-platform">
          {window.ossDesk?.platform || 'Web Preview'}
          <i />
          UTF-8
        </span>
      </footer>
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
      <input
        ref={(element) => {
          folderInputRef.current = element;
          element?.setAttribute('webkitdirectory', '');
        }}
        type="file"
        multiple
        className="visually-hidden"
        tabIndex={-1}
        aria-label="选择上传文件夹"
        onChange={(e) => {
          if (e.target.files) droppedFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {modal === 'object-tools' && current && selectedObject && connection && (
        <ObjectToolsDialog
          connection={connection}
          bucket={current.bucket}
          object={selectedObject}
          onClose={() => {
            setModal(null);
            setRevision((value) => value + 1);
          }}
          onChanged={() => setPreviewRevision((value) => value + 1)}
        />
      )}
      {modal === 'sync' && current && (
        <SyncDialog
          connectionId={current.connectionId}
          bucket={current.bucket}
          prefix={current.prefix}
          onClose={() => setModal(null)}
          onChanged={() => setRevision((value) => value + 1)}
        />
      )}
      {modal === 'connections-tools' && (
        <ConnectionToolsDialog
          onClose={() => setModal(null)}
          onImported={() => {
            void storage
              .connections()
              .then(setConnections)
              .catch((error) => notify(errorMessage(error), true));
          }}
          onDraft={(draft) => {
            setConnectionDraft(draft);
            setEditConnection(undefined);
            setModal('connection');
          }}
        />
      )}
      {shareContext && <ShareDialog {...shareContext} onClose={() => setShareContext(undefined)} />}
      {pendingUpload && (
        <UploadDialog
          context={pendingUpload}
          onClose={() => setPendingUpload(undefined)}
          onStart={(policy) => void upload(pendingUpload, policy)}
        />
      )}
      {operationContext && (
        <OperationDialog
          context={operationContext}
          onClose={() => setOperationContext(undefined)}
          onExecute={(id) => void executeOperation(id)}
        />
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? 'toast-error' : ''}`}
          role={toast.error ? 'alert' : 'status'}
        >
          {toast.error ? <HelpCircle size={17} /> : <CheckCircle2 size={17} />}
          <span>{toast.text}</span>
          {toast.transfers && (
            <button
              onClick={() => {
                setPage('transfers');
                setToast(undefined);
              }}
            >
              查看任务
            </button>
          )}
          <button aria-label="关闭通知" onClick={() => setToast(undefined)}>
            <X size={14} />
          </button>
        </div>
      )}
      {contextMenu && (
        <div
          ref={menuRef}
          className="object-context-menu"
          role="menu"
          aria-label="文件操作菜单"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            const buttons = [
              ...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
            ];
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
              e.preventDefault();
              const next =
                e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? buttons.length - 1
                    : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
              buttons[next]?.focus();
            } else if (e.key === 'Tab') {
              closeContextMenu();
            }
          }}
        >
          {contextMenu.object ? (
            <>
              {checked.size === 1 && (
                <button
                  role="menuitem"
                  onClick={() => {
                    openObject(contextMenu.object!);
                    closeContextMenu();
                  }}
                >
                  <FolderOpen size={14} />
                  {contextMenu.object.kind === 'folder' ? '打开文件夹' : '预览文件'}
                  <kbd>Enter</kbd>
                </button>
              )}
              <button
                role="menuitem"
                disabled={downloadBusy || !selectedObjects.length}
                onClick={() => {
                  void download(selectedObjects);
                  closeContextMenu();
                }}
              >
                <Download size={14} />
                下载所选
              </button>
              <button role="menuitem" onClick={() => beginOperation('copy')}>
                <Copy size={14} />
                复制到…
              </button>
              {!isDemo &&
                selectedObjects.length === 1 &&
                selectedObjects[0].kind === 'file' &&
                current && (
                  <button
                    role="menuitem"
                    onClick={() => {
                      setShareContext({
                        connectionId: current.connectionId,
                        bucket: current.bucket,
                        objectKey: selectedObjects[0].key,
                      });
                      closeContextMenu();
                    }}
                  >
                    <Link size={14} />
                    分享文件
                  </button>
                )}
              <button role="menuitem" onClick={() => beginOperation('move')}>
                <ArrowRight size={14} />
                移动到…
              </button>
              {checked.size === 1 && (
                <button role="menuitem" onClick={() => beginOperation('rename')}>
                  <Settings2 size={14} />
                  重命名<kbd>F2</kbd>
                </button>
              )}
              <button
                role="menuitem"
                className="error-text"
                onClick={() => beginOperation('delete')}
              >
                <Trash2 size={14} />
                删除<kbd>Del</kbd>
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  void copyPath(selectedObjects.map((o) => o.key).join('\n'));
                  closeContextMenu();
                }}
              >
                <Copy size={14} />
                复制对象路径
              </button>
            </>
          ) : (
            <>
              <button
                role="menuitem"
                disabled={uploadBusy}
                onClick={() => {
                  void pickUpload();
                  closeContextMenu();
                }}
              >
                <Upload size={14} />
                上传文件
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  closeContextMenu();
                  newFolder();
                }}
              >
                <FolderPlus size={14} />
                新建文件夹
              </button>
              <button
                role="menuitem"
                disabled={loading}
                onClick={() => {
                  setRevision((value) => value + 1);
                  closeContextMenu();
                }}
              >
                <RefreshCw size={14} />
                刷新
              </button>
            </>
          )}
        </div>
      )}
      {modal === 'connection' && (
        <ConnectionDialog
          connection={editConnection}
          draft={connectionDraft}
          onClose={() => {
            setModal(null);
            setEditConnection(undefined);
            setConnectionDraft(undefined);
          }}
          onSaved={saveConnection}
        />
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
          subtitle="调整界面主题和文件列表密度"
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
          <UpdateControls />
          <div className="settings-about">
            <Box size={25} />
            <strong>
              StorDock <span>0.2.0</span>
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
        <Modal title="帮助与快捷键" subtitle="常用操作与键盘快捷键" onClose={() => setModal(null)}>
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
              <span>双击或选中后 Enter</span>
            </div>
            <div>
              <span>预览文件</span>
              <span>双击文件；Space 切换详情栏</span>
            </div>
            <div>
              <span>加选 / 连续选择</span>
              <kbd>Ctrl / ⌘ 点击 · Shift 点击</kbd>
            </div>
            <div>
              <span>全选已加载项目</span>
              <kbd>Ctrl / ⌘ A</kbd>
            </div>
            <div>
              <span>编辑目录路径</span>
              <kbd>Ctrl / ⌘ L</kbd>
            </div>
            <div>
              <span>上一级 / 后退 / 前进</span>
              <kbd>Alt ↑ / ← / →</kbd>
            </div>
            <div>
              <span>上传文件</span>
              <span>拖入列表或点击上传</span>
            </div>
          </div>
          <div className="help-note">
            <ShieldCheck size={18} />
            <p>
              真实存储连接请使用桌面客户端。请使用对应服务的受限账号；指定 Bucket
              可避免申请列举全部存储桶权限。当前列表筛选仅匹配已加载项目；搜索子目录会按页扫描当前路径下的对象，产生正常的
              OSS 请求费用。
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
