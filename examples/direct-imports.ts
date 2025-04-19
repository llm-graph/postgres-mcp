/**
 * Example of using postgres-mcp with direct function imports
 * 
 * This example demonstrates:
 * 1. Importing specific functions from postgres-mcp
 * 2. Connecting to databases and running operations directly
 * 3. Managing database connections manually
 */
import { 
  initConnections, 
  closeConnections, 
  executeQuery, 
  executeCommand, 
  executeTransaction,
  fetchTableSchema,
  fetchAllTableSchemas,
  getTableSchema,
  getAllTableSchemas,
  TableSchemaResult,
  AllTableSchemasResult
} from '../src/index';

// Define database configurations
const databaseConfigs = {
  main: {
    host: 'localhost',
    port: 5432,
    database: 'my_database',
    user: 'my_user',
    password: 'my_password',
    ssl: 'disable'
  },
  reporting: {
    host: 'localhost',
    port: 5432,
    database: 'reporting_db',
    user: 'reporter',
    password: 'report_pass',
    ssl: 'disable'
  }
};

async function runDirectExamples() {
  try {
    console.log('Initializing database connections...');
    // Initialize all database connections
    initConnections(databaseConfigs);
    
    // Give connections time to initialize
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Example 1: Execute a query
    console.log('\nExample 1: Execute a query');
    try {
      const result = await executeQuery(
        'SELECT NOW() as current_time',
        [],
        'main'
      );
      console.log('Query result:', result);
    } catch (error) {
      console.error('Query failed:', error);
    }
    
    // Example 2: Execute a command
    console.log('\nExample 2: Execute a command');
    try {
      const result = await executeCommand(
        'CREATE TABLE IF NOT EXISTS temp_users (id SERIAL PRIMARY KEY, name TEXT, created_at TIMESTAMP DEFAULT NOW())',
        [],
        'main'
      );
      console.log('Command result:', result);
    } catch (error) {
      console.error('Command failed:', error);
    }
    
    // Example 3: Execute multiple commands in a transaction
    console.log('\nExample 3: Execute a transaction');
    try {
      const result = await executeTransaction([
        {
          statement: 'INSERT INTO temp_users (name) VALUES ($1) RETURNING id',
          params: ['User 1']
        },
        {
          statement: 'INSERT INTO temp_users (name) VALUES ($1) RETURNING id',
          params: ['User 2']
        }
      ], 'main');
      console.log('Transaction result:', result);
    } catch (error) {
      console.error('Transaction failed:', error);
    }
    
    // Example a: Get schema for single table
    console.log('\nExample 4A: Fetch single table schema (original method)');
    try {
      const result: TableSchemaResult = await fetchTableSchema({ 
        args: { 
          alias: 'main', 
          name: 'temp_users' 
        } 
      });
      console.log('Table schema result:', result);
      if (result.type === 'result') {
        console.log('Schema:', result.schema);
      } else {
        console.error('Schema error:', result.error);
      }
    } catch (error) {
      console.error('Schema fetch failed:', error);
    }
    
    // Example 4B: Fetch table schema (simplified method)
    console.log('\nExample 4B: Fetch single table schema (simplified method)');
    try {
      const schema = await getTableSchema('temp_users', 'main');
      console.log('Table schema:', schema);
    } catch (error) {
      console.error('Schema fetch failed:', error);
    }
    
    // Example 5A: Fetch all table schemas (original method)
    console.log('\nExample 5A: Fetch all table schemas (original method)');
    try {
      const result: AllTableSchemasResult = await fetchAllTableSchemas({ 
        args: { 
          alias: 'main'
        } 
      });
      console.log('All table schemas result:', result);
      if (result.type === 'result') {
        console.log('All schemas:', result.schemas);
      } else {
        console.error('Schema error:', result.error);
      }
    } catch (error) {
      console.error('Schema fetch failed:', error);
    }
    
    // Example 5B: Fetch all table schemas (simplified method)
    console.log('\nExample 5B: Fetch all table schemas (simplified method)');
    try {
      const schemas = await getAllTableSchemas('main');
      console.log('All table schemas:', schemas);
    } catch (error) {
      console.error('Schema fetch failed:', error);
    }
    
    // Example 6: Using a different database connection
    console.log('\nExample 6: Using a different database connection');
    try {
      const result = await executeQuery(
        'SELECT current_database() as database',
        [],
        'reporting'
      );
      console.log('Query result from reporting DB:', result);
    } catch (error) {
      console.error('Query failed:', error);
    }
    
    // Clean up - close all database connections
    console.log('\nClosing all database connections...');
    await closeConnections();
    
    console.log('\nExamples completed!');
  } catch (error) {
    console.error('Error running examples:', error);
    await closeConnections();
  }
}

// Run the examples
runDirectExamples(); 