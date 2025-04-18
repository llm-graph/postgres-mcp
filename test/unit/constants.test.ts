import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { 
  DEFAULT_SERVER_CONFIG, 
  loadDbAliases, 
  loadDefaultDbAlias,
  loadEnableAuth,
  loadApiKey,
  createDbConfigFromEnv,
  getServerConfig,
  validateEnvVars,
  loadDatabaseConnections
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
  
  test('loadDbAliases handles whitespace in alias list', () => {
    process.env['DB_ALIASES'] = 'main, reporting , analytics';
    expect(loadDbAliases()).toEqual(['main', 'reporting', 'analytics']);
  });
  
  test('loadDbAliases handles empty alias names', () => {
    process.env['DB_ALIASES'] = 'main,,reporting';
    expect(loadDbAliases()).toEqual(['main', '', 'reporting']);
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
  
  test('createDbConfigFromEnv parses database URL correctly', () => {
    process.env['DB_TEST_URL'] = 'postgresql://user:pass@hostname:5555/dbname?sslmode=require';
    
    const config = createDbConfigFromEnv('test');
    
    expect(config.host).toBe('hostname');
    expect(config.port).toBe(5555);
    expect(config.database).toBe('dbname');
    expect(config.user).toBe('user');
    expect(config.password).toBe('pass');
    expect(config.ssl).toBe('require');
    
    delete process.env['DB_TEST_URL'];
  });
  
  test('createDbConfigFromEnv handles URLs with no port', () => {
    process.env['DB_TEST_URL'] = 'postgresql://user:pass@hostname/dbname';
    
    const config = createDbConfigFromEnv('test');
    
    expect(config.host).toBe('hostname');
    expect(config.port).toBe(5432); // Default port
    expect(config.database).toBe('dbname');
    expect(config.user).toBe('user');
    expect(config.password).toBe('pass');
    
    delete process.env['DB_TEST_URL'];
  });
  
  test('createDbConfigFromEnv handles URLs with special characters in password', () => {
    process.env['DB_TEST_URL'] = 'postgresql://user:p%40ssw%23rd@hostname/dbname';
    
    const config = createDbConfigFromEnv('test');
    
    expect(config.host).toBe('hostname');
    expect(config.user).toBe('user');
    expect(config.password).toBe('p@ssw#rd'); // Decoded special characters
    
    delete process.env['DB_TEST_URL'];
  });
  
  test('createDbConfigFromEnv handles invalid URL and falls back to env vars', () => {
    process.env['DB_TEST_URL'] = 'invalid-url';
    process.env['DB_TEST_HOST'] = 'fallback-host';
    
    const config = createDbConfigFromEnv('test');
    
    expect(config.host).toBe('fallback-host');
    expect(config.port).toBe(5432);
    
    delete process.env['DB_TEST_URL'];
    delete process.env['DB_TEST_HOST'];
  });
  
  test('validateEnvVars returns true when required vars are present', () => {
    process.env['DB_MAIN_HOST'] = 'localhost';
    process.env['DB_MAIN_NAME'] = 'postgres';
    
    expect(validateEnvVars()).toBe(true);
    
    delete process.env['DB_MAIN_HOST'];
    delete process.env['DB_MAIN_NAME'];
  });
  
  test('validateEnvVars returns true for valid URL-based config', () => {
    process.env['DB_MAIN_URL'] = 'postgresql://postgres:password@localhost:5432/postgres';
    
    expect(validateEnvVars()).toBe(true);
    
    delete process.env['DB_MAIN_URL'];
  });
  
  test('validateEnvVars returns false when host is missing', () => {
    process.env['DB_MAIN_NAME'] = 'postgres';
    // No host specified
    
    expect(validateEnvVars()).toBe(false);
    
    delete process.env['DB_MAIN_NAME'];
  });
  
  test('validateEnvVars returns false when database name is missing', () => {
    process.env['DB_MAIN_HOST'] = 'localhost';
    // No database name specified
    
    expect(validateEnvVars()).toBe(false);
    
    delete process.env['DB_MAIN_HOST'];
  });
  
  test('validateEnvVars returns false for invalid URL', () => {
    process.env['DB_MAIN_URL'] = 'invalid-url';
    
    expect(validateEnvVars()).toBe(false);
    
    delete process.env['DB_MAIN_URL'];
  });
  
  test('validateEnvVars sets default values for non-critical vars', () => {
    process.env['DB_MAIN_HOST'] = 'localhost';
    process.env['DB_MAIN_NAME'] = 'postgres';
    // No port or user specified
    
    expect(validateEnvVars()).toBe(true);
    
    // Should set defaults
    expect(process.env['DB_MAIN_PORT']).toBe('5432');
    expect(process.env['DB_MAIN_USER']).toBe('postgres');
    
    delete process.env['DB_MAIN_HOST'];
    delete process.env['DB_MAIN_NAME'];
    delete process.env['DB_MAIN_PORT'];
    delete process.env['DB_MAIN_USER'];
  });
  
  test('loadDatabaseConnections creates configs for all aliases', () => {
    process.env['DB_ALIASES'] = 'main,test';
    process.env['DB_MAIN_HOST'] = 'main-host';
    process.env['DB_MAIN_NAME'] = 'main-db';
    process.env['DB_TEST_HOST'] = 'test-host';
    process.env['DB_TEST_NAME'] = 'test-db';
    
    const connections = loadDatabaseConnections();
    
    expect(Object.keys(connections)).toEqual(['main', 'test']);
    expect(connections.main.host).toBe('main-host');
    expect(connections.main.database).toBe('main-db');
    expect(connections.test.host).toBe('test-host');
    expect(connections.test.database).toBe('test-db');
    
    delete process.env['DB_ALIASES'];
    delete process.env['DB_MAIN_HOST'];
    delete process.env['DB_MAIN_NAME'];
    delete process.env['DB_TEST_HOST'];
    delete process.env['DB_TEST_NAME'];
  });
}); 