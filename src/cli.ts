#!/usr/bin/env node

import { startServer } from './core';

// Start the server and keep reference
startServer();

// Prevent the process from exiting
process.stdin.resume();

// Handle process exit signals to properly clean up
process.on('SIGINT', () => {
  console.log('Shutting down MCP server...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down MCP server...');
  process.exit(0);
}); 