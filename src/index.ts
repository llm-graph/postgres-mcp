// Load environment variables first
import { loadEnvFile } from './utils';

// Load environment variables from the appropriate .env file based on NODE_ENV
const nodeEnv = process.env.NODE_ENV || 'development';
const { path: envFile, loaded } = loadEnvFile(nodeEnv);

if (loaded) {
  console.log(`Environment variables loaded from ${envFile}`);
} else {
  console.warn(`Failed to load environment variables from .env.${nodeEnv}, .env.local, or .env`);
}

import { startServer } from './core';
import { runCli, startCliProcess } from './utils';

// Export core functionality
export { 
  startServer, 
  createPostgresMcp,
  // Add programmatic API exports
  initConnections,
  closeConnections,
  executeQuery,
  executeCommand,
  executeTransaction,
  fetchTableSchema,
  fetchAllTableSchemas
} from './core';

// Export types
export * from './types';

// Export utility functions
export * from './utils';

// Export constants
export * from './constants';

// Export the original fetchTableSchema function from utils
export { getTableSchema as getTableSchemaRaw } from './utils';

// Simpler wrapper for fetchTableSchema
export async function getTableSchema(tableName: string, dbAlias?: string) {
  // Import fetchTableSchema from core to avoid circular dependency
  const { fetchTableSchema } = await import('./core');
  
  const result = await fetchTableSchema({
    args: {
      name: tableName,
      alias: dbAlias || 'main'
    }
  });
  
  if (result.type === 'result') {
    return result.schema;
  } else {
    throw new Error(result.error);
  }
}

// Simpler wrapper for fetchAllTableSchemas
export async function getAllTableSchemas(dbAlias?: string) {
  // Import fetchAllTableSchemas from core to avoid circular dependency
  const { fetchAllTableSchemas } = await import('./core');
  
  const result = await fetchAllTableSchemas({
    args: {
      alias: dbAlias || 'main'
    }
  });
  
  if (result.type === 'result') {
    return result.schemas;
  } else {
    throw new Error(result.error);
  }
}

// Start the MCP server only when running the file directly
// This ensures the server doesn't start when imported as a library
// Check if this file is being executed directly rather than imported
const isMainModule = import.meta.url === undefined
  ? false
  : new URL(import.meta.url).pathname === process.argv[1];

if (isMainModule) {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    if (args[0] === 'runCli') {
      runCli();
    } else if (args[0] === 'startCliProcess') {
      startCliProcess();
    } else {
      console.log(`Unknown command: ${args[0]}`);
      startServer();
    }
  } else {
    startServer();
  }
} 