export type Connection = {
  id: string;
  name: string;
  provider: 'aliyun' | 's3';
  forcePathStyle?: boolean;
  allowInsecure?: boolean;
  region: string;
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  hasSecret?: boolean;
  temporary?: boolean;
  credentialRefreshUrl?: string;
};
export type ConnectionInput = Omit<Connection, 'id'> & {
  id?: string;
  accessKeySecret: string;
  stsToken?: string;
  remember: boolean;
  keepCredentials?: boolean;
  clearStsToken?: boolean;
  credentialRefreshToken?: string;
};
export type Bucket = { name: string; region: string; createdAt?: string };
export type StorageObject = {
  key: string;
  name: string;
  kind: 'folder' | 'file';
  size: number;
  lastModified: string;
  storageClass: string;
  etag?: string;
  versionId?: string;
};
export type ListRequest = {
  connectionId: string;
  bucket: string;
  prefix: string;
  query?: string;
  cursor?: string;
};
export type ListResult = { objects: StorageObject[]; cursor?: string; scanned?: number };
export type Preview = {
  kind: 'image' | 'text' | 'unsupported';
  content?: string;
  mime?: string;
  size: number;
};
export type ObjectInfo = {
  size?: number;
  lastModified?: string;
  etag?: string;
  storageClass?: string;
  contentType?: string;
  cacheControl?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  contentLanguage?: string;
  versionId?: string;
  restore?: string;
  metadata: Record<string, string>;
  expires?: string;
};
export type Transfer = {
  id: string;
  name: string;
  direction: 'upload' | 'download' | 'copy' | 'move' | 'delete';
  status:
    | 'queued'
    | 'running'
    | 'cancelling'
    | 'paused'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'skipped';
  progress: number;
  size: number;
  error?: string;
  bucket: string;
  startedAt: number;
  connectionId?: string;
  localPath?: string;
  speed?: number;
  remaining?: number;
  transferred?: number;
  attempt?: number;
  canRetry?: boolean;
  canPause?: boolean;
};
export type ConflictPolicy = 'reject' | 'skip' | 'rename' | 'overwrite';
export type UploadSummary = {
  completed: number;
  failed: number;
  skipped: number;
  cancelled: number;
  paused?: number;
};
export type ObjectOperation = 'copy' | 'move' | 'rename' | 'delete';
export type OperationPlan = { id: string; count: number; size: number };
export type UploadItem = {
  name: string;
  path?: string;
  file?: File;
  relativePath?: string;
  directory?: boolean;
};
export interface StorageBridge {
  feature<T = unknown>(action: string, input?: Record<string, unknown>): Promise<T>;
  connections(): Promise<Connection[]>;
  saveConnection(input: ConnectionInput): Promise<Connection>;
  testConnection(input: ConnectionInput): Promise<{ buckets: Bucket[] }>;
  removeConnection(id: string): Promise<void>;
  buckets(connectionId: string): Promise<Bucket[]>;
  list(request: ListRequest): Promise<ListResult>;
  preview(connectionId: string, bucket: string, object: StorageObject): Promise<Preview>;
  objectInfo(connectionId: string, bucket: string, key: string): Promise<ObjectInfo>;
  signedUrl(
    connectionId: string,
    bucket: string,
    key: string,
    expires: number,
  ): Promise<{ url: string; expiresAt: number }>;
  pickUpload(mode?: 'files' | 'folder'): Promise<UploadItem[]>;
  upload(
    connectionId: string,
    bucket: string,
    prefix: string,
    items: UploadItem[],
    conflict?: ConflictPolicy,
  ): Promise<UploadSummary>;
  download(connectionId: string, bucket: string, objects: StorageObject[]): Promise<void>;
  createFolder(connectionId: string, bucket: string, prefix: string, name: string): Promise<void>;
  onTransfer(listener: (transfer: Transfer) => void): () => void;
  prepareOperation(
    connectionId: string,
    bucket: string,
    objects: StorageObject[],
    operation: ObjectOperation,
    target?: string,
  ): Promise<OperationPlan>;
  executeOperation(planId: string): Promise<Transfer>;
  cancelTransfer(id: string): Promise<void>;
  pauseTransfer(id: string): Promise<void>;
  listTransfers(): Promise<Transfer[]>;
  getTransferConcurrency(): Promise<number>;
  setTransferConcurrency(value: number): Promise<number>;
  revealTransfer(id: string): Promise<void>;
  retryTransfer(id: string): Promise<Transfer | void>;
  clearTransfers(): Promise<void>;
}
declare global {
  interface Window {
    ossDesk?: StorageBridge & {
      platform: string;
      writeClipboardText?(value: string): Promise<void>;
      saveDemoDownload?(bucket: string, key: string, content: ArrayBuffer): Promise<void>;
      filePath(file: File): string;
      setAppearance?(theme: 'light' | 'dark'): Promise<void>;
    };
  }
}
