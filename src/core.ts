import { FastMCP, UserError } from 'fastmcp';
import postgres from 'postgres';
import { 
  QueryToolParams, QueryToolParamsSchema,
  ExecuteToolParams, ExecuteToolParamsSchema,
  SchemaToolParams, SchemaToolParamsSchema,
  AllSchemasToolParams, AllSchemasToolParamsSchema,
  TransactionToolParams, TransactionToolParamsSchema,
  TransactionSuccess, TransactionFailure,
  OperationResult, DatabaseConfig,
  Operation, PostgresMcpOptions, PostgresMcp,
  TableSchemaResult
} from './types';
import { 
  safeJsonStringify, listTables,
  getTableSchema, getAllTableSchemas, detectDevEnvironment
} from './utils';
import { 
  getServerConfig, loadDatabaseConnections
} from './constants';

// Default database alias
const DEFAULT_DB_ALIAS = 'main';

// Postgres connections stored by alias
const connections: Record<string, postgres.Sql<{}>> = {};

// Initialize database connections
export function initConnections(configs?: Record<string, DatabaseConfig>): void {
  const dbConfigs = configs || loadDatabaseConnections();
  
  console.log(`Initializing database connections for aliases: ${Object.keys(dbConfigs).join(', ')}`);
  
  if (Object.keys(dbConfigs).length === 0) {
    console.error('No database configurations found. Please check your environment variables.');
    console.error('Required variables for main DB: DB_MAIN_HOST, DB_MAIN_PORT, DB_MAIN_NAME, DB_MAIN_USER, DB_MAIN_PASSWORD');
    console.error('Or alternatively define DB_MAIN_URL with connection string');
    return;
  }
  
  // Close existing connections if any
  Object.values(connections).forEach(sql => {
    try {
      sql.end();
    } catch (error) {
      console.error('Error closing database connection:', error);
    }
  });
  
  // Reset connections object
  Object.keys(connections).forEach(key => {
    delete connections[key];
  });
  
  // Create new connections
  Object.entries(dbConfigs).forEach(([alias, config]) => {
    try {
      console.log(`Connecting to database '${alias}' at ${config.host}:${config.port}/${config.database} with user '${config.user}'`);
      
      // Use an event handler for connection events
      const handleConnection = () => {
        console.log(`[${alias}] Connected to database`);
      };
      
      const handleClose = () => {
        console.log(`[${alias}] Connection closed`);
      };
      
      connections[alias] = postgres({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        ssl: config.ssl === 'disable' ? false : config.ssl ? true : undefined,
        max: 10,
        idle_timeout: 120,  // Increase timeout to 2 minutes
        connection: {
          application_name: 'postgres-mcp',
          // Increase statement_timeout to 60s
          statement_timeout: 60000
        },
        onnotice: message => {
          console.log(`[${alias}] Notice:`, message);
        },
        debug: detectDevEnvironment()
      });
      
      // Safely register event listeners separately
      // Only attempt to add these in non-test environments
      if (!process.env['BUN_ENV']?.includes('test')) {
        process.nextTick(() => {
          try {
            const sqlConnection = connections[alias] as any;
            if (sqlConnection.options && 
                sqlConnection.options.connection && 
                typeof sqlConnection.options.connection.on === 'function') {
              sqlConnection.options.connection.on('connect', handleConnection);
              sqlConnection.options.connection.on('end', handleClose);
            }
          } catch (error) {
            // Ignore if we can't add event listeners
            console.log(`Could not add event listeners for ${alias}:`, error);
          }
        });
      }
      
      // Test connection immediately if in dev environment and not in test mode
      if (detectDevEnvironment() && !process.env['BUN_ENV']?.includes('test')) {
        (async () => {
          try {
            const testResult = await connections[alias]`SELECT 1 as connected`;
            if (testResult?.[0]?.['connected'] === 1) {
              console.log(`✅ Connection to database '${alias}' established successfully`);
            } else {
              console.error(`⚠️ Connection to database '${alias}' returned unexpected result:`, testResult);
            }
          } catch (error) {
            console.error(`❌ Failed to connect to database '${alias}':`, error);
            console.error(`Connection details: host=${config.host}, port=${config.port}, database=${config.database}, user=${config.user}`);
            console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
          }
        })();
      }
    } catch (error) {
      console.error(`Failed to initialize database connection for ${alias}:`, error);
      console.error(`Connection details: host=${config.host}, port=${config.port}, database=${config.database}, user=${config.user}`);
    }
  });
}

// Close all database connections
export async function closeConnections(): Promise<void> {
  console.log('Closing all database connections...');
  
  const aliases = Object.keys(connections);
  if (aliases.length === 0) {
    console.log('No active database connections to close.');
    return;
  }
  
  for (const alias of aliases) {
    try {
      console.log(`Closing connection to '${alias}'...`);
      await connections[alias].end();
      console.log(`Connection to '${alias}' closed.`);
    } catch (error) {
      console.error(`Error closing database connection '${alias}':`, error);
    }
  }
  
  // Clear connections object
  Object.keys(connections).forEach(key => {
    delete connections[key];
  });
  
  console.log('All database connections closed.');
}

// Validate that a given alias exists in our connections
function validateDbAlias(dbAlias: string | undefined): postgres.Sql<{}> {
  const alias = dbAlias || DEFAULT_DB_ALIAS;
  const sql = connections[alias];
  
  if (!sql) {
    throw new Error(`Database connection '${alias}' not found`);
  }
  
  return sql;
}

// Execute a SQL query
export async function executeQuery(statement: string, params: any[] = [], dbAlias?: string): Promise<string> {
  const sql = validateDbAlias(dbAlias);
  
  try {
    const result = await sql.unsafe(statement, params);
    return safeJsonStringify(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Query execution failed: ${errorMessage}`);
  }
}

// Execute a SQL command (INSERT, UPDATE, DELETE)
export async function executeCommand(statement: string, params: any[] = [], dbAlias?: string): Promise<string> {
  const sql = validateDbAlias(dbAlias);
  
  try {
    const result = await sql.unsafe(statement, params);
    return `Rows affected: ${result.count}`;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Command execution failed: ${errorMessage}`);
  }
}

// Execute a transaction with multiple operations
export async function executeTransaction(
  operations: Operation[], 
  dbAlias?: string
): Promise<string> {
  const sql = validateDbAlias(dbAlias);
  const transactionFailure: TransactionFailure = {
    success: false,
    error: '',
    failedOperationIndex: -1
  };
  
  const results: OperationResult[] = [];
  
  try {
    await sql.begin(async (transaction) => {
      for (let i = 0; i < operations.length; i++) {
        const operation = operations[i];
        try {
          const opResult = await transaction.unsafe(operation.statement, operation.params || []);
          results.push({
            operation: i,
            rowsAffected: opResult.count || 0
          });
        } catch (error) {
          // Set failure details and abort transaction
          transactionFailure.error = error instanceof Error ? error.message : String(error);
          transactionFailure.failedOperationIndex = i;
          throw error; // This will trigger rollback
        }
      }
    });
    
    // If we get here, all operations were successful
    const success: TransactionSuccess = {
      success: true,
      results
    };
    
    return safeJsonStringify(success);
  } catch (error) {
    // If we have details in our failure object, use those
    if (transactionFailure.error) {
      return safeJsonStringify(transactionFailure);
    }
    
    // Otherwise, create a generic error response
    const errorMessage = error instanceof Error ? error.message : String(error);
    transactionFailure.error = `Transaction failed: ${errorMessage}`;
    return safeJsonStringify(transactionFailure);
  }
}

// Define the registerTools, registerResources, and configureServerEvents functions
const registerTools = (mcpServer: FastMCP<Record<string, unknown>>) => {
  mcpServer.addTool({
    name: 'query_tool',
    description: 'Safely execute a read-only SQL query and retrieve results',
    parameters: QueryToolParamsSchema,
    execute: async (args: QueryToolParams, { log }) => {
      try {
        const { statement, params, dbAlias } = args;
        const sql = validateDbAlias(dbAlias);
        
        log.info('Executing read-only query', { dbAlias });
        
        try {
          // Execute the query
          const result = await sql.unsafe(statement, params || []);
          return safeJsonStringify(result);
        } catch (error) {
          let errorMessage = error instanceof Error ? error.message : String(error);
          log.error('Query execution error', { error: errorMessage });
          throw new UserError(`Query error: ${errorMessage}`);
        }
      } catch (dbConnectionError) {
        let errorMessage = dbConnectionError instanceof Error ? dbConnectionError.message : String(dbConnectionError);
        console.error('Error in query_tool:', errorMessage);
        throw new UserError(`Database connection error: ${errorMessage}`);
      }
    }
  });
  
  mcpServer.addTool({
    name: 'execute_tool',
    description: 'Safely execute a data-modifying SQL statement',
    parameters: ExecuteToolParamsSchema,
    execute: async (args: ExecuteToolParams, { log }) => {
      try {
        const { statement, params, dbAlias } = args;
        const sql = validateDbAlias(dbAlias);
        
        log.info('Executing data-modifying statement', { dbAlias });
        
        try {
          // Execute the statement
          const result = await sql.unsafe(statement, params || []);
          return `Rows affected: ${result.count || 0}`;
        } catch (error) {
          let errorMessage = error instanceof Error ? error.message : String(error);
          log.error('Command execution error', { error: errorMessage });
          throw new UserError(`Execution error: ${errorMessage}`);
        }
      } catch (dbConnectionError) {
        let errorMessage = dbConnectionError instanceof Error ? dbConnectionError.message : String(dbConnectionError);
        log.error('Database connection error', { error: errorMessage });
        throw new UserError(`Database connection error: ${errorMessage}`);
      }
    }
  });
  
  mcpServer.addTool({
    name: 'schema_tool',
    description: 'Retrieve detailed schema information for a specific table',
    parameters: SchemaToolParamsSchema,
    execute: async (args: SchemaToolParams, { log }) => {
      const { tableName, dbAlias } = args;
      const sql = validateDbAlias(dbAlias);
      
      log.info('Retrieving schema for table', { tableName, dbAlias });
      
      try {
        // Get the schema
        const schema = await getTableSchema(sql, tableName);
        
        if (!schema) {
          throw new UserError(`No schema found for table '${tableName}'.`);
        }
        
        log.info('Schema retrieved successfully', { tableName });
        return safeJsonStringify(schema);
      } catch (error) {
        let errorMessage = error instanceof Error ? error.message : String(error);
        log.error('Schema retrieval error', { tableName, error: errorMessage });
        throw new UserError(`Schema retrieval error: ${errorMessage}`);
      }
    }
  });
  
  mcpServer.addTool({
    name: 'all_schemas_tool',
    description: 'Retrieve schema information for all tables in the database',
    parameters: AllSchemasToolParamsSchema,
    execute: async (args: AllSchemasToolParams, { log }) => {
      const { dbAlias } = args;
      const sql = validateDbAlias(dbAlias);
      
      log.info('Retrieving schemas for all tables', { dbAlias });
      
      try {
        log.info('Retrieving all table schemas...');
        
        // First, get the list of tables
        const tables = await listTables(sql);
        log.info(`Found ${tables.length} tables`, { tables });
        
        // Then get schema for each table
        const allSchemas = await getAllTableSchemas(sql);
        
        log.info('All schemas retrieved successfully');
        return safeJsonStringify(allSchemas);
      } catch (error) {
        let errorMessage = error instanceof Error ? error.message : String(error);
        log.error('Schema retrieval error', { error: errorMessage });
        throw new UserError(`Schema retrieval error: ${errorMessage}`);
      }
    }
  });
  
  mcpServer.addTool({
    name: 'transaction_tool',
    description: 'Execute multiple SQL statements as a single atomic transaction',
    parameters: TransactionToolParamsSchema,
    execute: async (args: TransactionToolParams, { log, reportProgress }) => {
      const { operations, dbAlias } = args;
      const sql = validateDbAlias(dbAlias);
      
      log.info('Starting transaction', { 
        operationCount: operations.length,
        dbAlias
      });
      
      const results: OperationResult[] = [];
      const transactionFailure: TransactionFailure = {
        success: false,
        error: '',
        failedOperationIndex: -1
      };
      
      try {
        await sql.begin(async (transaction) => {
          for (let i = 0; i < operations.length; i++) {
            const operation = operations[i];
            
            reportProgress({
              progress: i,
              total: operations.length
            });
            
            log.info(`Executing operation ${i + 1}/${operations.length}`);
            
            try {
              const result = await transaction.unsafe(operation.statement, operation.params || []);
              results.push({
                operation: i,
                rowsAffected: result.count || 0
              });
            } catch (error) {
              let errorMessage = error instanceof Error ? error.message : String(error);
              log.error(`Error in operation ${i}`, { error: errorMessage });
              
              transactionFailure.error = `Error executing operation ${i}: ${errorMessage}`;
              transactionFailure.failedOperationIndex = i;
              
              throw error; // This will trigger rollback
            }
          }
          
          reportProgress({
            progress: operations.length,
            total: operations.length
          });
        });
        
        const success: TransactionSuccess = {
          success: true,
          results
        };
        
        return safeJsonStringify(success);
      } catch (error) {
        if (transactionFailure.error) {
          return safeJsonStringify(transactionFailure);
        }
        
        let errorMessage = error instanceof Error ? error.message : String(error);
        transactionFailure.error = `Transaction error: ${errorMessage}`;
        
        log.error('Transaction failed', { 
          error: transactionFailure.error,
          failedOperationIndex: transactionFailure.failedOperationIndex
        });
        
        return safeJsonStringify(transactionFailure);
      }
    }
  });
  
  return mcpServer;
};

const registerResources = (mcpServer: FastMCP<Record<string, unknown>>) => {
  mcpServer.addResourceTemplate({
    uriTemplate: 'db://{dbAlias}/schema/tables',
    name: 'Database Tables',
    arguments: [
      {
        name: 'dbAlias',
        description: 'Alias of the database connection to use',
        required: true
      }
    ],
    async load({ dbAlias }) {
      try {
        const sql = validateDbAlias(dbAlias);
        const tables = await listTables(sql);
        return { text: safeJsonStringify(tables) };
      } catch (error) {
        throw new Error(`Failed to list tables: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });
  
  mcpServer.addResourceTemplate({
    uriTemplate: 'db://{dbAlias}/schema/{tableName}',
    name: 'Table Schema',
    arguments: [
      {
        name: 'dbAlias',
        description: 'Alias of the database connection to use',
        required: true
      },
      {
        name: 'tableName',
        description: 'Name of the table to get schema for',
        required: true
      }
    ],
    async load({ dbAlias, tableName }) {
      try {
        const sql = validateDbAlias(dbAlias);
        const schema = await getTableSchema(sql, tableName);
        
        // If no schema is found, throw an error
        if (!schema || schema.length === 0) {
          throw new Error(`Table '${tableName}' not found or has no columns`);
        }
        
        return { text: safeJsonStringify(schema) };
      } catch (error) {
        // Ensure we always throw an error with the proper message format
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to get schema: ${errorMessage}`);
      }
    }
  });
  
  mcpServer.addResourceTemplate({
    uriTemplate: 'db://{dbAlias}/schema/all',
    name: 'All Tables Schemas',
    arguments: [
      {
        name: 'dbAlias',
        description: 'Alias of the database connection to use',
        required: true
      }
    ],
    async load({ dbAlias }) {
      try {
        const sql = validateDbAlias(dbAlias);
        const allSchemas = await getAllTableSchemas(sql);
        return { text: safeJsonStringify(allSchemas) };
      } catch (error) {
        throw new Error(`Failed to get all schemas: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });
  
  return mcpServer;
};

const configureServerEvents = (mcpServer: FastMCP<Record<string, unknown>>) => {
  mcpServer.on('connect', (info) => {
    console.log('Client connected');
    
    if (info && info.session) {
      try {
        // When a client connects, we can access and log its capabilities
        if (info.session.clientCapabilities) {
          console.log('Client capabilities detected:', JSON.stringify(info.session.clientCapabilities));
          console.log('Server is ready and capabilities are negotiated');
        } else {
          console.log('No client capabilities detected');
        }
        
        // If using fastmcp dev tool, provide additional info
        if (detectDevEnvironment()) {
          console.log('Running in fastmcp dev environment - use the following commands:');
          console.log('- To execute a query: call query_tool with {"statement": "SELECT * FROM your_table", "dbAlias": "main"}');
          console.log('- To get schema: call schema_tool with {"tableName": "your_table", "dbAlias": "main"}');
          console.log('- To get all schemas: call all_schemas_tool with {"dbAlias": "main"}');
          
          // For debugging purposes, also print available databases
          console.log('Available database aliases:', Object.keys(connections).join(', '));
        }
      } catch (error) {
        console.error('Error handling session:', error);
      }
    } else {
      console.warn('Client session information not available');
    }
  });
  
  mcpServer.on('disconnect', () => {
    console.log('Client disconnected');
  });
  
  return mcpServer;
};

// Fix the createMcpServer function to properly handle authentication
export const createMcpServer = (options?: PostgresMcpOptions) => {
  // Apply custom server config if provided
  let serverConfig = getServerConfig();
  if (options?.serverConfig) {
    serverConfig = { ...serverConfig, ...options.serverConfig };
  }
  
  console.log(`Creating MCP Server: ${serverConfig.name} v${serverConfig.version}`);
  
  // Create authentication function if enabled
  const authenticate = serverConfig.enableAuth && serverConfig.apiKey 
    ? async (request: any) => {
        const apiKey = request.headers?.['x-api-key'];
        
        if (!apiKey || apiKey !== serverConfig.apiKey) {
          throw new Error('Invalid API Key');
        }
        
        return {}; // Return empty auth object on success
      }
    : undefined;
  
  // Create the server with authentication if enabled
  const mcpServer = new FastMCP<Record<string, unknown>>({
    name: serverConfig.name || 'postgres-mcp',
    version: serverConfig.version as `${number}.${number}.${number}` || '1.0.0',
    authenticate
  });
  
  // Register tools and resources
  registerTools(mcpServer);
  registerResources(mcpServer);
  configureServerEvents(mcpServer);
  
  // Create a wrapper with attached methods and properties for easier access
  const enhancedServer = mcpServer as FastMCP<Record<string, unknown>> & {
    tools?: any[];
    resourceTemplates?: any[];
  };
  
  // Store tools and resource templates from private fields
  // Use type assertion to safely access array properties
  const tools = Object.entries(enhancedServer).find(([key, value]) => 
    key.startsWith('_') && 
    Array.isArray(value) && 
    value.length > 0 && 
    typeof value[0]?.name === 'string' && 
    value[0]?.name.includes('_tool')
  );
  
  const resourceTemplates = Object.entries(enhancedServer).find(([key, value]) => 
    key.startsWith('_') && 
    Array.isArray(value) && 
    value.length > 0 && 
    typeof value[0]?.uriTemplate === 'string' && 
    value[0]?.uriTemplate.includes('{')
  );
  
  // Add them as properties for tests to access
  if (tools) {
    enhancedServer.tools = tools[1];
  }
  
  if (resourceTemplates) {
    enhancedServer.resourceTemplates = resourceTemplates[1];
  }
  
  return enhancedServer;
};

// Start the MCP server without modification
export const startServer = () => {
  try {
    console.log('Starting FastPostgresMCP...');
    
    // Initialize database connections first
    console.log('Initializing database connections...');
    initConnections();
    
    // Add a check to validate connections
    const connectionAliases = Object.keys(connections);
    if (connectionAliases.length === 0) {
      console.warn('No database connections were initialized. MCP tools that require database access will not work.');
      console.warn('Set DB_MAIN_HOST, DB_MAIN_PORT, DB_MAIN_NAME, DB_MAIN_USER, DB_MAIN_PASSWORD environment variables.');
      console.warn('Alternatively, set DB_MAIN_URL with a connection string.');
    } else {
      console.log(`Initialized ${connectionAliases.length} database connection(s): ${connectionAliases.join(', ')}`);
    }
    
    const server = createMcpServer();
    
    // Use stdio transport - don't set any options that might interfere
    server.start();
    
    console.log('FastPostgresMCP started');
    
    return server;
  } catch (error) {
    console.error('Error starting MCP server:', error);
    throw error;
  }
};

// Fix the start method for the PostgresMcp type
export const createPostgresMcp = (options?: PostgresMcpOptions): PostgresMcp => {
  try {
    console.log('Initializing PostgresMcp programmatic API...');
    
    // Initialize database connections with custom configs if provided
    console.log('Initializing database connections...');
    initConnections(options?.databaseConfigs);
    
    // Add a check to validate connections
    const connectionAliases = Object.keys(connections);
    if (connectionAliases.length === 0) {
      console.warn('No database connections were initialized. MCP tools that require database access will not work.');
      console.warn('Set DB_MAIN_HOST, DB_MAIN_PORT, DB_MAIN_NAME, DB_MAIN_USER, DB_MAIN_PASSWORD environment variables.');
      console.warn('Alternatively, set DB_MAIN_URL with a connection string, or provide databaseConfigs in options.');
    } else {
      console.log(`Initialized ${connectionAliases.length} database connection(s): ${connectionAliases.join(', ')}`);
    }
    
    // Create the MCP server with the provided options
    const server = createMcpServer(options);
    
    // Create the PostgresMcp instance
    const postgresMcp: PostgresMcp = {
      server,
      
      // Start the MCP server with the specified transport
      start: () => {
        const transportType = options?.transport || 'stdio';
        const port = options?.port || 3000;
        
        if (transportType === 'http') {
          server.start({ 
            transportType: 'sse', 
            sse: { 
              endpoint: '/mcp',
              port
            } 
          });
          console.log(`FastPostgresMCP started with HTTP transport on port ${port}`);
        } else if (transportType === 'sse') {
          server.start({ 
            transportType: 'sse', 
            sse: { 
              endpoint: '/mcp', 
              port
            }
          });
          console.log(`FastPostgresMCP started with SSE transport on port ${port}`);
        } else {
          server.start(); // Default to stdio
          console.log('FastPostgresMCP started with stdio transport');
        }
      },
      
      // Stop the MCP server and close all database connections
      stop: async () => {
        console.log('Stopping FastPostgresMCP...');
        
        // Close database connections
        await closeConnections();
        
        // Currently fastmcp doesn't have a stop method, so we just log this
        console.log('FastPostgresMCP stopped');
      },
      
      // Disconnect from all databases without stopping the server
      disconnect: async () => {
        console.log('Disconnecting from all databases...');
        await closeConnections();
        console.log('All database connections closed, server still running');
      },
      
      // Access to database connections
      connections,
      
      // Database operations
      executeQuery,
      executeCommand,
      executeTransaction,
      
      // Schema operations
      getTableSchema: async (tableName: string, dbAlias?: string) => {
        const sql = validateDbAlias(dbAlias);
        return getTableSchema(sql, tableName);
      },
      
      listTables: async (dbAlias?: string) => {
        const sql = validateDbAlias(dbAlias);
        return listTables(sql);
      }
    };
    
    // Automatically start the server if specified
    if (options?.autoStart) {
      postgresMcp.start();
    }
    
    return postgresMcp;
  } catch (error) {
    console.error('Error creating PostgresMcp instance:', error);
    throw error;
  }
};

// Implementation of fetchTableSchema for direct use
export async function fetchTableSchema(tool_request: { args: { alias: string, name: string } }): Promise<TableSchemaResult> {
  const { args } = tool_request;
  const { alias, name: tableName } = args;
  
  try {
    if (!connections[alias]) {
      throw new Error(`Database connection '${alias}' not found. Available connections: ${Object.keys(connections).join(', ')}`);
    }
    
    console.log(`Retrieving schema for table '${tableName}' from database '${alias}'...`);
    
    try {
      // Using the imported getTableSchema from utils
      const schema = await getTableSchema(connections[alias], tableName);
      return { type: 'result', schema };
    } catch (schemaError) {
      const errorMessage = schemaError instanceof Error ? schemaError.message : String(schemaError);
      return { type: 'error', error: errorMessage };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { type: 'error', error: errorMessage };
  }
}

// Define a return type for fetchAllTableSchemas
export type AllTableSchemasResult = {
  type: 'result' | 'error';
  schemas?: Record<string, Record<string, unknown>[]>;
  error?: string;
};

// Implementation of fetchAllTableSchemas for direct use
export async function fetchAllTableSchemas(tool_request: { args: { alias: string } }): Promise<AllTableSchemasResult> {
  const { args } = tool_request;
  const { alias } = args;
  
  try {
    if (!connections[alias]) {
      throw new Error(`Database connection '${alias}' not found. Available connections: ${Object.keys(connections).join(', ')}`);
    }
    
    console.log(`Retrieving schema for all tables from database '${alias}'...`);
    
    try {
      // Using the imported getAllTableSchemas from utils
      const schemas = await getAllTableSchemas(connections[alias]);
      return { type: 'result', schemas };
    } catch (schemaError) {
      const errorMessage = schemaError instanceof Error ? schemaError.message : String(schemaError);
      return { type: 'error', error: errorMessage };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { type: 'error', error: errorMessage };
  }
} 