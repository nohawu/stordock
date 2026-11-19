const fs = require('node:fs/promises');
const path = require('node:path');
const { publicConnection } = require('./core.cjs');

class ConnectionVault {
  constructor(directory, safeStorage) {
    this.file = path.join(directory, 'connections.json');
    this.storage = safeStorage;
    this.session = new Map();
  }
  async records() {
    try {
      return JSON.parse(await fs.readFile(this.file, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw new Error('连接配置无法读取，请检查本地 connections.json');
    }
  }
  async write(records) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(`${this.file}.tmp`, JSON.stringify(records, null, 2), { mode: 0o600 });
    await fs.rename(`${this.file}.tmp`, this.file);
  }
  async list() {
    return [
      ...(await this.records())
        .filter((r) => !this.session.has(r.metadata.id))
        .map((r) => r.metadata),
      ...[...this.session.values()].map(publicConnection),
    ];
  }
  async get(id) {
    if (this.session.has(id)) return this.session.get(id);
    const record = (await this.records()).find((r) => r.metadata.id === id);
    if (!record) throw new Error('连接已不存在，请重新连接');
    try {
      const credentials = JSON.parse(
        (await this.storage.decryptStringAsync(Buffer.from(record.secret, 'base64'))).result,
      );
      return { ...record.metadata, ...credentials, remember: true };
    } catch {
      throw new Error('无法解密连接凭据，请在原设备上使用或重新创建连接');
    }
  }
  async save(connection) {
    let records = (await this.records()).filter((r) => r.metadata.id !== connection.id);
    if (connection.remember) {
      if (
        !(await this.storage.isAsyncEncryptionAvailable()) ||
        (process.platform === 'linux' && this.storage.getSelectedStorageBackend() === 'basic_text')
      )
        throw new Error('系统安全存储不可用，请取消“记住凭据”，使用本次会话连接');
      const secret = await this.storage.encryptStringAsync(
        JSON.stringify({
          accessKeyId: connection.accessKeyId,
          accessKeySecret: connection.accessKeySecret,
          stsToken: connection.stsToken,
        }),
      );
      records.push({ metadata: publicConnection(connection), secret: secret.toString('base64') });
      await this.write(records);
      this.session.delete(connection.id);
    } else {
      await this.write(records);
      this.session.set(connection.id, connection);
    }
    return publicConnection(connection);
  }
  async remove(id) {
    await this.write((await this.records()).filter((r) => r.metadata.id !== id));
    this.session.delete(id);
  }
}
module.exports = { ConnectionVault };
