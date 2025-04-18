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

## Basic Usage

```typescript
import { createPostgresMcp } from 'postgres-mcp';

// Create the PostgresMcp instance
const postgresMcp = createPostgresMcp();

// Start the server
postgresMcp.start();

// When done, stop the server and close database connections
await postgresMcp.stop();
```

## Configuration Options

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

## Direct Database Operations

You can directly interact with the database without going through the MCP protocol:

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

## Schema Operations

```typescript
// List all tables in a database
const tables = await postgresMcp.listTables('main');
console.log('Tables:', tables);

// Get schema information for a specific table
const userSchema = await postgresMcp.getTableSchema('users', 'main');
console.log('User table schema:', userSchema);
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
  DatabaseConfig 
} from 'postgres-mcp';

// All types are available for your TypeScript projects
const options: PostgresMcpOptions = {
  // ...
};

const postgres: PostgresMcp = createPostgresMcp(options);
```

## Complete Example

See the [programmatic-api.ts](../examples/programmatic-api.ts) example for a complete demonstration.

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