import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Database, Folder, Loader2 } from 'lucide-react';
import type { Bucket, StorageObject } from '../types';
import { storage } from '../lib/storage';

type Props = {
  connectionId: string;
  bucket: Bucket;
  currentPrefix?: string;
  revision: number;
  onOpen(prefix: string): void;
};

export function DirectoryTree(props: Props) {
  return <DirectoryNode {...props} prefix="" name={props.bucket.name} depth={0} />;
}

function DirectoryNode({
  prefix,
  name,
  depth,
  ...props
}: Props & {
  prefix: string;
  name: string;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [folders, setFolders] = useState<StorageObject[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const pending = useRef(false);
  const { connectionId, bucket, currentPrefix, revision, onOpen } = props;
  // Invalidate hidden branches too, so reopening never shows an old directory snapshot.
  useEffect(() => {
    generation.current++;
    pending.current = false;
    setLoaded(false);
    setLoading(false);
    setCursor(undefined);
    setError('');
    return () => {
      generation.current++;
    };
  }, [connectionId, bucket.name, revision]);
  useEffect(() => {
    if (
      currentPrefix !== undefined &&
      currentPrefix.startsWith(prefix) &&
      (prefix !== '' || currentPrefix !== '')
    )
      setExpanded(true);
  }, [currentPrefix, prefix]);
  async function load(more = false) {
    if (pending.current) return;
    pending.current = true;
    const request = generation.current;
    setLoading(true);
    setError('');
    try {
      const result = await storage.list({
        connectionId,
        bucket: bucket.name,
        prefix,
        cursor: more ? cursor : undefined,
      });
      if (generation.current !== request) return;
      setFolders((previous) => [
        ...new Map(
          [
            ...(more ? previous : []),
            ...result.objects.filter((object) => object.kind === 'folder'),
          ].map((object) => [object.key, object]),
        ).values(),
      ]);
      setCursor(result.cursor);
      setLoaded(true);
    } catch (e) {
      if (generation.current === request) setError(e instanceof Error ? e.message : '目录加载失败');
    } finally {
      if (generation.current === request) {
        pending.current = false;
        setLoading(false);
      }
    }
  }
  useEffect(() => {
    if (expanded && !loaded && !error) void load();
  }, [expanded, loaded, error, revision]);
  return (
    <div className="directory-node">
      <div
        className={`directory-row ${currentPrefix === prefix ? 'active' : ''}`}
        style={{ paddingLeft: depth * 13 }}
      >
        <button
          className="directory-toggle"
          aria-label={`${expanded ? '收起' : '展开'}目录 ${prefix || bucket.name}`}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {loading ? (
            <Loader2 size={12} className="spin" />
          ) : expanded ? (
            <ChevronDown size={12} />
          ) : (
            <ChevronRight size={12} />
          )}
        </button>
        <button
          className="directory-name"
          aria-label={depth ? `打开目录 ${prefix}` : undefined}
          title={prefix || `${bucket.name} · ${bucket.region}`}
          onClick={() => onOpen(prefix)}
        >
          {depth === 0 ? <Database size={14} /> : <Folder size={14} />}
          <span>{name}</span>
          {currentPrefix === prefix && <i className="tree-active-dot" />}
        </button>
      </div>
      {expanded && (
        <div>
          {folders.map((folder) => (
            <DirectoryNode
              {...props}
              key={folder.key}
              prefix={folder.key}
              name={folder.name}
              depth={depth + 1}
            />
          ))}
          {error && (
            <button
              className="directory-message error-text"
              title={error}
              onClick={() => void load(loaded)}
            >
              加载失败，点击重试
            </button>
          )}
          {!error && loaded && !folders.length && !cursor && (
            <div className="directory-message">没有子目录</div>
          )}
          {cursor && !error && (
            <button
              className="directory-message"
              disabled={loading}
              onClick={() => void load(true)}
            >
              {loading ? '正在加载…' : '继续加载目录'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
