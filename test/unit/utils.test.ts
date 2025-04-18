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
  
  test('safeJsonStringify properly handles nested objects and arrays', () => {
    const nested = {
      level1: {
        level2: {
          level3: {
            value: 'deep',
            array: [1, 2, { nested: 'value' }]
          }
        },
        sibling: 'value'
      },
      array: [
        { item: 1 },
        { item: 2, subItems: [3, 4, 5] }
      ]
    };
    expect(safeJsonStringify(nested)).toBe(JSON.stringify(nested));
  });
  
  test('safeJsonStringify handles null and undefined values', () => {
    const data = {
      nullValue: null,
      undefinedValue: undefined,
      validValue: 'test'
    };
    // Expected: {"nullValue":null,"validValue":"test"}
    // undefined values get omitted in standard JSON.stringify
    expect(safeJsonStringify(data)).toBe('{"nullValue":null,"validValue":"test"}');
  });
  
  test('safeJsonStringify handles special types like Date', () => {
    const now = new Date();
    const data = {
      date: now,
      text: 'test'
    };
    expect(safeJsonStringify(data)).toBe(JSON.stringify(data));
    expect(safeJsonStringify(data)).toContain(now.toISOString().replace(/"/g, ''));
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
  
  test('createPostgresClient configures max connections', () => {
    const baseConfig: DatabaseConfig = {
      host: 'localhost',
      port: 5432,
      database: 'testdb',
      user: 'user',
      password: 'pass'
    };
    
    const sql = createPostgresClient(baseConfig) as any;
    expect(sql.options.max).toBe(10); // Default max connections
  });
  
  test('createPostgresClient handles missing host', () => {
    const invalidConfig: DatabaseConfig = {
      host: '',
      port: 5432,
      database: 'testdb',
      user: 'user',
      password: 'pass'
    };
    
    expect(() => createPostgresClient(invalidConfig)).toThrow('Database host is required');
  });
  
  test('createPostgresClient handles missing database', () => {
    const invalidConfig: DatabaseConfig = {
      host: 'localhost',
      port: 5432,
      database: '',
      user: 'user',
      password: 'pass'
    };
    
    expect(() => createPostgresClient(invalidConfig)).toThrow('Database name is required');
  });
  
  test('createPostgresClient sets application name', () => {
    const baseConfig: DatabaseConfig = {
      host: 'localhost',
      port: 5432,
      database: 'testdb',
      user: 'user',
      password: 'pass'
    };
    
    const sql = createPostgresClient(baseConfig) as any;
    expect(sql.options.connection.application_name).toBe('postgres-mcp');
  });
}); 