import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { 
  DEFAULT_SERVER_CONFIG, 
  loadDbAliases, 
  loadDefaultDbAlias,
  loadEnableAuth,
  loadApiKey,
  createDbConfigFromEnv,
  getServerConfig
} from '../../src/constants';

describe('Constants', () => {
  const originalEnv = { ...process.env };
  
  beforeEach(() => {
    process.env = {};
  });
  
  afterEach(() => {
    process.env = originalEnv;
  });
  
  test('DEFAULT_SERVER_CONFIG has expected properties', () => {
    expect(DEFAULT_SERVER_CONFIG).toHaveProperty('name', 'FastPostgresMCP');
    expect(DEFAULT_SERVER_CONFIG).toHaveProperty('version', '1.0.0');
    expect(DEFAULT_SERVER_CONFIG).toHaveProperty('defaultDbAlias', 'main');
    expect(DEFAULT_SERVER_CONFIG).toHaveProperty('enableAuth', false);
  });
  
  test('loadDbAliases returns array from DB_ALIASES', () => {
    process.env['DB_ALIASES'] = 'main,reporting';
    expect(loadDbAliases()).toEqual(['main', 'reporting']);
  });
  
  test('loadDbAliases returns default when env not set', () => {
    expect(loadDbAliases()).toEqual(['main']);
  });
  
  test('loadDefaultDbAlias returns from DEFAULT_DB_ALIAS', () => {
    process.env['DEFAULT_DB_ALIAS'] = 'reporting';
    expect(loadDefaultDbAlias()).toEqual('reporting');
  });
  
  test('loadDefaultDbAlias returns default when env not set', () => {
    expect(loadDefaultDbAlias()).toEqual('main');
  });
  
  test('loadEnableAuth returns true for "true" string', () => {
    process.env['ENABLE_AUTH'] = 'true';
    expect(loadEnableAuth()).toEqual(true);
  });
  
  test('loadEnableAuth returns true for "1" string', () => {
    process.env['ENABLE_AUTH'] = '1';
    expect(loadEnableAuth()).toEqual(true);
  });
  
  test('loadEnableAuth returns false for other values', () => {
    expect(loadEnableAuth()).toEqual(false);
    process.env['ENABLE_AUTH'] = 'false';
    expect(loadEnableAuth()).toEqual(false);
  });
  
  test('loadApiKey returns MCP_API_KEY value', () => {
    process.env['MCP_API_KEY'] = 'test-key';
    expect(loadApiKey()).toEqual('test-key');
  });
  
  test('loadApiKey returns undefined when not set', () => {
    expect(loadApiKey()).toBeUndefined();
  });
  
  test('createDbConfigFromEnv creates config from environment variables', () => {
    process.env['DB_TEST_HOST'] = 'test-host';
    process.env['DB_TEST_PORT'] = '5433';
    process.env['DB_TEST_NAME'] = 'test-db';
    process.env['DB_TEST_USER'] = 'test-user';
    process.env['DB_TEST_PASSWORD'] = 'test-password';
    process.env['DB_TEST_SSL'] = 'require';
    
    const config = createDbConfigFromEnv('test');
    expect(config).toEqual({
      host: 'test-host',
      port: 5433,
      database: 'test-db',
      user: 'test-user',
      password: 'test-password',
      ssl: 'require'
    });
  });
  
  test('createDbConfigFromEnv uses defaults for missing values', () => {
    const config = createDbConfigFromEnv('missing');
    expect(config).toEqual({
      host: 'localhost',
      port: 5432,
      database: 'postgres',
      user: 'postgres',
      password: '',
      ssl: undefined
    });
  });
  
  test('getServerConfig combines default and environment values', () => {
    process.env['DEFAULT_DB_ALIAS'] = 'test';
    process.env['ENABLE_AUTH'] = 'true';
    process.env['MCP_API_KEY'] = 'test-key';
    
    const config = getServerConfig();
    expect(config).toEqual({
      name: 'FastPostgresMCP',
      version: '1.0.0',
      defaultDbAlias: 'test',
      enableAuth: true,
      apiKey: 'test-key'
    });
  });
}); 