import { describe, expect, it } from 'vitest';
import { objectAddress } from '../src/lib/addresses';

describe('object addresses', () => {
  it('builds the OSS bucket domain with exact key encoding and no credentials', () => {
    const address = objectAddress(
      { provider: 'aliyun', endpoint: '', region: 'cn-shanghai' },
      'my-bucket',
      '目录/a b+#?%!.txt',
    );
    expect(address.httpUrl).toBe(
      'https://my-bucket.oss-cn-shanghai.aliyuncs.com/%E7%9B%AE%E5%BD%95/a%20b%2B%23%3F%25%21.txt',
    );
    expect(address.uri).toBe('oss://my-bucket/目录/a b+#?%!.txt');
  });
  it('respects OSS custom endpoints, internal hosts and ports', () => {
    expect(
      objectAddress(
        {
          provider: 'aliyun',
          endpoint: 'https://oss-cn-hangzhou-internal.aliyuncs.com:8443',
          region: 'cn-hangzhou',
        },
        'my-bucket',
        'dir/file.txt',
      ).httpUrl,
    ).toBe('https://my-bucket.oss-cn-hangzhou-internal.aliyuncs.com:8443/dir/file.txt');
    expect(
      objectAddress(
        { provider: 'aliyun', endpoint: 'https://127.0.0.1:8443', region: 'cn-hangzhou' },
        'my-bucket',
        'file.txt',
      ).httpUrl,
    ).toBe('https://127.0.0.1:8443/file.txt');
  });
  it('keeps S3 reverse proxy paths, ports and path-style addressing', () => {
    expect(
      objectAddress(
        {
          provider: 's3',
          endpoint: 'http://127.0.0.1:9000/proxy/s3/',
          region: 'auto',
          forcePathStyle: true,
        },
        'media.bucket',
        'folder//a%2Fb.txt',
      ).httpUrl,
    ).toBe('http://127.0.0.1:9000/proxy/s3/media.bucket/folder//a%252Fb.txt');
  });
  it('supports S3 virtual-host addressing without dropping a proxy path', () => {
    const address = objectAddress(
      {
        provider: 's3',
        endpoint: 'https://storage.example.com:9443/proxy',
        region: 'auto',
        forcePathStyle: false,
      },
      'media',
      'file.txt',
    );
    expect(address.httpUrl).toBe('https://media.storage.example.com:9443/proxy/file.txt');
    expect(address.uri).toBe('s3://media/file.txt');
  });
  it('uses SDK-compatible path-style addresses for dotted buckets over TLS and IP endpoints', () => {
    expect(
      objectAddress(
        {
          provider: 's3',
          endpoint: 'https://storage.example.com:9443/proxy',
          region: 'auto',
          forcePathStyle: false,
        },
        'media.bucket',
        'file.txt',
      ).httpUrl,
    ).toBe('https://storage.example.com:9443/proxy/media.bucket/file.txt');
    expect(
      objectAddress(
        {
          provider: 's3',
          endpoint: 'http://127.0.0.1:9000',
          region: 'auto',
          forcePathStyle: false,
        },
        'media',
        'file.txt',
      ).httpUrl,
    ).toBe('http://127.0.0.1:9000/media/file.txt');
  });
});
