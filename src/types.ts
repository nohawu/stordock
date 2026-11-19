export type Connection = {
  id: string;
  name: string;
  provider: 'aliyun';
  region: string;
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  hasSecret?: boolean;
  temporary?: boolean;
};
export type ConnectionInput = Omit<Connection, 'id'> & {
  id?: string;
  accessKeySecret: string;
  stsToken?: string;
  remember: boolean;
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
export type Transfer = {
  id: string;
  name: string;
  direction: 'upload' | 'download';
  status: 'running' | 'completed' | 'failed';
  progress: number;
  size: number;
  error?: string;
  bucket: string;
  startedAt: number;
};
export type UploadItem = { name: string; path?: string; file?: File };
export interface StorageBridge {
  connections(): Promise<Connection[]>;
  saveConnection(input: ConnectionInput): Promise<Connection>;
  testConnection(input: ConnectionInput): Promise<{ buckets: Bucket[] }>;
  removeConnection(id: string): Promise<void>;
  buckets(connectionId: string): Promise<Bucket[]>;
  list(request: ListRequest): Promise<ListResult>;
  preview(connectionId: string, bucket: string, object: StorageObject): Promise<Preview>;
  pickUpload(): Promise<UploadItem[]>;
  upload(connectionId: string, bucket: string, prefix: string, items: UploadItem[]): Promise<void>;
  download(connectionId: string, bucket: string, objects: StorageObject[]): Promise<void>;
  createFolder(connectionId: string, bucket: string, prefix: string, name: string): Promise<void>;
  onTransfer(listener: (transfer: Transfer) => void): () => void;
}
declare global {
  interface Window {
    ossDesk?: StorageBridge & { platform: string; filePath(file: File): string };
  }
}
