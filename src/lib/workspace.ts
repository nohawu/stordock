export type WorkspaceTab = {
  id: string;
  connectionId: string;
  bucket: string;
  region: string;
  prefix: string;
  query: string;
  searchMode: 'loaded' | 'recursive';
  searchQuery: string;
  filter: string;
  sort: { field: 'name' | 'size' | 'lastModified'; ascending: boolean };
  selection: string[];
  anchor: string;
  scrollTop: number;
  history: string[];
  position: number;
};
export type Bookmark = {
  connectionId: string;
  bucket: string;
  region: string;
  prefix: string;
  name: string;
};
const text = (value: unknown, max = 1024): value is string =>
  typeof value === 'string' && value.length <= max && !/[\x00-\x1f]/.test(value);
export function readWorkspace(fallback: WorkspaceTab): {
  tabs: WorkspaceTab[];
  activeId: string;
  bookmarks: Bookmark[];
} {
  try {
    const raw = localStorage.getItem('stordock-workspace-v1');
    if (!raw || raw.length > 262144) throw new Error();
    const saved = JSON.parse(raw);
    const tabs: WorkspaceTab[] = (Array.isArray(saved.tabs) ? saved.tabs : [])
      .slice(0, 30)
      .filter(
        (item: WorkspaceTab) =>
          item &&
          text(item.connectionId, 100) &&
          text(item.bucket, 63) &&
          text(item.region, 100) &&
          text(item.prefix) &&
          (!item.prefix || item.prefix.endsWith('/')),
      )
      .map((item: WorkspaceTab) => ({
        ...fallback,
        id: `${item.connectionId}/${item.bucket}`,
        connectionId: item.connectionId,
        bucket: item.bucket,
        region: item.region,
        prefix: item.prefix,
        query: text(item.query, 200) ? item.query : '',
        searchMode: item.searchMode === 'recursive' ? 'recursive' : 'loaded',
        searchQuery: text(item.searchQuery, 200) ? item.searchQuery : '',
        filter: ['all', 'image', 'document', 'folder'].includes(item.filter) ? item.filter : 'all',
        sort:
          item.sort && ['name', 'size', 'lastModified'].includes(item.sort.field)
            ? { field: item.sort.field, ascending: item.sort.ascending !== false }
            : fallback.sort,
        history: [item.prefix],
        position: 0,
        selection: [],
        anchor: '',
        scrollTop: 0,
      }));
    const unique = [...new Map(tabs.map((item) => [item.id, item])).values()];
    const bookmarks = (Array.isArray(saved.bookmarks) ? saved.bookmarks : [])
      .slice(0, 100)
      .filter(
        (item: Bookmark) =>
          item &&
          text(item.connectionId, 100) &&
          text(item.bucket, 63) &&
          text(item.region, 100) &&
          text(item.prefix) &&
          (!item.prefix || item.prefix.endsWith('/')) &&
          text(item.name, 200),
      );
    return {
      tabs: unique.length ? unique : [fallback],
      activeId: unique.some((tab) => tab.id === saved.activeId)
        ? saved.activeId
        : unique[0]?.id || fallback.id,
      bookmarks,
    };
  } catch {
    return { tabs: [fallback], activeId: fallback.id, bookmarks: [] };
  }
}
export function saveWorkspace(tabs: WorkspaceTab[], activeId: string, bookmarks: Bookmark[]) {
  try {
    localStorage.setItem(
      'stordock-workspace-v1',
      JSON.stringify({
        tabs: tabs
          .slice(0, 30)
          .map(({ selection, anchor, scrollTop, history, position, ...tab }) => tab),
        activeId,
        bookmarks: bookmarks.slice(0, 100),
      }),
    );
  } catch {
    /* Browsing remains available if local preferences cannot be saved. */
  }
}
