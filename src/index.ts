// Load environment variables first
import { config } from 'dotenv';
import { startServer } from './core';
import { runCli, startCliProcess } from './utils';

// Load environment variables from .env file
config();

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