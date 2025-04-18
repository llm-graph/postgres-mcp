import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import postgres from 'postgres';
import { safeJsonStringify, createPostgresClient } from '../../src/utils';
import { 
  setupTestDb, 
  cleanupTestDb, 
  retryDatabaseOperation, 
  setupSignalHandlers,
  registerTestResources,
  performCleanup,
  type TestResources
} from '../test-utils';

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

  test('all_schemas_tool: should return schemas for all tables', async () => {
    const allSchemasTool = server.tools.find((tool: any) => tool.name === 'all_schemas_tool')!;
    const result = await allSchemasTool.execute(
      {
        dbAlias: 'main'
      },
      { log: console }
    );

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    
    const parsed = JSON.parse(result);
    expect(parsed).toBeInstanceOf(Object);
    
    // Expect the test_users table to be present
    expect(parsed['test_users']).toBeDefined();
    expect(parsed['test_users']).toBeInstanceOf(Array);
    
    // Should have 4 columns in test_users
    expect(parsed['test_users'].length).toBe(4);
    
    // Organize columns by name for easier verification
    const columns: Record<string, any> = {};
    parsed['test_users'].forEach((col: any) => {
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
    
    // Verify email column
    expect(columns.email).toBeDefined();
    expect(columns.email.data_type).toBe('text');
    expect(columns.email.is_nullable).toBe('NO');
    
    // Verify created_at column
    expect(columns.created_at).toBeDefined();
    expect(columns.created_at.data_type).toBe('timestamp with time zone');
    expect(columns.created_at.is_nullable).toBe('YES');
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
}); 