import { spawn } from 'child_process';
import dotenv from 'dotenv';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Load environment variables from .env file
const __dirname = dirname(fileURLToPath(import.meta.url));
const result = dotenv.config({ path: join(process.cwd(), '.env') });

// Check if .env file was loaded properly
if (result.error) {
  console.error('Error loading .env file:', result.error);
  console.error('Make sure .env file exists in project root and has correct format');
} else {
  console.log('Environment variables loaded from .env file');
  
  // Output essential environment variables for debugging
  console.log('Essential environment variables:');
  console.log('DB_MAIN_HOST:', process.env['DB_MAIN_HOST'] || '(not set)');
  console.log('DB_MAIN_NAME:', process.env['DB_MAIN_NAME'] || '(not set)');
}

// This dev script uses the fastmcp CLI to properly handle client capabilities
console.log('Starting MCP dev environment...');

// Start the fastmcp CLI with our index.ts
const mcpProcess = spawn('bunx', ['fastmcp', 'dev', 'src/index.ts'], {
  stdio: 'inherit',
  shell: true,
  env: process.env // Explicitly pass environment variables to child process
});

// Handle process exit
mcpProcess.on('exit', (code) => {
  if (code !== 0) {
    console.error(`fastmcp exited with code ${code}`);
  }
  process.exit(code);
});

// Handle process exit signals to properly clean up
process.on('SIGINT', () => {
  console.log('Shutting down MCP server...');
  if (mcpProcess) {
    mcpProcess.kill();
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down MCP server...');
  if (mcpProcess) {
    mcpProcess.kill();
  }
  process.exit(0);
}); 