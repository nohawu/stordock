const https = require('node:https');
class CredentialRefresh {
  constructor(vault) {
    this.vault = vault;
    this.cache = new Map();
    this.pending = new Map();
  }
  async get(id) {
    const connection = await this.vault.get(id);
    if (!connection.credentialRefreshUrl) return connection;
    const cached = this.cache.get(id);
    const identity = `${connection.credentialRefreshUrl}\0${connection.credentialRefreshToken || ''}`;
    if (cached?.identity === identity && cached.expiration > Date.now() + 60000)
      return { ...connection, ...cached.credentials };
    if (this.pending.get(id)?.identity === identity) return this.pending.get(id).request;
    const request = this.refresh(connection).finally(() => {
      if (this.pending.get(id)?.request === request) this.pending.delete(id);
    });
    this.pending.set(id, { identity, request });
    return request;
  }
  async refresh(connection, cache = true) {
    const data = await new Promise((resolve, reject) => {
      const request = https.get(
        connection.credentialRefreshUrl,
        {
          timeout: 10000,
          headers: connection.credentialRefreshToken
            ? { Authorization: `Bearer ${connection.credentialRefreshToken}` }
            : {},
        },
        (response) => {
          if (response.statusCode !== 200) {
            response.resume();
            reject(new Error('临时凭据刷新服务返回错误'));
            return;
          }
          const chunks = [];
          let size = 0;
          response.on('data', (chunk) => {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += bytes.length;
            if (size > 65536) response.destroy(new Error('临时凭据响应过大'));
            else chunks.push(bytes);
          });
          response.on('end', () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            } catch {
              reject(new Error('临时凭据响应格式无效'));
            }
          });
          response.on('error', () => reject(new Error('读取临时凭据失败')));
        },
      );
      request.on('timeout', () => request.destroy(new Error('凭据刷新超时')));
      request.on('error', () => reject(new Error('无法访问临时凭据刷新服务')));
    });
    const value = data.Credentials || data.credentials || data;
    const credentials = {
      accessKeyId: value.AccessKeyId || value.accessKeyId,
      accessKeySecret: value.AccessKeySecret || value.SecretAccessKey || value.accessKeySecret,
      stsToken: value.SecurityToken || value.SessionToken || value.securityToken || value.stsToken,
    };
    const expiration = Date.parse(value.Expiration || value.expiration);
    if (
      Object.values(credentials).some(
        (value) => typeof value !== 'string' || !value || value.length > 16384,
      ) ||
      !Number.isFinite(expiration) ||
      expiration <= Date.now() + 60000
    )
      throw new Error('刷新响应缺少有效的临时凭据或到期时间');
    if (cache)
      this.cache.set(connection.id, {
        identity: `${connection.credentialRefreshUrl}\0${connection.credentialRefreshToken || ''}`,
        credentials,
        expiration,
      });
    return { ...connection, ...credentials };
  }
  invalidate(id) {
    this.cache.delete(id);
  }
}
module.exports = { CredentialRefresh };
