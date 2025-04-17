// Example showing how to use postgres-mcp as a package
import { startServer } from 'postgres-mcp';

// Define environment variables if not using a .env file
// process.env.DB_ALIASES = 'main,reporting';
// process.env.DEFAULT_DB_ALIAS = 'main';
// process.env.DB_MAIN_HOST = 'localhost';
// ... other environment variables ...

// Start the MCP server
startServer(); 