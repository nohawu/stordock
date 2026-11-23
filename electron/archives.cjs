const {
  randomUUID,
  randomBytes,
  scryptSync,
  createCipheriv,
  createDecipheriv,
} = require('node:crypto');
const { validateConnection } = require('./connection.cjs');
const { publicConnection } = require('./core.cjs');
function configuration(connection) {
  const {
    id,
    hasSecret,
    temporary,
    accessKeySecret,
    stsToken,
    credentialRefreshToken,
    remember,
    ...config
  } = connection;
  return config;
}
function encrypt(connections, password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024)
    throw new Error('备份密码至少 12 个字符');
  const salt = randomBytes(16),
    iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', scryptSync(password, salt, 32), iv);
  const content = Buffer.concat([cipher.update(JSON.stringify(connections)), cipher.final()]);
  return {
    format: 'stordock-encrypted-connections',
    version: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    content: content.toString('base64'),
  };
}
function inspect(input, password) {
  let rows = input.connections,
    encrypted = input.format === 'stordock-encrypted-connections';
  if (encrypted) {
    try {
      if (input.version !== 1 || typeof password !== 'string' || password.length > 1024)
        throw new Error();
      const salt = Buffer.from(input.salt, 'base64'),
        iv = Buffer.from(input.iv, 'base64'),
        tag = Buffer.from(input.tag, 'base64');
      if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', scryptSync(password, salt, 32), iv);
      decipher.setAuthTag(tag);
      rows = JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(input.content, 'base64')),
          decipher.final(),
        ]).toString('utf8'),
      );
    } catch {
      throw new Error('密码错误或备份已损坏');
    }
  } else if (input.format !== 'stordock-connections' || input.version !== 1)
    throw new Error('不是 StorDock 连接配置文件');
  if (!Array.isArray(rows) || !rows.length || rows.length > 100)
    throw new Error('导入文件应包含 1–100 个连接');
  const connections = rows.map((row) => {
    const config = configuration(row);
    const validated = validateConnection({
      ...config,
      id: randomUUID(),
      accessKeyId: config.accessKeyId || 'configure-later',
      accessKeySecret: encrypted ? row.accessKeySecret : 'configure-later',
      stsToken: encrypted ? row.stsToken : '',
      credentialRefreshToken: encrypted ? row.credentialRefreshToken : '',
      remember: true,
    });
    return encrypted
      ? validated
      : { ...configuration(validated), accessKeyId: row.accessKeyId || '' };
  });
  return {
    encrypted,
    connections,
    preview: connections.map((item) => (encrypted ? publicConnection(item) : item)),
  };
}
module.exports = { configuration, encrypt, inspect };
