import { FastMCP, UserError, } from 'fastmcp';
import postgres from 'postgres';
import { 
  QueryToolParams, QueryToolParamsSchema,
  ExecuteToolParams, ExecuteToolParamsSchema,
  SchemaToolParams, SchemaToolParamsSchema,
  TransactionToolParams, TransactionToolParamsSchema,
  TransactionSuccess, TransactionFailure,
  OperationResult, DatabaseConfig,
  Operation
} from './types';
import { 
  getDbClient, initializeDbConnections, 
  safeJsonStringify, listTables as fetchTables,
  getTableSchema as fetchTableSchema
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
      connections[alias] = postgres({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        ssl: config.ssl === 'disable' ? false : undefined,
        max: 10,
        idle_timeout: 30
      });
    } catch (error) {
      console.error(`Failed to initialize database connection for ${alias}:`, error);
    }
  });
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
    // Transaction was rolled back
    if (!transactionFailure.error) {
      transactionFailure.error = error instanceof Error ? error.message : String(error);
    }
    return safeJsonStringify(transactionFailure);
  }
}

export const createMcpServer = () => {
  const serverConfig = getServerConfig();
  const dbConfigs = loadDatabaseConnections();
  const dbConnections = initializeDbConnections(dbConfigs);
  
  const server = new FastMCP<Record<string, unknown>>({
    name: serverConfig.name,
    version: '1.0.0',
    authenticate: serverConfig.enableAuth ? (requestInfo) => {
      const apiKey = requestInfo.headers?.['x-api-key'] as string | undefined;
      if (apiKey !== serverConfig.apiKey) {
        throw new Response(null, {
          status: 401,
          statusText: 'Unauthorized: Invalid API Key'
        });
      }
      return Promise.resolve({}); 
    } : undefined
  });
  
  const registerTools = (mcpServer: FastMCP<Record<string, unknown>>) => {
    mcpServer.addTool({
      name: 'query_tool',
      description: 'Safely execute a read-only SQL query and retrieve results',
      parameters: QueryToolParamsSchema,
      execute: async (args: QueryToolParams, { log }) => {
        const { statement, params, dbAlias } = args;
        
        log.info('Executing read-only query', { dbAlias: dbAlias || serverConfig.defaultDbAlias });
        
        const sql = getDbClient(dbConnections, dbAlias, serverConfig.defaultDbAlias);
        
        try {
          const result = await sql.unsafe(statement, params);
          return safeJsonStringify(result);
        } catch (error) {
          throw new UserError(`Query error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    });
    
    mcpServer.addTool({
      name: 'execute_tool',
      description: 'Safely execute a data-modifying SQL statement',
      parameters: ExecuteToolParamsSchema,
      execute: async (args: ExecuteToolParams, { log }) => {
        const { statement, params, dbAlias } = args;
        
        log.info('Executing data-modifying statement', { dbAlias: dbAlias || serverConfig.defaultDbAlias });
        
        const sql = getDbClient(dbConnections, dbAlias, serverConfig.defaultDbAlias);
        
        try {
          const result = await sql.unsafe(statement, params);
          return `Rows affected: ${result.count || 0}`;
        } catch (error) {
          throw new UserError(`Execution error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    });
    
    mcpServer.addTool({
      name: 'schema_tool',
      description: 'Retrieve detailed schema information for a specific table',
      parameters: SchemaToolParamsSchema,
      execute: async (args: SchemaToolParams, { log }) => {
        const { tableName, dbAlias } = args;
        
        log.info('Retrieving schema for table', { tableName, dbAlias: dbAlias || serverConfig.defaultDbAlias });
        
        const sql = getDbClient(dbConnections, dbAlias, serverConfig.defaultDbAlias);
        
        try {
          const schema = await fetchTableSchema(sql, tableName);
          return safeJsonStringify(schema);
        } catch (error) {
          throw new UserError(`Schema retrieval error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    });
    
    mcpServer.addTool({
      name: 'transaction_tool',
      description: 'Execute multiple SQL statements as a single atomic transaction',
      parameters: TransactionToolParamsSchema,
      execute: async (args: TransactionToolParams, { log, reportProgress }) => {
        const { operations, dbAlias } = args;
        
        log.info('Starting transaction', { 
          operationCount: operations.length,
          dbAlias: dbAlias || serverConfig.defaultDbAlias
        });
        
        const sql = getDbClient(dbConnections, dbAlias, serverConfig.defaultDbAlias);
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
                const result = await transaction.unsafe(operation.statement, operation.params);
                results.push({
                  operation: i,
                  rowsAffected: result.count || 0
                });
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
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
          const errorMessage = error instanceof Error ? error.message : String(error);
          
          if (typeof errorMessage === 'string' && errorMessage.startsWith('{')) {
            return errorMessage;
          }
          
          if (!transactionFailure.error) {
            transactionFailure.error = `Transaction error: ${errorMessage}`;
          }
          
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
          const sql = getDbClient(dbConnections, dbAlias, serverConfig.defaultDbAlias);
          const tables = await fetchTables(sql);
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
          const sql = getDbClient(dbConnections, dbAlias, serverConfig.defaultDbAlias);
          const schema = await fetchTableSchema(sql, tableName);
          return { text: safeJsonStringify(schema) };
        } catch (error) {
          throw new Error(`Failed to get schema: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    });
    
    return mcpServer;
  };
  
  const configureServerEvents = (mcpServer: FastMCP<Record<string, unknown>>) => {
    mcpServer.on('connect', () => {
      console.log('Client connected');
    });
    
    mcpServer.on('disconnect', () => {
      console.log('Client disconnected');
    });
    
    return mcpServer;
  };
  
  const configuredServer = configureServerEvents(registerResources(registerTools(server)));
  
  // Expose tools and resource templates for testing
  const enhancedServer = configuredServer as any;
  
  // Store tools and resource templates from private fields
  // Use type assertion to safely access array properties
  const tools = Object.entries(configuredServer).find(([key, value]) => 
    key.startsWith('_') && 
    Array.isArray(value) && 
    value.length > 0 && 
    typeof value[0]?.name === 'string' && 
    value[0]?.name.includes('_tool')
  );
  
  const resourceTemplates = Object.entries(configuredServer).find(([key, value]) => 
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

export const startServer = () => {
  const server = createMcpServer();
  
  server.start({
    transportType: 'stdio',
  });
  
  console.log('FastPostgresMCP started');
  
  return server;
}; 