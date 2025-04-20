import { z } from 'zod';
import { FastMCP } from 'fastmcp';

export type DatabaseConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: string;
};

export type DatabaseConnections = Record<string, DatabaseConfig>;

export type ServerConfig = {
  name: string;
  version: string;
  defaultDbAlias: string;
  enableAuth: boolean;
  apiKey?: string;
};

export type PostgresCapabilities = {
  features: Array<'query' | 'execute' | 'schema' | 'transaction'>;
  dbAliases: string[];
};

export type ServerCapabilities = {
  postgres: PostgresCapabilities;
};

// New type for programmatic API configuration
export type PostgresMcpOptions = {
  // Optional custom database configurations
  databaseConfigs?: Record<string, DatabaseConfig>;
  // Optional server configuration override
  serverConfig?: Partial<ServerConfig>;
  // Whether to start the server immediately (default: false when used programmatically)
  autoStart?: boolean;
  // Transport options for the MCP server
  transport?: 'stdio' | 'sse' | 'http';
  // Port for http/sse transports
  port?: number;
};

// Type for the PostgresMcp instance returned by createPostgresMcp
export type PostgresMcp = {
  // The underlying FastMCP server instance
  server: FastMCP<Record<string, unknown>>;
  // Start the MCP server
  start: () => void;
  // Stop the MCP server and close database connections
  stop: () => Promise<void>;
  // Disconnect from all databases without stopping the server
  disconnect: () => Promise<void>;
  // Access the database connections
  connections: Record<string, any>;
  // Execute a SQL query on a specific database
  executeQuery: (statement: string, params?: any[], dbAlias?: string) => Promise<string>;
  // Execute a SQL command on a specific database
  executeCommand: (statement: string, params?: any[], dbAlias?: string) => Promise<string>;
  // Execute a transaction on a specific database
  executeTransaction: (operations: Operation[], dbAlias?: string) => Promise<string>;
  // Get schema for a specific table
  getTableSchema: (tableName: string, dbAlias?: string) => Promise<any>;
  // Get all tables in a database
  listTables: (dbAlias?: string) => Promise<string[]>;
};

export const QueryToolParamsSchema = z.object({
  statement: z.string(),
  params: z.array(z.any()).optional().default([]),
  dbAlias: z.string().optional()
});

export type QueryToolParams = z.infer<typeof QueryToolParamsSchema>;

export const ExecuteToolParamsSchema = z.object({
  statement: z.string(),
  params: z.array(z.any()).optional().default([]),
  dbAlias: z.string().optional()
});

export type ExecuteToolParams = z.infer<typeof ExecuteToolParamsSchema>;

export const SchemaToolParamsSchema = z.object({
  tableName: z.string(),
  dbAlias: z.string().optional()
});

export type SchemaToolParams = z.infer<typeof SchemaToolParamsSchema>;

export const AllSchemasToolParamsSchema = z.object({
  dbAlias: z.string().optional()
});

export type AllSchemasToolParams = z.infer<typeof AllSchemasToolParamsSchema>;

export const Operation = z.object({
  statement: z.string(),
  params: z.array(z.any()).optional().default([])
});

export type Operation = z.infer<typeof Operation>;

export const TransactionToolParamsSchema = z.object({
  operations: z.array(Operation),
  dbAlias: z.string().optional()
});

export type TransactionToolParams = z.infer<typeof TransactionToolParamsSchema>;

export type OperationResult = {
  operation: number;
  rowsAffected: number;
};

export type TransactionSuccess = {
  success: true;
  results: OperationResult[];
};

export type TransactionFailure = {
  success: false;
  error: string;
  failedOperationIndex: number;
};

export type TransactionResult = TransactionSuccess | TransactionFailure;

// Type for the result returned by fetchTableSchema
export type TableSchemaResult = {
  type: 'result' | 'error';
  schema?: Record<string, unknown>[];
  error?: string;
};

// Type for the result returned by fetchAllTableSchemas
export type AllTableSchemasResult = {
  type: 'result' | 'error';
  schemas?: Record<string, Record<string, unknown>[]>;
  error?: string;
}; 