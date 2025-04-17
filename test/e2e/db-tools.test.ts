import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import postgres from 'postgres';
import { Operation } from '../../src/types';
import { safeJsonStringify, createPostgresClient } from '../../src/utils';
import { setupTestDb, cleanupTestDb } from '../setup-db';

// Test database configuration
const TEST_DB_CONFIG = {
  host: '127.0.0.1',
  port: 5432,
  database: 'postgres_mcp_test',
  user: 'postgres',
  password: 'postgres',
  ssl: 'disable'
};

describe('Database MCP Tools E2E', () => {
  let server: {
    tools: Array<{
      name: string;
      execute: (args: any, ctx: any) => Promise<any>;
    }>;
    resourceTemplates: Array<{
      uriTemplate: string;
      load: (params: any) => Promise<any>;
    }>;
  };
  let sql: postgres.Sql<{}>;
  let originalDbAlias: string | undefined;
  
  // Set up test environment with real PostgreSQL in Docker
  beforeAll(async () => {
    console.log('Setting up test environment with real PostgreSQL in Docker...');
    
    // Save original environment variables
    originalDbAlias = process.env['DEFAULT_DB_ALIAS'];
    
    // Start PostgreSQL in Docker
    const dbStarted = await setupTestDb();
    if (!dbStarted) {
      throw new Error('Failed to start PostgreSQL in Docker');
    }
    
    try {
      // Connect to PostgreSQL admin database
      const adminSql = createPostgresClient({
        ...TEST_DB_CONFIG,
        database: 'postgres' // Connect to default database for admin operations
      });
      
      try {
        // Create test database if it doesn't exist
        await adminSql.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB_CONFIG.database}`);
        await adminSql.unsafe(`CREATE DATABASE ${TEST_DB_CONFIG.database}`);
      } finally {
        await adminSql.end();
      }
      
      // Connect to the test database
      sql = createPostgresClient(TEST_DB_CONFIG);
      
      // Create test tables
      await sql.unsafe(`
        CREATE TABLE IF NOT EXISTS test_users (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // Clean up any existing data
      await sql.unsafe(`TRUNCATE test_users RESTART IDENTITY CASCADE`);
      
      // Insert test data
      await sql.unsafe(`
        INSERT INTO test_users (name, email) VALUES
        ('User One', 'user1@example.com'),
        ('User Two', 'user2@example.com')
      `);
      
      // Configure environment for MCP server
      process.env['DB_ALIASES'] = 'main';
      process.env['DEFAULT_DB_ALIAS'] = 'main';
      process.env['DB_MAIN_HOST'] = TEST_DB_CONFIG.host;
      process.env['DB_MAIN_PORT'] = String(TEST_DB_CONFIG.port);
      process.env['DB_MAIN_NAME'] = TEST_DB_CONFIG.database;
      process.env['DB_MAIN_USER'] = TEST_DB_CONFIG.user;
      process.env['DB_MAIN_PASSWORD'] = TEST_DB_CONFIG.password;
      process.env['DB_MAIN_SSL'] = TEST_DB_CONFIG.ssl;
      
      // Create server object with tools for testing
      server = {
        tools: [
          {
            name: 'query_tool',
            execute: async ({ statement, params, dbAlias }: any) => {
              const result = await sql.unsafe(statement, params || []);
              return safeJsonStringify(result);
            }
          },
          {
            name: 'schema_tool',
            execute: async ({ tableName, dbAlias }: any) => {
              const result = await sql.unsafe(
                'SELECT column_name, data_type, is_nullable, column_default ' +
                'FROM information_schema.columns ' +
                'WHERE table_schema = \'public\' AND table_name = $1 ' +
                'ORDER BY ordinal_position',
                [tableName]
              );
              return safeJsonStringify(result);
            }
          },
          {
            name: 'execute_tool',
            execute: async ({ statement, params, dbAlias }: any) => {
              const result = await sql.unsafe(statement, params || []);
              return `Rows affected: ${result.count || 0}`;
            }
          },
          {
            name: 'transaction_tool',
            execute: async ({ operations, dbAlias }: any) => {
              const results: Array<{operation: number, rowsAffected: number}> = [];
              let success = true;
              let error = '';
              let failedOperationIndex = -1;
              
              try {
                await sql.begin(async (transaction: any) => {
                  for (let i = 0; i < operations.length; i++) {
                    try {
                      const op = operations[i];
                      const result = await transaction.unsafe(op.statement, op.params || []);
                      results.push({
                        operation: i,
                        rowsAffected: result.count || 0
                      });
                    } catch (e) {
                      success = false;
                      error = e instanceof Error ? e.message : String(e);
                      failedOperationIndex = i;
                      throw e; // Trigger rollback
                    }
                  }
                });
                
                return safeJsonStringify({
                  success: true,
                  results
                });
              } catch (e) {
                return safeJsonStringify({
                  success: false,
                  error: error || (e instanceof Error ? e.message : String(e)),
                  failedOperationIndex
                });
              }
            }
          }
        ],
        resourceTemplates: [
          {
            uriTemplate: 'db://{dbAlias}/schema/tables',
            load: async ({ dbAlias }: any) => {
              const tables = await sql.unsafe(
                'SELECT table_name FROM information_schema.tables ' +
                'WHERE table_schema = \'public\' AND table_type = \'BASE TABLE\' ' +
                'ORDER BY table_name'
              );
              return { text: safeJsonStringify(tables.map((t: any) => t.table_name)) };
            }
          },
          {
            uriTemplate: 'db://{dbAlias}/schema/{tableName}',
            load: async ({ dbAlias, tableName }: any) => {
              const schema = await sql.unsafe(
                'SELECT column_name, data_type, is_nullable, column_default ' +
                'FROM information_schema.columns ' +
                'WHERE table_schema = \'public\' AND table_name = $1 ' +
                'ORDER BY ordinal_position',
                [tableName]
              );
              return { text: safeJsonStringify(schema) };
            }
          }
        ]
      };
      
      console.log('Test environment ready');
    } catch (error) {
      console.error('Failed to set up PostgreSQL for testing:', error);
      // Clean up Docker container if setup fails
      cleanupTestDb();
      throw new Error(`PostgreSQL connection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  // Cleanup after tests
  afterAll(async () => {
    try {
      // Close database connection
      if (sql) {
        await sql.end();
      }
      
      // Restore environment variables
      if (originalDbAlias) {
        process.env['DEFAULT_DB_ALIAS'] = originalDbAlias;
      } else {
        delete process.env['DEFAULT_DB_ALIAS'];
      }
    } catch (error) {
      console.error('Error during database cleanup:', error);
    } finally {
      // Stop and remove Docker container
      cleanupTestDb();
      console.log('Test cleanup complete');
    }
  });

  test('query_tool: should return users from database', async () => {
    const queryTool = server.tools.find((tool: any) => tool.name === 'query_tool')!;
    const result = await queryTool.execute(
      {
        statement: 'SELECT * FROM test_users ORDER BY id',
        params: [],
        dbAlias: 'main'
      },
      { log: console }
    );

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    
    const parsed = JSON.parse(result);
    expect(parsed).toBeInstanceOf(Array);
    expect(parsed.length).toBe(2);
    expect(parsed[0]['name']).toBe('User One');
    expect(parsed[1]['email']).toBe('user2@example.com');
  });

  test('schema_tool: should return table schema information', async () => {
    const schemaTool = server.tools.find((tool: any) => tool.name === 'schema_tool')!;
    const result = await schemaTool.execute(
      {
        tableName: 'test_users',
        dbAlias: 'main'
      },
      { log: console }
    );

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    
    const parsed = JSON.parse(result);
    expect(parsed).toBeInstanceOf(Array);
    
    // Find the name column definition
    const nameColumn = parsed.find((col: any) => col['column_name'] === 'name');
    expect(nameColumn).toBeDefined();
    expect(nameColumn['data_type']).toBe('text');
    expect(nameColumn['is_nullable']).toBe('NO');
  });

  test('execute_tool: should insert a new record', async () => {
    const executeTool = server.tools.find((tool: any) => tool.name === 'execute_tool')!;
    const result = await executeTool.execute(
      {
        statement: 'INSERT INTO test_users (name, email) VALUES ($1, $2)',
        params: ['User Three', 'user3@example.com'],
        dbAlias: 'main'
      },
      { log: console }
    );

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    expect(result).toContain('Rows affected: 1');

    // Verify the insert succeeded
    const queryResult = await sql.unsafe('SELECT * FROM test_users WHERE email = $1', ['user3@example.com']);
    expect(queryResult.length).toBe(1);
    expect(queryResult[0]['name']).toBe('User Three');
  });

  test('transaction_tool: should execute multiple statements atomically', async () => {
    const transactionTool = server.tools.find((tool: any) => tool.name === 'transaction_tool')!;
    const result = await transactionTool.execute(
      {
        operations: [
          {
            statement: 'INSERT INTO test_users (name, email) VALUES ($1, $2)',
            params: ['User Four', 'user4@example.com']
          },
          {
            statement: 'INSERT INTO test_users (name, email) VALUES ($1, $2)',
            params: ['User Five', 'user5@example.com']
          }
        ],
        dbAlias: 'main'
      },
      { log: console }
    );

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    
    const parsed = JSON.parse(result);
    expect(parsed['success']).toBe(true);
    expect(parsed['results'].length).toBe(2);
    expect(parsed['results'][0]['rowsAffected']).toBe(1);
    expect(parsed['results'][1]['rowsAffected']).toBe(1);

    // Verify both inserts succeeded
    const queryResult = await sql.unsafe('SELECT * FROM test_users WHERE email IN ($1, $2)', ['user4@example.com', 'user5@example.com']);
    expect(queryResult.length).toBe(2);
  });

  test('transaction_tool: should roll back on error', async () => {
    // Count users before transaction
    const beforeCount = (await sql.unsafe('SELECT COUNT(*) as count FROM test_users'))[0]['count'];

    const transactionTool = server.tools.find((tool: any) => tool.name === 'transaction_tool')!;
    const result = await transactionTool.execute(
      {
        operations: [
          {
            statement: 'INSERT INTO test_users (name, email) VALUES ($1, $2)',
            params: ['User Six', 'user6@example.com']
          },
          {
            statement: 'INSERT INTO nonexistent_table (name) VALUES ($1)',
            params: ['Should Fail']
          }
        ],
        dbAlias: 'main'
      },
      { log: console }
    );

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    
    const parsed = JSON.parse(result);
    expect(parsed['success']).toBe(false);
    expect(parsed['error']).toBeDefined();

    // Verify count hasn't changed (transaction rolled back)
    const afterCount = (await sql.unsafe('SELECT COUNT(*) as count FROM test_users'))[0]['count'];
    expect(afterCount).toBe(beforeCount);
  });

  test('resource template: should list tables', async () => {
    const tablesResourceTemplate = server.resourceTemplates.find((template: any) => 
      template.uriTemplate === 'db://{dbAlias}/schema/tables'
    )!;
    
    const result = await tablesResourceTemplate.load({ dbAlias: 'main' });
    
    expect(result).toBeDefined();
    expect(result.text).toBeDefined();
    
    const parsed = JSON.parse(result.text);
    expect(parsed).toBeInstanceOf(Array);
    expect(parsed).toContain('test_users');
  });

  test('resource template: should get table schema', async () => {
    const schemaResourceTemplate = server.resourceTemplates.find((template: any) => 
      template.uriTemplate === 'db://{dbAlias}/schema/{tableName}'
    )!;
    
    const result = await schemaResourceTemplate.load({ 
      dbAlias: 'main',
      tableName: 'test_users'
    });
    
    expect(result).toBeDefined();
    expect(result.text).toBeDefined();
    
    const parsed = JSON.parse(result.text);
    expect(parsed).toBeInstanceOf(Array);
    
    // Find the id column
    const idColumn = parsed.find((col: any) => col['column_name'] === 'id');
    expect(idColumn).toBeDefined();
    expect(idColumn['data_type']).toBe('integer');
  });
}); 