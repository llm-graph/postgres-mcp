import { describe, expect, test } from 'bun:test';
import { safeJsonStringify, createPostgresClient } from '../../src/utils';
import { DatabaseConfig } from '../../src/types';

describe('Utilities', () => {
  test('safeJsonStringify returns JSON string for valid data', () => {
    const data = { name: 'test', values: [1, 2, 3] };
    expect(safeJsonStringify(data)).toBe(JSON.stringify(data));
  });

  test('safeJsonStringify returns empty array string for circular references', () => {
    const circular: any = { self: null };
    circular.self = circular;
    expect(safeJsonStringify(circular)).toBe('[]');
  });
  
  test('createPostgresClient configures SSL based on config value', () => {
    const baseConfig: DatabaseConfig = {
      host: 'localhost',
      port: 5432,
      database: 'testdb',
      user: 'user',
      password: 'pass'
    };
    
    const sqlDisable = createPostgresClient({ ...baseConfig, ssl: 'disable' }) as any;
    expect(sqlDisable.options.ssl).toBe(false);
    
    const sqlRequire = createPostgresClient({ ...baseConfig, ssl: 'require' }) as any;
    expect(sqlRequire.options.ssl.rejectUnauthorized).toBe(false);
    
    const sqlVerifyFull = createPostgresClient({ ...baseConfig, ssl: 'verify-full' }) as any;
    expect(sqlVerifyFull.options.ssl.rejectUnauthorized).toBe(true);
    
    const sqlDefault = createPostgresClient(baseConfig) as any;
    expect(sqlDefault.options.ssl).toBeFalsy();
  });
}); 