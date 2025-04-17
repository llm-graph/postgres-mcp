import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import postgres from 'postgres';
import { safeJsonStringify, createPostgresClient } from '../../src/utils';
import { setupTestDb, cleanupTestDb } from '../test-utils';

// Test database configuration
const TEST_DB_CONFIG = {
  host: '127.0.0.1',
  port: 5432,
  database: 'postgres_mcp_test',
  user: 'postgres',
  password: 'postgres',
  ssl: 'disable'
};

// Add a retry function for database operations
const retryDatabaseOperation = async <T>(
  operation: () => Promise<T>,
  retries = 3,
  delay = 2000
): Promise<T> => {
  let lastError: unknown;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        console.log(`Database operation failed, retrying (${attempt}/${retries})...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
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
  let useDockerDb = true;
  let actualDbConfig: any;
  
  // Set up test environment with real PostgreSQL in Docker or use existing database
  beforeAll(async () => {
    // Save original environment variables
    originalDbAlias = process.env['DEFAULT_DB_ALIAS'];
    
    // Check if we should use an existing remote database
    const existingDbHost = process.env['DB_MAIN_HOST'];
    useDockerDb = !existingDbHost || existingDbHost === 'localhost' || existingDbHost === '127.0.0.1';
    
    if (useDockerDb) {
      console.log('┌─────────────────────────────────────────────────┐');
      console.log('│ Setting up PostgreSQL in Docker for testing...  │');
      console.log('└─────────────────────────────────────────────────┘');
      
      // Start PostgreSQL in Docker
      const dbStarted = await setupTestDb();
      if (!dbStarted) {
        throw new Error('Failed to start PostgreSQL in Docker');
      }
      
      actualDbConfig = { ...TEST_DB_CONFIG };
    } else {
      console.log('┌─────────────────────────────────────────────────┐');
      console.log('│ Using existing remote database for testing      │');
      console.log('└─────────────────────────────────────────────────┘');
      
      // Use the environment database configuration
      actualDbConfig = {
        host: process.env['DB_MAIN_HOST'],
        port: Number(process.env['DB_MAIN_PORT'] || '5432'),
        database: process.env['DB_MAIN_NAME'],
        user: process.env['DB_MAIN_USER'],
        password: process.env['DB_MAIN_PASSWORD'],
        ssl: process.env['DB_MAIN_SSL'] || 'disable'
      };
    }
    
    try {
      console.log('Configuring test database...');
      
      if (useDockerDb) {
        // Connect to PostgreSQL admin database with retries for Docker setup
        const adminSql = await retryDatabaseOperation(async () => {
          return createPostgresClient({
            ...actualDbConfig,
            database: 'postgres' // Connect to default database for admin operations
          });
        });
        
        try {
          // Create test database if it doesn't exist
          await adminSql.unsafe(`DROP DATABASE IF EXISTS ${actualDbConfig.database}`);
          await adminSql.unsafe(`CREATE DATABASE ${actualDbConfig.database}`);
        } finally {
          await adminSql.end();
        }
      }
      
      // Connect to the test database with retries
      sql = await retryDatabaseOperation(async () => {
        return createPostgresClient(actualDbConfig);
      });
      
      console.log('Creating test tables and data...');
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
      
      if (useDockerDb) {
        console.log('Configuring environment...');
        // Configure environment for MCP server when using Docker
        process.env['DB_ALIASES'] = 'main';
        process.env['DEFAULT_DB_ALIAS'] = 'main';
        process.env['DB_MAIN_HOST'] = actualDbConfig.host;
        process.env['DB_MAIN_PORT'] = String(actualDbConfig.port);
        process.env['DB_MAIN_NAME'] = actualDbConfig.database;
        process.env['DB_MAIN_USER'] = actualDbConfig.user;
        process.env['DB_MAIN_PASSWORD'] = actualDbConfig.password;
        process.env['DB_MAIN_SSL'] = actualDbConfig.ssl;
      }
      
      console.log('Setting up test server...');
      // Create server object with tools for testing
      server = {
        tools: [
          {
            name: 'query_tool',
            execute: async ({ statement, params }: any) => {
              const result = await sql.unsafe(statement, params || []);
              return safeJsonStringify(result);
            }
          },
          {
            name: 'schema_tool',
            execute: async ({ tableName }: any) => {
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
            execute: async ({ statement, params }: any) => {
              const result = await sql.unsafe(statement, params || []);
              return `Rows affected: ${result.count || 0}`;
            }
          },
          {
            name: 'transaction_tool',
            execute: async ({ operations }: any) => {
              const results: Array<{operation: number, rowsAffected: number}> = [];
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
            load: async ({}: any) => {
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
            load: async ({ tableName }: any) => {
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
      
      console.log('┌─────────────────────────────────────────────────┐');
      console.log('│ Test environment ready                          │');
      console.log('└─────────────────────────────────────────────────┘');
    } catch (error) {
      console.error('Failed to set up PostgreSQL for testing:', error);
      // Clean up Docker container if setup fails
      cleanupTestDb();
      throw new Error(`PostgreSQL connection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  // Cleanup after tests - run in a non-blocking way to ensure we get test summary
  afterAll(async () => {
    console.log('┌─────────────────────────────────────────────────┐');
    console.log('│ Running test cleanup                            │');
    console.log('└─────────────────────────────────────────────────┘');
    
    // Using a try/finally to ensure cleanup happens regardless of errors
    try {
      // Close database connection
      if (sql) {
        console.log('Closing database connection...');
        await sql.end();
      }
      
      if (useDockerDb) {
        // Restore environment variables if we changed them
        if (originalDbAlias) {
          process.env['DEFAULT_DB_ALIAS'] = originalDbAlias;
        } else {
          delete process.env['DEFAULT_DB_ALIAS'];
        }
        
        // Clean up other environment variables
        delete process.env['DB_ALIASES'];
        delete process.env['DB_MAIN_HOST'];
        delete process.env['DB_MAIN_PORT'];
        delete process.env['DB_MAIN_NAME'];
        delete process.env['DB_MAIN_USER'];
        delete process.env['DB_MAIN_PASSWORD'];
        delete process.env['DB_MAIN_SSL'];
        
        // Use Promise.race to ensure we don't hang indefinitely
        console.log('Cleaning up Docker container...');
        const cleanup = cleanupTestDb();
        
        // Run cleanup but ensure it doesn't block test completion
        // This ensures test summary is still visible even if cleanup hangs
        await Promise.race([
          Promise.resolve(cleanup),
          new Promise(resolve => setTimeout(resolve, 5000))
        ]);
      }
      
      console.log('┌─────────────────────────────────────────────────┐');
      console.log('│ Test cleanup complete                           │');
      console.log('└─────────────────────────────────────────────────┘');
    } catch (error) {
      console.error('Error during cleanup:', error);
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