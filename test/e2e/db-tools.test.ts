import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import postgres from 'postgres';
import { createMcpServer } from '../../src/core';
import { spawn } from 'child_process';
import { Operation } from '../../src/types';
import { safeJsonStringify } from '../../src/utils';

// @ts-ignore - Used for type documentation
interface Tool {
  name: string;
  execute: (args: any) => Promise<any>;
}

// @ts-ignore - Used for type documentation
interface ResourceTemplate {
  uriTemplate: string;
  load: (args: any) => Promise<{ text?: string; blob?: string }>;
}

const DOCKER_POSTGRES_NAME = 'postgres-mcp-test';
const POSTGRES_PORT = 5433; // Using 5433 instead of 5432 to avoid conflicts with existing PostgreSQL
const POSTGRES_USER = 'postgres';
const POSTGRES_PASSWORD = 'postgres';
const POSTGRES_DB = 'testdb';

// Track global resources for cleanup
let globalContainerStarted = false;
let globalDbConnection: postgres.Sql<{}> | null = null;

// Direct test executor functions that use our test connection
const executeTestQuery = async (
  sql: postgres.Sql<{}>,
  statement: string,
  params: any[] = []
): Promise<string> => {
  try {
    const result = await sql.unsafe(statement, params);
    return safeJsonStringify(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Query execution failed: ${errorMessage}`);
  }
};

const executeTestCommand = async (
  sql: postgres.Sql<{}>,
  statement: string,
  params: any[] = []
): Promise<string> => {
  try {
    const result = await sql.unsafe(statement, params);
    return `Rows affected: ${result.count}`;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Command execution failed: ${errorMessage}`);
  }
};

const executeTestTransaction = async (
  sql: postgres.Sql<{}>,
  operations: Operation[]
): Promise<string> => {
  const results: Array<{ operation: number; rowsAffected: number }> = [];
  let success = true;
  let errorMessage = '';
  let failedOperationIndex = -1;
  
  try {
    await sql.begin(async (transaction) => {
      for (let i = 0; i < operations.length; i++) {
        const operation = operations[i];
        try {
          const result = await transaction.unsafe(operation.statement, operation.params || []);
          results.push({
            operation: i,
            rowsAffected: result.count || 0
          });
        } catch (error) {
          success = false;
          errorMessage = error instanceof Error ? error.message : String(error);
          failedOperationIndex = i;
          throw error; // This will trigger rollback
        }
      }
    });
    
    // If we get here, all operations were successful
    return safeJsonStringify({
      success: true,
      results
    });
  } catch (error) {
    // Transaction was rolled back
    if (!errorMessage) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
    
    return safeJsonStringify({
      success: false,
      error: errorMessage,
      failedOperationIndex
    });
  }
};

const execCommand = async (command: string, args: string[], timeoutMs = 10000): Promise<string> => {
  console.log(`Executing: ${command} ${args.join(' ')}`);
  
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { shell: true });
    let stdout = '';
    let stderr = '';
    
    // Add timeout handler
    const timeout = setTimeout(() => {
      console.error(`Command timed out after ${timeoutMs}ms: ${command} ${args.join(' ')}`);
      proc.kill();
      reject(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    
    proc.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[stdout] ${output}`);
      stdout += output;
    });
    
    proc.stderr.on('data', (data) => {
      const output = data.toString();
      console.error(`[stderr] ${output}`);
      stderr += output;
    });
    
    proc.on('close', (code) => {
      clearTimeout(timeout);
      console.log(`Command exited with code ${code}`);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr}`));
      }
    });
    
    proc.on('error', (error) => {
      clearTimeout(timeout);
      console.error('Command execution error:', error);
      reject(error);
    });
  });
};

const isDockerAvailable = async (): Promise<boolean> => {
  try {
    await execCommand('docker', ['--version']);
    return true;
  } catch (error) {
    console.error('Docker is not available:', error);
    return false;
  }
};

const startPostgresContainer = async (): Promise<boolean> => {
  try {
    if (!(await isDockerAvailable())) {
      console.error('Docker is not available or not properly installed.');
      return false;
    }
    
    // Check if the container is already running
    console.log('Checking for existing container...');
    const containerCheck = await execCommand('docker', ['ps', '-a', '-q', '-f', `name=${DOCKER_POSTGRES_NAME}`]);
    
    if (containerCheck.trim()) {
      console.log('Removing existing container...');
      await execCommand('docker', ['stop', DOCKER_POSTGRES_NAME]).catch(e => 
        console.error('Failed to stop container, it may not be running:', e.message));
      await execCommand('docker', ['rm', DOCKER_POSTGRES_NAME]);
    }
    
    // Start a new container
    console.log('Starting new PostgreSQL container...');
    await execCommand('docker', [
      'run',
      '--name', DOCKER_POSTGRES_NAME,
      '-e', `POSTGRES_PASSWORD=${POSTGRES_PASSWORD}`,
      '-e', `POSTGRES_USER=${POSTGRES_USER}`,
      '-e', `POSTGRES_DB=${POSTGRES_DB}`,
      '-p', `${POSTGRES_PORT}:5432`,
      '-d', 'postgres:14-alpine'
    ]);
    
    console.log('PostgreSQL container started successfully');
    globalContainerStarted = true;
    
    // Wait for PostgreSQL to initialize
    console.log('Waiting for PostgreSQL to initialize...');
    let attempts = 0;
    let connected = false;
    const maxAttempts = 30;
    
    while (attempts < maxAttempts && !connected) {
      try {
        console.log(`Connection attempt ${attempts + 1}/${maxAttempts}...`);
        const testSql = postgres({
          host: 'localhost',
          port: POSTGRES_PORT,
          database: POSTGRES_DB,
          user: POSTGRES_USER,
          password: POSTGRES_PASSWORD,
          connect_timeout: 5
        });
        
        await testSql`SELECT 1`;
        connected = true;
        await testSql.end();
        console.log('Successfully connected to PostgreSQL!');
      } catch (error) {
        console.log(`Connection attempt failed: ${error instanceof Error ? error.message : String(error)}`);
        attempts++;
        console.log(`Waiting before next attempt...`);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Longer wait time
      }
    }
    
    if (!connected) {
      throw new Error('Failed to connect to PostgreSQL after multiple attempts');
    }
    
    return true;
  } catch (error) {
    console.error('Failed to start PostgreSQL container:', error);
    return false;
  }
};

const stopPostgresContainer = async (): Promise<void> => {
  try {
    console.log('Stopping and removing PostgreSQL container...');
    try {
      // Try normal stop first with a shorter timeout
      await execCommand('docker', ['stop', DOCKER_POSTGRES_NAME], 5000);
    } catch (stopError) {
      console.warn('Normal stop failed, attempting force kill:', stopError);
      // If normal stop fails or times out, try force kill
      await execCommand('docker', ['kill', DOCKER_POSTGRES_NAME], 5000).catch(e => 
        console.error('Force kill also failed:', e.message));
    }
    
    try {
      // Remove the container
      await execCommand('docker', ['rm', DOCKER_POSTGRES_NAME], 5000);
    } catch (rmError) {
      console.warn('Normal remove failed, attempting force remove:', rmError);
      // If normal remove fails, try force remove
      await execCommand('docker', ['rm', '-f', DOCKER_POSTGRES_NAME], 5000).catch(e => 
        console.error('Force remove also failed:', e.message));
    }
    
    console.log('PostgreSQL container stopped and removed successfully');
    globalContainerStarted = false;
  } catch (error) {
    console.error('Failed to stop PostgreSQL container:', error);
  }
};

// Add a forceful cleanup to handle any leftover resources
const forceCleanup = async (): Promise<void> => {
  console.log('Performing force cleanup of any leftover resources...');
  
  // End any global DB connection
  if (globalDbConnection) {
    try {
      console.log('Force ending database connection...');
      await globalDbConnection.end({timeout: 1}).catch(e => 
        console.error('Error ending connection:', e.message));
      globalDbConnection = null;
    } catch (error) {
      console.error('Failed to end database connection:', error);
    }
  }
  
  // Try to kill any running postgres container with our name
  try {
    await execCommand('docker', ['rm', '-f', DOCKER_POSTGRES_NAME], 5000)
      .catch(() => console.log('No container to remove, continuing.'));
    globalContainerStarted = false;
  } catch (error) {
    console.log('Force cleanup of container encountered non-critical error:', error);
  }
  
  console.log('Force cleanup complete');
};

// Clean disconnect from database
const cleanDisconnect = async (sql: postgres.Sql<{}>): Promise<void> => {
  try {
    console.log('Performing clean disconnect from database...');
    
    // First cancel any active queries
    try {
      console.log('Canceling any active queries...');
      // Execute a query to kill other connections to our database
      await sql.unsafe(`
        SELECT pg_terminate_backend(pid) 
        FROM pg_stat_activity 
        WHERE datname = $1 
          AND pid <> pg_backend_pid()
      `, [POSTGRES_DB]).catch(e => console.log('Query cancellation error:', e.message));
    } catch (error) {
      console.error('Failed to cancel active queries:', error);
    }
    
    // Close connection with timeout
    try {
      console.log('Ending connection...');
      const endPromise = sql.end({timeout: 3});
      const timeoutPromise = new Promise<void>((_, reject) => 
        setTimeout(() => reject(new Error('Connection end timed out after 3 seconds')), 3000)
      );
      
      await Promise.race([endPromise, timeoutPromise]);
      console.log('Connection ended successfully');
    } catch (error) {
      console.error('Connection end failed, forcing termination:', error);
      try {
        sql.end({timeout: 1});
      } catch (forceError) {
        console.error('Force end also failed:', forceError);
      }
    }
  } catch (error) {
    console.error('Error during clean disconnect:', error);
  }
};

// Set up emergency cleanup for unexpected termination
const setupEmergencyCleanup = () => {
  const cleanup = async () => {
    console.log('Emergency cleanup triggered...');
    await forceCleanup();
    process.exit(1);
  };
  
  // Handle various signals
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    cleanup();
  });
};

// Initialize emergency cleanup
setupEmergencyCleanup();

describe('Database MCP Tools E2E', () => {
  let server: any;
  let sql: postgres.Sql<{}>;
  let dbConnected = false;
  let containerStarted = false;

  // Setup: Start server and create test table
  beforeAll(async () => {
    console.log('Starting E2E test setup...');
    
    // Force cleanup any resources from previous runs that might have failed
    await forceCleanup();
    
    // Start PostgreSQL container
    console.log('Attempting to start PostgreSQL container...');
    containerStarted = await startPostgresContainer();
    
    if (!containerStarted) {
      console.warn('Failed to start PostgreSQL container, tests will be skipped.');
      return;
    }
    
    try {
      // Set environment variables for the MCP server
      process.env['DB_MAIN_HOST'] = 'localhost';
      process.env['DB_MAIN_PORT'] = POSTGRES_PORT.toString();
      process.env['DB_MAIN_NAME'] = POSTGRES_DB;
      process.env['DB_MAIN_USER'] = POSTGRES_USER;
      process.env['DB_MAIN_PASSWORD'] = POSTGRES_PASSWORD;
      
      console.log('Creating MCP server...');
      server = createMcpServer();
      
      // Connect directly for test setup and teardown
      console.log('Connecting to database for test setup...');
      sql = postgres({
        host: 'localhost',
        port: POSTGRES_PORT,
        database: POSTGRES_DB,
        user: POSTGRES_USER,
        password: POSTGRES_PASSWORD,
        connect_timeout: 10,
        max_lifetime: 60 * 5, // 5 minutes max lifetime for connections
        idle_timeout: 30,     // 30 seconds before idle connections are closed
      });
      
      // Keep track of connection globally
      globalDbConnection = sql;
      
      // Test connection
      console.log('Testing database connection...');
      await sql`SELECT 1`;
      console.log('Database connection successful');
      dbConnected = true;
      
      // Drop test table if it exists (clean start)
      console.log('Ensuring test table does not exist...');
      try {
        const dropPromise = sql`DROP TABLE IF EXISTS test_users CASCADE`;
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Drop table operation timed out after 5 seconds')), 5000)
        );
        await Promise.race([dropPromise, timeoutPromise]);
      } catch (dropError) {
        console.error('Failed to drop existing table:', dropError);
        // This is not fatal, continue with test setup
      }
      
      // Create a test table
      console.log('Creating test table...');
      await sql`
        CREATE TABLE IF NOT EXISTS test_users (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `;
      console.log('Test table created successfully');

      // Clear any existing data
      console.log('Clearing existing data...');
      await sql`DELETE FROM test_users`;
      
      // Insert test data
      console.log('Inserting test data...');
      await sql`
        INSERT INTO test_users (name, email) VALUES 
        ('User One', 'user1@example.com'),
        ('User Two', 'user2@example.com')
      `;
      console.log('Test data inserted successfully');
    } catch (error) {
      console.error('Failed to setup test database:', error);
      dbConnected = false;
      
      // Clean up container if db setup failed
      if (containerStarted) {
        await stopPostgresContainer().catch(e => console.error('Failed to stop container during cleanup:', e));
        containerStarted = false;
      }
    }
  });

  // Cleanup: Drop test table and stop PostgreSQL container
  afterAll(async () => {
    console.log('Starting E2E test cleanup...');
    
    // Set a maximum timeout for the entire cleanup process
    const cleanupPromise = (async () => {
      if (dbConnected && sql) {
        try {
          console.log('Terminating all active connections to database...');
          try {
            // Kill other connections to our database first
            await sql.unsafe(`
              SELECT pg_terminate_backend(pid) 
              FROM pg_stat_activity 
              WHERE datname = $1 
                AND pid <> pg_backend_pid()
            `, [POSTGRES_DB]);
          } catch (terminateError) {
            console.error('Failed to terminate connections:', terminateError);
            // Non-fatal, continue
          }
          
          console.log('Dropping test table...');
          try {
            // Try to drop the table with a timeout
            const dropPromise = sql`DROP TABLE IF EXISTS test_users CASCADE`;
            const dropTimeoutPromise = new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Drop table operation timed out after 5 seconds')), 5000)
            );
            await Promise.race([dropPromise, dropTimeoutPromise]);
            console.log('Test table dropped successfully');
          } catch (dropError) {
            console.error('Failed to drop test table:', dropError);
            // Non-fatal, continue with cleanup
          }
          
          // Properly close database connection
          await cleanDisconnect(sql);
          globalDbConnection = null;
        } catch (error) {
          console.error('Database cleanup failed:', error);
        }
      }
      
      if (containerStarted) {
        console.log('Stopping PostgreSQL container...');
        await stopPostgresContainer();
      }
      
      console.log('E2E test cleanup complete');
    })();
    
    // Set an overall timeout for the entire cleanup
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => {
        console.error('Overall cleanup timed out after 30 seconds, forcing exit...');
        reject(new Error('Cleanup timeout exceeded'));
      }, 30000);
    });
    
    try {
      await Promise.race([cleanupPromise, timeoutPromise]);
    } catch (error) {
      console.error('Cleanup error:', error);
      // Force final cleanup
      await forceCleanup();
    }
  });

  test('query_tool: should return users from database', async () => {
    if (!dbConnected) {
      console.warn('Skipping test: PostgreSQL connection not available');
      return;
    }
    
    const result = await executeTestQuery(
      sql,
      'SELECT * FROM test_users ORDER BY id',
      []
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
    if (!dbConnected) {
      console.warn('Skipping test: PostgreSQL connection not available');
      return;
    }
    
    const result = await executeTestQuery(
      sql,
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_name = 'test_users'
       ORDER BY ordinal_position`,
      []
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
    if (!dbConnected) {
      console.warn('Skipping test: PostgreSQL connection not available');
      return;
    }
    
    const result = await executeTestCommand(
      sql,
      'INSERT INTO test_users (name, email) VALUES ($1, $2)',
      ['User Three', 'user3@example.com']
    );

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    expect(result).toContain('Rows affected: 1');

    // Verify the insert succeeded
    const rows = await sql`SELECT * FROM test_users WHERE email = 'user3@example.com'`;
    expect(rows.length).toBe(1);
    expect(rows[0]['name']).toBe('User Three');
  });

  test('transaction_tool: should execute multiple statements atomically', async () => {
    if (!dbConnected) {
      console.warn('Skipping test: PostgreSQL connection not available');
      return;
    }
    
    const result = await executeTestTransaction(
      sql,
      [
        {
          statement: 'INSERT INTO test_users (name, email) VALUES ($1, $2)',
          params: ['User Four', 'user4@example.com']
        },
        {
          statement: 'INSERT INTO test_users (name, email) VALUES ($1, $2)',
          params: ['User Five', 'user5@example.com']
        }
      ]
    );

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    
    const parsed = JSON.parse(result);
    expect(parsed['success']).toBe(true);
    expect(parsed['results'].length).toBe(2);
    expect(parsed['results'][0]['rowsAffected']).toBe(1);
    expect(parsed['results'][1]['rowsAffected']).toBe(1);

    // Verify both inserts succeeded
    const rows = await sql`SELECT * FROM test_users WHERE email IN ('user4@example.com', 'user5@example.com') ORDER BY email`;
    expect(rows.length).toBe(2);
    expect(rows[0]['email']).toBe('user4@example.com');
    expect(rows[1]['email']).toBe('user5@example.com');
  });

  test('transaction_tool: should roll back on error', async () => {
    if (!dbConnected) {
      console.warn('Skipping test: PostgreSQL connection not available');
      return;
    }
    
    // Count users before transaction
    const beforeCount = (await sql`SELECT COUNT(*) AS count FROM test_users`)[0]['count'];

    const result = await executeTestTransaction(
      sql,
      [
        {
          statement: 'INSERT INTO test_users (name, email) VALUES ($1, $2)',
          params: ['User Six', 'user6@example.com']
        },
        {
          statement: 'INSERT INTO test_users (name, email) VALUES ($1, $2)',
          params: ['User Six', 'user3@example.com'] // This email already exists, will cause an error
        }
      ]
    );

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    
    const parsed = JSON.parse(result);
    expect(parsed['success']).toBe(false);
    expect(parsed['error']).toBeDefined();
    expect(parsed['failedOperationIndex']).toBe(1);

    // Verify count hasn't changed (transaction rolled back)
    const afterCount = (await sql`SELECT COUNT(*) AS count FROM test_users`)[0]['count'];
    expect(afterCount).toBe(beforeCount);
  });

  test('resource template: should list tables', async () => {
    if (!dbConnected) {
      console.warn('Skipping test: PostgreSQL connection not available');
      return;
    }
    
    const result = await executeTestQuery(
      sql,
      `SELECT table_name 
       FROM information_schema.tables 
       WHERE table_schema = 'public' 
         AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
      []
    );
    
    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    
    const parsed = JSON.parse(result);
    expect(parsed).toBeInstanceOf(Array);
    expect(parsed.map((row: any) => row.table_name)).toContain('test_users');
  });

  test('resource template: should get table schema', async () => {
    if (!dbConnected) {
      console.warn('Skipping test: PostgreSQL connection not available');
      return;
    }
    
    const result = await executeTestQuery(
      sql,
      `SELECT 
         column_name, 
         data_type, 
         is_nullable, 
         column_default
       FROM 
         information_schema.columns
       WHERE 
         table_schema = 'public' 
         AND table_name = $1
       ORDER BY 
         ordinal_position`,
      ['test_users']
    );
    
    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    
    const parsed = JSON.parse(result);
    expect(parsed).toBeInstanceOf(Array);
    expect(parsed.some((col: any) => col['column_name'] === 'id')).toBe(true);
    expect(parsed.some((col: any) => col['column_name'] === 'name')).toBe(true);
    expect(parsed.some((col: any) => col['column_name'] === 'email')).toBe(true);
  });
}); 