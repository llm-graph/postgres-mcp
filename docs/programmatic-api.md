# Programmatic API for postgres-mcp

While postgres-mcp is primarily designed to be run as a standalone MCP server process, you can also use it programmatically in your Node.js/TypeScript applications.

## Installation

```bash
npm install postgres-mcp
# or
yarn add postgres-mcp
# or
bun add postgres-mcp
```

## Usage Methods

There are two ways to use postgres-mcp programmatically:

1. **Instance-based API**: Create a PostgresMcp instance with `createPostgresMcp()` and use its methods
2. **Direct Function Imports**: Import specific functions directly from the package

## Method 1: Instance-based API

```typescript
import { createPostgresMcp } from 'postgres-mcp';

// Create the PostgresMcp instance
const postgresMcp = createPostgresMcp();

// Start the server
postgresMcp.start();

// When done, stop the server and close database connections
await postgresMcp.stop();
```

### Configuration Options

You can customize the behavior by passing options to `createPostgresMcp`:

```typescript
import { createPostgresMcp } from 'postgres-mcp';

const postgresMcp = createPostgresMcp({
  // Custom database configurations (override .env)
  databaseConfigs: {
    main: {
      host: 'localhost',
      port: 5432,
      database: 'my_database',
      user: 'my_user',
      password: 'my_password',
      ssl: 'disable'
    },
    analytics: {
      host: 'analytics-db.example.com',
      port: 5432,
      database: 'analytics',
      user: 'analyst',
      password: 'secure_password',
      ssl: 'require'
    }
  },
  // Server configuration
  serverConfig: {
    name: 'My Custom MCP Server',
    version: '1.0.0',
    defaultDbAlias: 'main',
    enableAuth: true,
    apiKey: 'my-secret-api-key'
  },
  // Transport options
  transport: 'http', // 'stdio', 'sse', or 'http'
  port: 3456, // for http/sse transports
  // Start the server automatically
  autoStart: true
});
```

### Database Operations

```typescript
// Execute a SELECT query
const results = await postgresMcp.executeQuery(
  'SELECT * FROM users WHERE role = $1 LIMIT 10',
  ['admin'],
  'main' // optional database alias, uses defaultDbAlias if omitted
);

// Parse the results
const users = JSON.parse(results);
console.log('Admin users:', users);

// Execute a data-modifying command
const updateResult = await postgresMcp.executeCommand(
  'UPDATE users SET last_login = NOW() WHERE user_id = $1',
  [123],
  'main'
);
console.log(updateResult); // "Rows affected: 1"

// Execute a transaction
const transactionResult = await postgresMcp.executeTransaction([
  {
    statement: 'INSERT INTO orders (customer_id, total) VALUES ($1, $2) RETURNING order_id',
    params: [456, 99.99]
  },
  {
    statement: 'INSERT INTO order_items (order_id, product_id, quantity) VALUES ($1, $2, $3)',
    params: [1, 789, 2]
  }
]);
const transactionData = JSON.parse(transactionResult);
if (transactionData.success) {
  console.log('Transaction succeeded:', transactionData.results);
} else {
  console.error('Transaction failed:', transactionData.error);
}
```

### Schema Operations

```typescript
// List all tables in a database
const tables = await postgresMcp.listTables('main');
console.log('Tables:', tables);

// Get schema information for a specific table
const userSchema = await postgresMcp.getTableSchema('users', 'main');
console.log('User table schema:', userSchema);
```

## Method 2: Direct Function Imports

For simple use cases or when you don't need the MCP server functionality, you can import specific functions directly:

```typescript
import { 
  initConnections, 
  closeConnections, 
  executeQuery, 
  executeCommand, 
  executeTransaction, 
  fetchTableSchema,
  fetchAllTableSchemas, // Original all tables schema function
  getTableSchema,       // Simplified single table schema
  getAllTableSchemas    // Simplified all tables schema
} from 'postgres-mcp';

// Define database configurations
const databaseConfigs = {
  main: {
    host: 'localhost',
    port: 5432,
    database: 'my_database',
    user: 'my_user',
    password: 'my_password'
  }
};

// Initialize database connections
initConnections(databaseConfigs);

// Execute queries directly
try {
  // Execute a query
  const result = await executeQuery(
    'SELECT * FROM users WHERE id = $1',
    [123],
    'main' // optional database alias, defaults to 'main'
  );
  console.log('Query result:', result);
  
  // Execute a command
  const commandResult = await executeCommand(
    'UPDATE users SET last_login = NOW() WHERE id = $1',
    [123],
    'main'
  );
  console.log('Command result:', commandResult);
  
  // Execute a transaction
  const transactionResult = await executeTransaction([
    {
      statement: 'INSERT INTO orders (customer_id, total) VALUES ($1, $2)',
      params: [456, 99.99]
    },
    {
      statement: 'UPDATE customers SET order_count = order_count + 1 WHERE id = $1',
      params: [456]
    }
  ], 'main');
  console.log('Transaction result:', transactionResult);
  
  // Method 1: Get single table schema (original API)
  const schemaResult = await fetchTableSchema({ 
    args: { 
      alias: 'main', 
      name: 'users' 
    } 
  });
  
  if (schemaResult.type === 'result') {
    console.log('Table schema:', schemaResult.schema);
  } else {
    console.error('Schema error:', schemaResult.error);
  }
  
  // Method 2: Get single table schema (simplified API)
  try {
    const schema = await getTableSchema('users', 'main');
    console.log('Table schema (simplified):', schema);
  } catch (error) {
    console.error('Schema error:', error.message);
  }
  
  // Method 1: Get all table schemas (original API)
  const allSchemasResult = await fetchAllTableSchemas({
    args: {
      alias: 'main'
    }
  });
  
  if (allSchemasResult.type === 'result') {
    console.log('All table schemas:', allSchemasResult.schemas);
  } else {
    console.error('Schema error:', allSchemasResult.error);
  }
  
  // Method 2: Get all table schemas (simplified API)
  try {
    const allSchemas = await getAllTableSchemas('main');
    console.log('All table schemas (simplified):', allSchemas);
  } catch (error) {
    console.error('Schema error:', error.message);
  }
} catch (error) {
  console.error('Error:', error);
} finally {
  // Always close connections when done
  await closeConnections();
}
```

## Using with the MCP Protocol

If you want to use the MCP server in your application but still communicate with it using the MCP protocol:

```typescript
import { createPostgresMcp } from 'postgres-mcp';

// Create and start the MCP server with HTTP transport
const postgresMcp = createPostgresMcp({
  transport: 'http',
  port: 3456,
  autoStart: true
});

// Now you can connect to http://localhost:3456/mcp with any MCP client
console.log('MCP server running on http://localhost:3456/mcp');

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await postgresMcp.stop();
  process.exit(0);
});
```

## TypeScript Support

The library provides full TypeScript definitions for all APIs:

```typescript
import { 
  createPostgresMcp, 
  PostgresMcp,
  PostgresMcpOptions,
  DatabaseConfig,
  Operation
} from 'postgres-mcp';

// All types are available for your TypeScript projects
const options: PostgresMcpOptions = {
  // ...
};

const postgres: PostgresMcp = createPostgresMcp(options);

// Define typed operations
const operations: Operation[] = [
  { statement: 'INSERT INTO users (name) VALUES ($1)', params: ['Alice'] }
];
```

## Examples

See the following examples for complete demonstrations:
- [Instance-based API](../examples/programmatic-api.ts)
- [Direct Function Imports](../examples/direct-imports.ts)

## Notes on Environment Variables

Even when used programmatically, postgres-mcp will still load environment variables from a `.env` file if present. You can override these settings by providing explicit configurations in the options object.

## Error Handling

All database methods will throw errors if operations fail. Be sure to use try/catch blocks:

```typescript
try {
  const result = await postgresMcp.executeQuery('SELECT * FROM non_existent_table');
  // Process result
} catch (error) {
  console.error('Query failed:', error.message);
}
``` 