import { z } from 'zod';

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