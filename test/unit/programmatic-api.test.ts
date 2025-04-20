// Set environment to test mode
process.env['BUN_ENV'] = 'test';

import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { createPostgresMcp } from '../../src/core';
import postgres from 'postgres';
import { PostgresMcp } from '../../src/types';

// Generate a unique test table name with timestamp to avoid conflicts
const TEST_TABLE = `test_programmatic_api_${Date.now()}`;

// Test database configuration
const TEST_DB_CONFIG = {
  host: process.env['DB_MAIN_HOST'] || '127.0.0.1',
  port: Number(process.env['DB_MAIN_PORT'] || '5432'),
  database: process.env['DB_MAIN_NAME'] || 'postgres_mcp_test',
  user: process.env['DB_MAIN_USER'] || 'postgres',
  password: process.env['DB_MAIN_PASSWORD'] || 'postgres',
  ssl: process.env['DB_MAIN_SSL'] || 'disable'
};

// Helper to convert SSL string to postgres configuration
const getPostgresConfig = (config: typeof TEST_DB_CONFIG) => {
  const { ssl, ...restConfig } = config;
  
  // Convert SSL string to appropriate configuration
  const sslConfig = ssl === 'disable' ? {} :
                   ssl === 'require' ? { ssl: { rejectUnauthorized: false } } :
                   ssl === 'prefer' ? { ssl: { rejectUnauthorized: false } } :
                   ssl === 'verify-ca' || ssl === 'verify-full' ? { ssl: { rejectUnauthorized: true } } :
                   {};
  
  return {
    ...restConfig,
    ...sslConfig
  };
};

describe('Programmatic API', () => {
  let testSql: postgres.Sql<{}>;
  let postgresMcp: PostgresMcp;
  let isRemoteDb: boolean;
  
  // Set up test database before all tests
  beforeAll(async () => {
    console.log('Setting up test database for programmatic API tests...');
    
    try {
      // Check if we're using a remote database
      isRemoteDb = !!process.env['DB_MAIN_HOST'] && 
                  process.env['DB_MAIN_HOST'] !== 'localhost' && 
                  process.env['DB_MAIN_HOST'] !== '127.0.0.1';
      
      console.log(isRemoteDb ? 'Using remote database' : 'Using local database');
      
      // Log the database configuration being used
      console.log('Test database configuration:', {
        host: TEST_DB_CONFIG.host,
        port: TEST_DB_CONFIG.port,
        database: TEST_DB_CONFIG.database,
        user: TEST_DB_CONFIG.user,
        ssl: TEST_DB_CONFIG.ssl
      });
      
      // Connect directly to the test database
      testSql = postgres(getPostgresConfig(TEST_DB_CONFIG));
      
      // Create test table with unique name
      await testSql.unsafe(`
        CREATE TABLE IF NOT EXISTS ${TEST_TABLE} (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // Clean up any existing data
      await testSql.unsafe(`TRUNCATE ${TEST_TABLE} RESTART IDENTITY CASCADE`);
      
      // Insert test data
      await testSql.unsafe(`
        INSERT INTO ${TEST_TABLE} (name, email) VALUES
        ('User One', 'user1@example.com'),
        ('User Two', 'user2@example.com')
      `);
      
      // Create and initialize PostgresMcp instance
      postgresMcp = createPostgresMcp({
        databaseConfigs: {
          main: TEST_DB_CONFIG,
          test: TEST_DB_CONFIG
        },
        autoStart: false
      });
      
      console.log('Test database setup complete.');
    } catch (error) {
      console.error('Failed to set up test database:', error);
      throw error;
    }
  });

  // Clean up after all tests
  afterAll(async () => {
    console.log('Cleaning up test database...');
    
    try {
      if (testSql) {
        await testSql.unsafe(`DROP TABLE IF EXISTS ${TEST_TABLE}`);
        await testSql.end();
      }
      
      if (postgresMcp) {
        await postgresMcp.stop();
      }
    } catch (error) {
      console.error('Error during test cleanup:', error);
    }
    
    console.log('Test database cleanup complete.');
  });
  
  // Test the programmatic API
  test('createPostgresMcp creates a valid instance', () => {
    expect(postgresMcp).toBeDefined();
    expect(typeof postgresMcp.start).toBe('function');
    expect(typeof postgresMcp.stop).toBe('function');
    expect(typeof postgresMcp.disconnect).toBe('function');
    expect(typeof postgresMcp.executeQuery).toBe('function');
    expect(typeof postgresMcp.executeCommand).toBe('function');
    expect(typeof postgresMcp.executeTransaction).toBe('function');
    expect(typeof postgresMcp.getTableSchema).toBe('function');
    expect(typeof postgresMcp.listTables).toBe('function');
  });
  
  test('executeQuery calls database with correct parameters', async () => {
    // Execute a query with default dbAlias
    const result1 = await postgresMcp.executeQuery(`SELECT * FROM ${TEST_TABLE} WHERE id = $1`, [1]);
    
    // Verify the result
    expect(result1).toBeDefined();
    const parsed1 = JSON.parse(result1);
    expect(parsed1).toBeInstanceOf(Array);
    expect(parsed1.length).toBe(1);
    expect(parsed1[0].id).toBe(1);
    expect(parsed1[0].name).toBe('User One');
    expect(parsed1[0].email).toBe('user1@example.com');
    
    // Execute with explicit dbAlias
    const result2 = await postgresMcp.executeQuery(`SELECT * FROM ${TEST_TABLE} WHERE id = $1`, [2], 'test');
    
    // Verify the result
    expect(result2).toBeDefined();
    const parsed2 = JSON.parse(result2);
    expect(parsed2).toBeInstanceOf(Array);
    expect(parsed2.length).toBe(1);
    expect(parsed2[0].id).toBe(2);
    expect(parsed2[0].name).toBe('User Two');
    expect(parsed2[0].email).toBe('user2@example.com');
  });
  
  test('executeCommand calls database with correct parameters', async () => {
    // Execute a command with default dbAlias
    const result1 = await postgresMcp.executeCommand(
      `INSERT INTO ${TEST_TABLE} (name, email) VALUES ($1, $2)`,
      ['User Three', 'user3@example.com']
    );
    
    // Verify the result
    expect(result1).toBe('Rows affected: 1');
    
    // Verify insertion with a query
    const queryResult = await testSql.unsafe(`SELECT * FROM ${TEST_TABLE} WHERE email = $1`, ['user3@example.com']);
    expect(queryResult.length).toBe(1);
    expect(queryResult[0].name).toBe('User Three');
    
    // Execute a command with explicit dbAlias
    const result2 = await postgresMcp.executeCommand(
      `UPDATE ${TEST_TABLE} SET name = $1 WHERE email = $2`,
      ['Updated User', 'user1@example.com'],
      'test'
    );
    
    // Verify the result
    expect(result2).toBe('Rows affected: 1');
    
    // Verify update with a query
    const queryResult2 = await testSql.unsafe(`SELECT * FROM ${TEST_TABLE} WHERE email = $1`, ['user1@example.com']);
    expect(queryResult2.length).toBe(1);
    expect(queryResult2[0].name).toBe('Updated User');
  });
  
  test('executeTransaction calls database with correct parameters', async () => {
    // Execute a transaction with default dbAlias
    const result1 = await postgresMcp.executeTransaction([
      {
        statement: `INSERT INTO ${TEST_TABLE} (name, email) VALUES ($1, $2)`,
        params: ['User Four', 'user4@example.com']
      },
      {
        statement: `INSERT INTO ${TEST_TABLE} (name, email) VALUES ($1, $2)`,
        params: ['User Five', 'user5@example.com']
      }
    ]);
    
    // Verify the result
    expect(result1).toBeDefined();
    const parsed1 = JSON.parse(result1);
    expect(parsed1.success).toBe(true);
    expect(Array.isArray(parsed1.results)).toBe(true);
    expect(parsed1.results.length).toBe(2);
    
    // Verify exact structure of the results array
    expect(parsed1.results[0].operation).toBe(0);
    expect(parsed1.results[0].rowsAffected).toBe(1);
    expect(parsed1.results[1].operation).toBe(1);
    expect(parsed1.results[1].rowsAffected).toBe(1);
    
    // Verify insertions with a query
    const queryResult = await testSql.unsafe(`SELECT * FROM ${TEST_TABLE} WHERE email IN ($1, $2)`, 
      ['user4@example.com', 'user5@example.com']);
    expect(queryResult.length).toBe(2);
    
    // Execute a transaction with explicit dbAlias
    const result2 = await postgresMcp.executeTransaction([
      {
        statement: `UPDATE ${TEST_TABLE} SET name = $1 WHERE email = $2`,
        params: ['User Four Updated', 'user4@example.com']
      }
    ], 'test');
    
    // Verify the result
    expect(result2).toBeDefined();
    const parsed2 = JSON.parse(result2);
    expect(parsed2.success).toBe(true);
    expect(Array.isArray(parsed2.results)).toBe(true);
    expect(parsed2.results.length).toBe(1);
    
    // Verify update with a query
    const queryResult2 = await testSql.unsafe(`SELECT * FROM ${TEST_TABLE} WHERE email = $1`, ['user4@example.com']);
    expect(queryResult2.length).toBe(1);
    expect(queryResult2[0].name).toBe('User Four Updated');
  });
  
  test('getTableSchema calls database with correct parameters', async () => {
    // First get the schema for our test table
    const result = await testSql.unsafe(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `, [TEST_TABLE]);
    
    // Get schema with default dbAlias
    const schema1 = await postgresMcp.getTableSchema(TEST_TABLE);
    
    // Verify schema
    expect(schema1).toBeDefined();
    expect(Array.isArray(schema1)).toBe(true);
    expect(schema1.length).toBe(4); // id, name, email, created_at
    
    // Organize columns by name for easier verification
    const columns: Record<string, any> = {};
    schema1.forEach((col: any) => {
      columns[col.column_name] = col;
    });
    
    // Verify id column
    expect(columns.id).toBeDefined();
    expect(columns.id.data_type).toBe('integer');
    expect(columns.id.is_nullable).toBe('NO');
    
    // Verify name column
    expect(columns.name).toBeDefined();
    expect(columns.name.data_type).toBe('text');
    expect(columns.name.is_nullable).toBe('NO');
    
    // Get schema with explicit dbAlias
    const schema2 = await postgresMcp.getTableSchema(TEST_TABLE, 'test');
    
    // Verify schema is the same
    expect(schema2).toBeDefined();
    expect(Array.isArray(schema2)).toBe(true);
    expect(schema2.length).toBe(4);
  });
  
  test('listTables calls database with correct parameters', async () => {
    // List tables with default dbAlias
    const tables1 = await postgresMcp.listTables();
    
    // Verify tables
    expect(tables1).toBeDefined();
    expect(Array.isArray(tables1)).toBe(true);
    expect(tables1.includes(TEST_TABLE)).toBe(true);
    
    // List tables with explicit dbAlias
    const tables2 = await postgresMcp.listTables('test');
    
    // Verify tables
    expect(tables2).toBeDefined();
    expect(Array.isArray(tables2)).toBe(true);
    expect(tables2.includes(TEST_TABLE)).toBe(true);
  });
  
  test('executeQuery with invalid parameters should throw error', async () => {
    // Fix the async error expectation pattern
    let error: Error | null = null;
    try {
      // Use a statement with a syntax error rather than an empty string
      await postgresMcp.executeQuery('SELECT * FROM nonexistent_table WHERE invalid syntax here');
    } catch (e) {
      error = e as Error;
    }
    
    expect(error).not.toBeNull();
    expect(error?.message).toBeDefined();
  });
  
  test('executeQuery with non-existing dbAlias should throw error', async () => {
    // Fix the async error expectation pattern
    let error: Error | null = null;
    try {
      await postgresMcp.executeQuery('SELECT 1', [], 'non_existent');
    } catch (e) {
      error = e as Error;
    }
    
    expect(error).not.toBeNull();
    expect(error?.message).toContain("Database connection 'non_existent' not found");
  });
  
  test('disconnect closes database connections without stopping the server', async () => {
    // Make sure connections are active
    const connectionsBefore = Object.keys(postgresMcp.connections);
    expect(connectionsBefore.length).toBeGreaterThan(0);
    
    // Call disconnect
    await postgresMcp.disconnect();
    
    // Try to re-establish connections for other tests
    const { initConnections } = await import('../../src/core');
    initConnections({
      main: TEST_DB_CONFIG,
      test: TEST_DB_CONFIG
    });
  });
}); 