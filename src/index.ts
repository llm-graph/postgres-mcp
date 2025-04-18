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

import { startServer, createPostgresMcp } from './core';
import { runCli, startCliProcess } from './utils';

// Export core functionality
export { startServer, createPostgresMcp } from './core';

// Export types
export * from './types';

// Export utility functions
export * from './utils';

// Export constants
export * from './constants';

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