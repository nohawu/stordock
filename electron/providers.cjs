const { AliyunProvider } = require('./oss.cjs');
const { S3Provider } = require('./s3.cjs');
const aliyun = new AliyunProvider();
const s3 = new S3Provider();
function providerFor(connection) {
  if (connection.provider === 's3') return s3;
  if (!connection.provider || connection.provider === 'aliyun') return aliyun;
  throw new Error('不支持的存储服务类型');
}
module.exports = { providerFor };
