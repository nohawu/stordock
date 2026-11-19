import type { StorageBridge } from '../types';
import { demo, demoConnection, DEMO_ID } from './demo';
function native() {
  if (!window.ossDesk)
    throw new Error(
      '真实 OSS 连接需要桌面客户端，请运行 npm run desktop。浏览器模式可体验完整演示空间。',
    );
  return window.ossDesk;
}
const isDemo = (id: string) => id === DEMO_ID;
export const storage: StorageBridge = {
  async connections() {
    return [demoConnection, ...(window.ossDesk ? await window.ossDesk.connections() : [])];
  },
  saveConnection: (input) => native().saveConnection(input),
  testConnection: (input) => native().testConnection(input),
  removeConnection: (id) => native().removeConnection(id),
  buckets: (id) => (isDemo(id) ? demo.buckets(id) : native().buckets(id)),
  list: (request) => (isDemo(request.connectionId) ? demo.list(request) : native().list(request)),
  preview: (id, bucket, object) =>
    isDemo(id) ? demo.preview(id, bucket, object) : native().preview(id, bucket, object),
  pickUpload: () => native().pickUpload(),
  upload: (id, bucket, prefix, items) =>
    isDemo(id)
      ? demo.upload(id, bucket, prefix, items)
      : native().upload(id, bucket, prefix, items),
  download: (id, bucket, objects) =>
    isDemo(id) ? demo.download(id, bucket, objects) : native().download(id, bucket, objects),
  createFolder: (id, bucket, prefix, name) =>
    isDemo(id)
      ? demo.createFolder(id, bucket, prefix, name)
      : native().createFolder(id, bucket, prefix, name),
  onTransfer(listener) {
    const offDemo = demo.onTransfer(listener);
    const offNative = window.ossDesk?.onTransfer(listener);
    return () => {
      offDemo();
      offNative?.();
    };
  },
};
