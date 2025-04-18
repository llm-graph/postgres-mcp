/**
 * Example of using postgres-mcp programmatically as an npm library
 * 
 * This example demonstrates:
 * 1. Creating a PostgresMcp instance with custom configuration
 * 2. Connecting to databases and running SQL operations
 * 3. Properly handling lifecycle (startup/shutdown)
 */
import { createPostgresMcp, PostgresMcpOptions, Operation } from '../src/index';

// Define custom database configurations
const databaseConfig = {
  custom: {
    host: 'localhost',
    port: 5432,
    database: 'my_database',
    user: 'my_user',
    password: 'my_password',
    ssl: 'disable'
  }
};

// Define API configuration options
const apiOptions: PostgresMcpOptions = {
  // Optional custom database configurations (override .env)
  databaseConfigs: databaseConfig,
  
  // Optional server configuration
  serverConfig: {
    name: 'My Custom MCP Server',
    version: '1.0.0',
    defaultDbAlias: 'custom',
    enableAuth: false
  },
  
  // Use HTTP transport instead of stdio
  transport: 'http',
  port: 3456,
  
  // Don't start automatically
  autoStart: false
};

// Create the PostgresMcp instance
const postgresMcp = createPostgresMcp(apiOptions);

// Start the server when ready
postgresMcp.start();

/**
 * Example database operations using the programmatic API
 */
async function runExamples() {
  try {
    // Wait a moment for connections to initialize
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Example 1: List tables in the database
    const tables = await postgresMcp.listTables('custom');
    console.log('Example 1 - Tables:', tables);
    
    // Example 2: Execute a read-only query with parameters
    const usersResult = await postgresMcp.executeQuery(
      'SELECT * FROM users WHERE created_at > $1 LIMIT 5',
      ['2023-01-01'],
      'custom'
    );
    console.log('Example 2 - Query result:', usersResult);
    
    // Example 3: Execute a data-modifying command
    const updateResult = await postgresMcp.executeCommand(
      'UPDATE users SET last_login = NOW() WHERE user_id = $1',
      [123],
      'custom'
    );
    console.log('Example 3 - Update result:', updateResult);
    
    // Example 4: Execute a transaction (multiple operations atomically)
    const operations: Operation[] = [
      {
        statement: 'INSERT INTO orders (customer_id, total) VALUES ($1, $2) RETURNING order_id',
        params: [456, 99.99]
      },
      {
        statement: 'INSERT INTO order_items (order_id, product_id, quantity) VALUES ($1, $2, $3)',
        params: [1, 789, 2]
      }
    ];
    
    const transactionResult = await postgresMcp.executeTransaction(operations, 'custom');
    console.log('Example 4 - Transaction result:', transactionResult);
    
    // Example 5: Get schema for a specific table
    const userSchema = await postgresMcp.getTableSchema('users', 'custom');
    console.log('Example 5 - User table schema:', userSchema);
    
    // Example 6: Access the underlying FastMCP server for advanced usage
    console.log('Example 6 - Access to server instance:', postgresMcp.server !== undefined);
    
    // Clean up - stop the server and close all database connections
    await postgresMcp.stop();
    
    console.log('Examples completed successfully!');
  } catch (error) {
    console.error('Error running examples:', error);
    await postgresMcp.stop();
  }
}

// Run the examples (uncomment to execute)
// runExamples();

// In a real application, you might want to gracefully shut down on process exit
process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down...');
  await postgresMcp.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down...');
  await postgresMcp.stop();
  process.exit(0);
}); 