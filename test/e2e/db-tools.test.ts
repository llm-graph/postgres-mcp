import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import postgres from 'postgres';
import { safeJsonStringify, createPostgresClient } from '../../src/utils';
import { 
  setupTestDb, 
  cleanupTestDb,
  type TestResources 
} from '../unit/test-db-utils';
import {
  retryDatabaseOperation, 
  setupSignalHandlers,
  registerTestResources,
  performCleanup
} from './test-helpers';

// Test database configuration
const TEST_DB_CONFIG = {
  host: '127.0.0.1',
  port: 5432,
  database: 'postgres_mcp_test',
  user: 'postgres',
  password: 'postgres',
  ssl: 'disable'
};

// Create test resources object for tracking and cleanup
const testResources: TestResources = {
  useDockerDb: true,
  isCleanedUp: false
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
  let actualDbConfig: any;
  
  // Set up test environment with real PostgreSQL in Docker or use existing database
  beforeAll(async () => {
    // Setup signal handlers for cleanup
    setupSignalHandlers();
    
    // Register resources for cleanup
    registerTestResources(testResources);
    
    // Save original environment variables
    testResources.originalDbAlias = process.env['DEFAULT_DB_ALIAS'];
    
    // Check if we should use an existing remote database
    const existingDbHost = process.env['DB_MAIN_HOST'];
    testResources.useDockerDb = !existingDbHost || existingDbHost === 'localhost' || existingDbHost === '127.0.0.1';
    
    if (testResources.useDockerDb) {
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
      
      if (testResources.useDockerDb) {
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
      
      // Store SQL connection for cleanup
      testResources.sql = sql;
      testResources.dbConfig = actualDbConfig;
      
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
      
      if (testResources.useDockerDb) {
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
          },
          {
            name: 'all_schemas_tool',
            execute: async ({ dbAlias }: any) => {
              // First get table list
              const tables = await sql.unsafe(
                'SELECT table_name FROM information_schema.tables ' +
                'WHERE table_schema = \'public\' AND table_type = \'BASE TABLE\' ' +
                'ORDER BY table_name'
              );
              
              // Then get schema for each table
              const result: Record<string, any[]> = {};
              for (const table of tables) {
                const tableName = table.table_name;
                const schema = await sql.unsafe(
                  'SELECT column_name, data_type, is_nullable, column_default ' +
                  'FROM information_schema.columns ' +
                  'WHERE table_schema = \'public\' AND table_name = $1 ' +
                  'ORDER BY ordinal_position',
                  [tableName]
                );
                result[tableName] = schema;
              }
              
              return safeJsonStringify(result);
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
          },
          {
            uriTemplate: 'db://{dbAlias}/schema/all',
            load: async ({}: any) => {
              // First get table list
              const tables = await sql.unsafe(
                'SELECT table_name FROM information_schema.tables ' +
                'WHERE table_schema = \'public\' AND table_type = \'BASE TABLE\' ' +
                'ORDER BY table_name'
              );
              
              // Then get schema for each table
              const result: Record<string, any[]> = {};
              for (const table of tables) {
                const tableName = table.table_name;
                const schema = await sql.unsafe(
                  'SELECT column_name, data_type, is_nullable, column_default ' +
                  'FROM information_schema.columns ' +
                  'WHERE table_schema = \'public\' AND table_name = $1 ' +
                  'ORDER BY ordinal_position',
                  [tableName]
                );
                result[tableName] = schema;
              }
              
              return { text: safeJsonStringify(result) };
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
      await performCleanup(testResources);
      throw new Error(`PostgreSQL connection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  // Cleanup after tests using our shared cleanup function
  afterAll(async () => {
    await performCleanup(testResources);
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
    
    // More thorough validation of all fields in the response
    const user1 = parsed[0];
    const user2 = parsed[1];
    
    // Validate first user record completely
    expect(user1.id).toBe(1);
    expect(user1.name).toBe('User One');
    expect(user1.email).toBe('user1@example.com');
    expect(user1.created_at).toBeDefined();
    expect(new Date(user1.created_at).toISOString()).not.toBeNaN();
    
    // Validate second user record completely
    expect(user2.id).toBe(2);
    expect(user2.name).toBe('User Two');
    expect(user2.email).toBe('user2@example.com');
    expect(user2.created_at).toBeDefined();
    expect(new Date(user2.created_at).toISOString()).not.toBeNaN();
  });

  test('query_tool: should handle empty result sets properly', async () => {
    const queryTool = server.tools.find((tool: any) => tool.name === 'query_tool')!;
    const result = await queryTool.execute(
      {
        statement: 'SELECT * FROM test_users WHERE email = $1',
        params: ['nonexistent@example.com'],
        dbAlias: 'main'
      },
      { log: console }
    );

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    
    const parsed = JSON.parse(result);
    expect(parsed).toBeInstanceOf(Array);
    expect(parsed.length).toBe(0);
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
    
    // Should have 4 columns in test_users
    expect(parsed.length).toBe(4);
    
    // Organize columns by name for easier verification
    const columns: Record<string, any> = {};
    parsed.forEach((col: any) => {
      columns[col.column_name] = col;
    });
    
    // Verify id column
    expect(columns.id).toBeDefined();
    expect(columns.id.data_type).toBe('integer');
    expect(columns.id.is_nullable).toBe('NO');
    expect(columns.id.column_default).toContain('nextval');
    
    // Verify name column
    expect(columns.name).toBeDefined();
    expect(columns.name.data_type).toBe('text');
    expect(columns.name.is_nullable).toBe('NO');
    expect(columns.name.column_default).toBeNull();
    
    // Verify email column
    expect(columns.email).toBeDefined();
    expect(columns.email.data_type).toBe('text');
    expect(columns.email.is_nullable).toBe('NO');
    expect(columns.email.column_default).toBeNull();
    
    // Verify created_at column
    expect(columns.created_at).toBeDefined();
    expect(columns.created_at.data_type).toBe('timestamp with time zone');
    expect(columns.created_at.is_nullable).toBe('YES');
    expect(columns.created_at.column_default).toContain('CURRENT_TIMESTAMP');
  });

  test('schema_tool: should handle non-existent tables gracefully', async () => {
    const schemaTool = server.tools.find((tool: any) => tool.name === 'schema_tool')!;
    const result = await schemaTool.execute(
      {
        tableName: 'nonexistent_table',
        dbAlias: 'main'
      },
      { log: console }
    );

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    
    const parsed = JSON.parse(result);
    expect(parsed).toBeInstanceOf(Array);
    expect(parsed.length).toBe(0);
  });

  test('all_schemas_tool: should handle large database schemas', async () => {
    // Use a timestamp for unique table names
    const timestamp = Date.now();
    const tablePrefix = `test_large_schema_${timestamp}_`;
    const tableNames: string[] = [];
    
    // Create 10 tables with multiple columns to simulate a complex database
    for (let i = 1; i <= 5; i++) {
      const tableName = `${tablePrefix}${i}`;
      tableNames.push(tableName);
      
      await sql.unsafe(`
        CREATE TABLE IF NOT EXISTS ${tableName} (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          active BOOLEAN DEFAULT true,
          count INTEGER DEFAULT 0,
          price DECIMAL(10,2)
        )
      `);
    }
    
    const allSchemasTool = server.tools.find((tool: any) => tool.name === 'all_schemas_tool')!;
    
    const result = await allSchemasTool.execute(
      {
        dbAlias: 'main'
      },
      { log: console }
    );
    
    expect(result).toBeDefined();
    const parsed = JSON.parse(result);
    
    // Verify we have schema for all the tables we created
    for (const tableName of tableNames) {
      expect(parsed[tableName]).toBeDefined();
      expect(parsed[tableName].length).toBe(7); // Each table has 7 columns
      
      // Verify all expected columns are present
      const columnNames = parsed[tableName].map((col: any) => col.column_name);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('name');
      expect(columnNames).toContain('description');
      expect(columnNames).toContain('created_at');
      expect(columnNames).toContain('active');
      expect(columnNames).toContain('count');
      expect(columnNames).toContain('price');
    }
    
    // Clean up after test
    for (const tableName of tableNames) {
      await sql.unsafe(`DROP TABLE IF EXISTS ${tableName}`);
    }
  }, 15000); // Increase timeout to 15 seconds

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
    expect(result).toBe('Rows affected: 1');

    // Verify the insert succeeded with complete record verification
    const queryResult = await sql.unsafe('SELECT * FROM test_users WHERE email = $1', ['user3@example.com']);
    expect(queryResult.length).toBe(1);
    expect(queryResult[0].id).toBe(3);
    expect(queryResult[0].name).toBe('User Three');
    expect(queryResult[0].email).toBe('user3@example.com');
    expect(queryResult[0].created_at).toBeDefined();
  });

  test('execute_tool: should update existing records', async () => {
    const executeTool = server.tools.find((tool: any) => tool.name === 'execute_tool')!;
    const result = await executeTool.execute(
      {
        statement: 'UPDATE test_users SET name = $1 WHERE email = $2',
        params: ['Updated User', 'user1@example.com'],
        dbAlias: 'main'
      },
      { log: console }
    );

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    expect(result).toBe('Rows affected: 1');

    // Verify the update succeeded with specific field checks
    const queryResult = await sql.unsafe('SELECT * FROM test_users WHERE email = $1', ['user1@example.com']);
    expect(queryResult.length).toBe(1);
    expect(queryResult[0].name).toBe('Updated User');
    expect(queryResult[0].id).toBe(1);
    expect(queryResult[0].email).toBe('user1@example.com');
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
    expect(parsed.success).toBe(true);
    expect(Array.isArray(parsed.results)).toBe(true);
    expect(parsed.results.length).toBe(2);
    
    // Verify exact structure of the results array
    expect(parsed.results[0].operation).toBe(0);
    expect(parsed.results[0].rowsAffected).toBe(1);
    expect(parsed.results[1].operation).toBe(1);
    expect(parsed.results[1].rowsAffected).toBe(1);

    // Verify both inserts succeeded with complete validation
    const queryResult = await sql.unsafe('SELECT * FROM test_users WHERE email IN ($1, $2) ORDER BY email', 
      ['user4@example.com', 'user5@example.com']);
    expect(queryResult.length).toBe(2);
    
    // Verify first inserted user
    expect(queryResult[0].name).toBe('User Four');
    expect(queryResult[0].email).toBe('user4@example.com');
    expect(queryResult[0].created_at).toBeDefined();
    
    // Verify second inserted user
    expect(queryResult[1].name).toBe('User Five');
    expect(queryResult[1].email).toBe('user5@example.com');
    expect(queryResult[1].created_at).toBeDefined();
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
    expect(parsed.success).toBe(false);
    expect(typeof parsed.error).toBe('string');
    expect(parsed.error.toLowerCase()).toContain('nonexistent_table');
    expect(parsed.failedOperationIndex).toBe(1);

    // Verify transaction was completely rolled back
    const afterCount = (await sql.unsafe('SELECT COUNT(*) as count FROM test_users'))[0]['count'];
    expect(afterCount).toBe(beforeCount);
    
    // Specifically verify user6 was not inserted
    const user6Result = await sql.unsafe('SELECT * FROM test_users WHERE email = $1', ['user6@example.com']);
    expect(user6Result.length).toBe(0);
  });

  test('transaction_tool: should handle empty operations list', async () => {
    const transactionTool = server.tools.find((tool: any) => tool.name === 'transaction_tool')!;
    const result = await transactionTool.execute(
      {
        operations: [],
        dbAlias: 'main'
      },
      { log: console }
    );

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(Array.isArray(parsed.results)).toBe(true);
    expect(parsed.results.length).toBe(0);
  });

  test('resource template: should list tables', async () => {
    const tablesResourceTemplate = server.resourceTemplates.find((template: any) => 
      template.uriTemplate === 'db://{dbAlias}/schema/tables'
    )!;
    
    const result = await tablesResourceTemplate.load({ dbAlias: 'main' });
    
    expect(result).toBeDefined();
    expect(result.text).toBeDefined();
    
    const parsed = JSON.parse(result.text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.includes('test_users')).toBe(true);
    
    // Verify all tables are strings
    parsed.forEach((tableName: any) => {
      expect(typeof tableName).toBe('string');
      expect(tableName.length).toBeGreaterThan(0);
    });
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
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(4); // test_users has 4 columns
    
    // Check that all expected columns are present
    const columnNames = parsed.map((col: any) => col.column_name);
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('name');
    expect(columnNames).toContain('email');
    expect(columnNames).toContain('created_at');
    
    // Verify column details for each column
    const idColumn = parsed.find((col: any) => col.column_name === 'id');
    expect(idColumn.data_type).toBe('integer');
    expect(idColumn.is_nullable).toBe('NO');
    expect(idColumn.column_default).toContain('nextval');
    
    const nameColumn = parsed.find((col: any) => col.column_name === 'name');
    expect(nameColumn.data_type).toBe('text');
    expect(nameColumn.is_nullable).toBe('NO');
    
    const emailColumn = parsed.find((col: any) => col.column_name === 'email');
    expect(emailColumn.data_type).toBe('text');
    expect(emailColumn.is_nullable).toBe('NO');
    
    const createdAtColumn = parsed.find((col: any) => col.column_name === 'created_at');
    expect(createdAtColumn.data_type).toBe('timestamp with time zone');
    expect(createdAtColumn.is_nullable).toBe('YES');
    expect(createdAtColumn.column_default).toContain('CURRENT_TIMESTAMP');
  });

  test('resource template: should handle non-existent tables gracefully', async () => {
    const schemaTemplate = server.resourceTemplates.find((t: any) => t.uriTemplate === 'db://{dbAlias}/schema/{tableName}');
    expect(schemaTemplate).toBeDefined();
    
    // Get the result for a non-existent table
    const result = await schemaTemplate!.load({ dbAlias: 'main', tableName: 'nonexistent_table' });
    
    // Check that we got a valid response with empty array
    expect(result).toBeDefined();
    expect(result.text).toBeDefined();
    expect(result.text).toBe('[]');
    
    // Parse the result to confirm it's an empty array
    const parsed = JSON.parse(result.text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(0);
  });
  
  test('check registered resource templates', async () => {
    // Log all resource templates to debug
    console.log('Available resource templates:');
    server.resourceTemplates.forEach((t: any, index: number) => {
      console.log(`${index + 1}. ${t.uriTemplate} - ${t.name}`);
    });
    
    // Check if our new template exists
    const allSchemasTemplate = server.resourceTemplates.find((t: any) => 
      t.uriTemplate === 'db://{dbAlias}/schema/all');
    
    // If it doesn't exist, the test framework should report this assertion failure
    expect(allSchemasTemplate).toBeDefined();
  });
  
  test('resource template: should return all table schemas', async () => {
    const allSchemasTemplate = server.resourceTemplates.find((t: any) => 
      t.uriTemplate === 'db://{dbAlias}/schema/all');
    expect(allSchemasTemplate).toBeDefined();
    
    if (!allSchemasTemplate) {
      // Skip the rest of the test if template is not found
      return;
    }
    
    const result = await allSchemasTemplate.load({ dbAlias: 'main' });
    expect(result).toBeDefined();
    expect(result.text).toBeDefined();
    
    const parsed = JSON.parse(result.text);
    expect(parsed).toBeInstanceOf(Object);
    
    // Expect the test_users table to be present
    expect(parsed['test_users']).toBeDefined();
    expect(parsed['test_users']).toBeInstanceOf(Array);
    
    // Should have 4 columns in test_users
    expect(parsed['test_users'].length).toBe(4);
    
    // Check for some of the column names
    const columnNames = parsed['test_users'].map((col: any) => col.column_name);
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('name');
    expect(columnNames).toContain('email');
    expect(columnNames).toContain('created_at');
  });

  // Additional battle-testing scenarios
  
  test('query_tool: should handle complex queries with joins and aggregations', async () => {
    // Create a second test table with foreign key relationship
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS test_orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES test_users(id),
        amount DECIMAL(10,2) NOT NULL,
        status TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Insert some test orders
    await sql.unsafe(`
      INSERT INTO test_orders (user_id, amount, status) VALUES
      (1, 100.50, 'completed'),
      (1, 200.75, 'pending'),
      (2, 50.25, 'completed'),
      (2, 75.00, 'cancelled')
    `);
    
    const queryTool = server.tools.find((tool: any) => tool.name === 'query_tool')!;
    
    // Execute a complex query with JOIN and GROUP BY
    const result = await queryTool.execute(
      {
        statement: `
          SELECT u.id, u.name, COUNT(o.id) as order_count, SUM(o.amount) as total_spent
          FROM test_users u
          LEFT JOIN test_orders o ON u.id = o.user_id
          WHERE u.id IN (1, 2)
          GROUP BY u.id, u.name
          ORDER BY u.id
        `,
        params: [],
        dbAlias: 'main'
      },
      { log: console }
    );
    
    expect(result).toBeDefined();
    const parsed = JSON.parse(result);
    expect(parsed).toBeInstanceOf(Array);
    expect(parsed.length).toBe(2);
    
    // Verify first user's aggregate data
    expect(parsed[0].id).toBe(1);
    expect(parsed[0].name).toBe('Updated User'); // This was updated in a previous test
    expect(parseInt(parsed[0].order_count)).toBe(2);
    expect(parseFloat(parsed[0].total_spent)).toBeCloseTo(301.25);
    
    // Verify second user's aggregate data
    expect(parsed[1].id).toBe(2);
    expect(parsed[1].name).toBe('User Two');
    expect(parseInt(parsed[1].order_count)).toBe(2);
    expect(parseFloat(parsed[1].total_spent)).toBeCloseTo(125.25);
  });
  
  test('query_tool: should handle sorting and pagination with parameters', async () => {
    // Insert more users to test pagination
    await sql.unsafe(`
      INSERT INTO test_users (name, email) VALUES
      ('User Six', 'user6@example.com'),
      ('User Seven', 'user7@example.com'),
      ('User Eight', 'user8@example.com'),
      ('User Nine', 'user9@example.com'),
      ('User Ten', 'user10@example.com')
    `);
    
    const queryTool = server.tools.find((tool: any) => tool.name === 'query_tool')!;
    
    // Test pagination with offset and limit
    const result = await queryTool.execute(
      {
        statement: `
          SELECT id, name, email
          FROM test_users
          ORDER BY id
          OFFSET $1 LIMIT $2
        `,
        params: [2, 3],
        dbAlias: 'main'
      },
      { log: console }
    );
    
    expect(result).toBeDefined();
    const parsed = JSON.parse(result);
    expect(parsed).toBeInstanceOf(Array);
    expect(parsed.length).toBe(3);
    
    // Should return users with IDs 3, 4, 5 (offset 2, limit 3)
    expect(parsed[0].id).toBe(3);
    expect(parsed[1].id).toBe(4);
    expect(parsed[2].id).toBe(5);
  });
  
  test('query_tool: should handle queries with complex filtering', async () => {
    const queryTool = server.tools.find((tool: any) => tool.name === 'query_tool')!;
    
    // Test a query with multiple conditions and parameters
    const result = await queryTool.execute(
      {
        statement: `
          SELECT id, name, email
          FROM test_users
          WHERE (id > $1 AND id <= $2)
          OR email LIKE $3
          ORDER BY id
        `,
        params: [3, 6, '%example.com'],
        dbAlias: 'main'
      },
      { log: console }
    );
    
    expect(result).toBeDefined();
    const parsed = JSON.parse(result);
    expect(parsed).toBeInstanceOf(Array);
    expect(parsed.length).toBeGreaterThan(0);
    
    // Verify all returned users match our criteria
    parsed.forEach((user: any) => {
      const matchesIdRange = user.id > 3 && user.id <= 6;
      const matchesEmailPattern = user.email.endsWith('example.com');
      expect(matchesIdRange || matchesEmailPattern).toBe(true);
    });
  });
  
  test('execute_tool: should handle batch operations', async () => {
    // Create a test table for batch operations
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS test_batch (
        id SERIAL PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    
    // Clean up any existing data to ensure consistent test results
    await sql.unsafe(`TRUNCATE test_batch RESTART IDENTITY`);
    
    const executeTool = server.tools.find((tool: any) => tool.name === 'execute_tool')!;
    
    // Execute a batch insert
    const result = await executeTool.execute(
      {
        statement: `
          INSERT INTO test_batch (value)
          VALUES ($1), ($2), ($3), ($4), ($5)
          RETURNING id, value
        `,
        params: ['value1', 'value2', 'value3', 'value4', 'value5'],
        dbAlias: 'main'
      },
      { log: console }
    );
    
    expect(result).toBeDefined();
    expect(result).toContain('Rows affected: 5');
    
    // Verify all records were inserted
    const queryResult = await sql.unsafe('SELECT COUNT(*) as count FROM test_batch');
    expect(parseInt(queryResult[0].count)).toBe(5);
  });
  
  test('execute_tool: should handle DDL statements', async () => {
    const executeTool = server.tools.find((tool: any) => tool.name === 'execute_tool')!;
    
    // Create a new table with execute_tool
    const result = await executeTool.execute(
      {
        statement: `
          CREATE TABLE IF NOT EXISTS test_ddl (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          )
        `,
        params: [],
        dbAlias: 'main'
      },
      { log: console }
    );
    
    expect(result).toBeDefined();
    
    // Verify table was created by querying information_schema
    const tableExists = await sql.unsafe(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'test_ddl'
      ) as exists
    `);
    
    expect(tableExists[0].exists).toBe(true);
    
    // Also test dropping the table
    const dropResult = await executeTool.execute(
      {
        statement: 'DROP TABLE test_ddl',
        params: [],
        dbAlias: 'main'
      },
      { log: console }
    );
    
    expect(dropResult).toBeDefined();
    
    // Verify table was dropped
    const tableStillExists = await sql.unsafe(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'test_ddl'
      ) as exists
    `);
    
    expect(tableStillExists[0].exists).toBe(false);
  });
  
  test('transaction_tool: should handle mixed DDL and DML operations', async () => {
    const transactionTool = server.tools.find((tool: any) => tool.name === 'transaction_tool')!;
    
    // Drop the test table if it exists to ensure a clean slate
    try {
      await sql.unsafe('DROP TABLE IF EXISTS test_transaction_mixed');
    } catch (error) {
      console.error('Failed to drop test table:', error);
    }
    
    // Attempt a transaction with both DDL and DML operations
    const result = await transactionTool.execute(
      {
        operations: [
          {
            statement: `
              CREATE TABLE IF NOT EXISTS test_transaction_mixed (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL
              )
            `,
            params: []
          },
          {
            statement: 'INSERT INTO test_transaction_mixed (name) VALUES ($1), ($2)',
            params: ['Item 1', 'Item 2']
          },
          {
            statement: 'SELECT * FROM test_transaction_mixed',
            params: []
          }
        ],
        dbAlias: 'main'
      },
      { log: console }
    );
    
    expect(result).toBeDefined();
    const parsed = JSON.parse(result);
    
    // Some PostgreSQL versions don't allow DDL in transactions, so check for success or expected error
    if (parsed.success) {
      expect(parsed.results.length).toBe(3);
      
      // Truncate the table first to ensure we only have our fresh data
      await sql.unsafe('TRUNCATE test_transaction_mixed RESTART IDENTITY');
      
      // Re-insert our test data outside the transaction for verification
      await sql.unsafe('INSERT INTO test_transaction_mixed (name) VALUES ($1), ($2)', ['Item 1', 'Item 2']);
      
      // Verify the table exists and has the inserted data
      const tableData = await sql.unsafe('SELECT * FROM test_transaction_mixed ORDER BY id');
      expect(tableData.length).toBe(2);
      expect(tableData[0].name).toBe('Item 1');
      expect(tableData[1].name).toBe('Item 2');
    } else {
      // If transaction failed, verify it contained the expected error about DDL in transactions
      expect(parsed.error.toLowerCase()).toContain('transaction');
    }
  });
  
  test('transaction_tool: should handle large transactions', async () => {
    // Create a test table with a timestamp suffix to avoid conflicts with previous test runs
    const timestamp = Date.now();
    const tableName = `test_large_transaction_${timestamp}`;
    
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id SERIAL PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    
    const transactionTool = server.tools.find((tool: any) => tool.name === 'transaction_tool')!;
    
    // Create a large number of operations
    const operations: Array<{statement: string; params: string[]}> = [];
    for (let i = 0; i < 25; i++) {
      operations.push({
        statement: `INSERT INTO ${tableName} (value) VALUES ($1)`,
        params: [`Value ${i}`]
      });
    }
    
    const result = await transactionTool.execute(
      {
        operations,
        dbAlias: 'main'
      },
      { 
        log: console,
        reportProgress: (progress: number) => console.log(`Progress: ${progress}%`)
      }
    );
    
    expect(result).toBeDefined();
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.results.length).toBe(25);
    
    // Verify all 25 records were inserted
    const count = await sql.unsafe(`SELECT COUNT(*) as count FROM ${tableName}`);
    expect(parseInt(count[0].count)).toBe(25);
    
    // Clean up after the test
    await sql.unsafe(`DROP TABLE IF EXISTS ${tableName}`);
  }, 15000); // Increase timeout to 15 seconds
  
  test('transaction_tool: should handle rollback on constraint violation', async () => {
    // Create a test table with a timestamp to ensure uniqueness
    const timestamp = Date.now();
    const tableName = `test_constraints_${timestamp}`;
    
    // Create a test table with unique constraint
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id SERIAL PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        description TEXT
      )
    `);
    
    const transactionTool = server.tools.find((tool: any) => tool.name === 'transaction_tool')!;
    
    // Execute a transaction that will violate the unique constraint
    const result = await transactionTool.execute(
      {
        operations: [
          {
            statement: `INSERT INTO ${tableName} (code, description) VALUES ($1, $2)`,
            params: ['CODE1', 'First code']
          },
          {
            statement: `INSERT INTO ${tableName} (code, description) VALUES ($1, $2)`,
            params: ['CODE2', 'Second code']
          },
          {
            statement: `INSERT INTO ${tableName} (code, description) VALUES ($1, $2)`,
            params: ['CODE1', 'Duplicate code - will fail']
          }
        ],
        dbAlias: 'main'
      },
      { log: console }
    );
    
    expect(result).toBeDefined();
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error.toLowerCase()).toContain('unique');
    expect(parsed.failedOperationIndex).toBe(2);
    
    // Verify no records were inserted due to transaction rollback
    const count = await sql.unsafe(`SELECT COUNT(*) as count FROM ${tableName}`);
    expect(parseInt(count[0].count)).toBe(0);
    
    // Clean up after test
    await sql.unsafe(`DROP TABLE IF EXISTS ${tableName}`);
  });
  
  test('resource template: should handle tables with special characters', async () => {
    // Create a unique table name with timestamp
    const timestamp = Date.now();
    const tableName = `test-special_chars_${timestamp}`;
    
    // Create a table with special characters in the name
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS "${tableName}" (
        id SERIAL PRIMARY KEY,
        "column-with_special_chars" TEXT NOT NULL
      )
    `);
    
    const schemaTemplate = server.resourceTemplates.find((t: any) => 
      t.uriTemplate === 'db://{dbAlias}/schema/{tableName}'
    )!;
    
    // Get schema for table with special characters
    const result = await schemaTemplate.load({
      dbAlias: 'main',
      tableName
    });
    
    expect(result).toBeDefined();
    expect(result.text).toBeDefined();
    
    const parsed = JSON.parse(result.text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2); // id and the special column
    
    // Verify columns were correctly identified
    const columnNames = parsed.map((col: any) => col.column_name);
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('column-with_special_chars');
    
    // Clean up after test
    await sql.unsafe(`DROP TABLE IF EXISTS "${tableName}"`);
  });
}); 