import postgres from 'postgres';
import { DatabaseConfig, DatabaseConnections } from './types';

export const createPostgresClient = (config: DatabaseConfig): postgres.Sql<{}> => {
  const { host, port, database, user, password, ssl } = config;
  
  const sslConfig = ssl ? {
    ssl: ssl === 'disable' ? false : { rejectUnauthorized: ssl !== 'require' }
  } : {};
  
  return postgres({
    host,
    port,
    database,
    user,
    password,
    ...sslConfig,
    max: 10,
    idle_timeout: 30
  });
};

export const initializeDbConnections = (configs: DatabaseConnections): Record<string, postgres.Sql<{}>> => {
  return Object.entries(configs).reduce<Record<string, postgres.Sql<{}>>>((connections, [alias, config]) => {
    try {
      connections[alias] = createPostgresClient(config);
    } catch (error) {
      console.error(`Failed to initialize database connection for alias '${alias}':`, error);
    }
    return connections;
  }, {});
};

export const getDbClient = (
  connections: Record<string, postgres.Sql<{}>>,
  dbAlias: string | undefined,
  defaultAlias: string
): postgres.Sql<{}> => {
  const alias = dbAlias || defaultAlias;
  const sql = connections[alias];
  
  if (!sql) {
    throw new Error(`Database connection for alias '${alias}' not found`);
  }
  
  return sql;
};

export const safeJsonStringify = (data: unknown): string => {
  try {
    return JSON.stringify(data);
  } catch (error) {
    return '[]';
  }
};

export const listTables = async (sql: postgres.Sql<{}>): Promise<string[]> => {
  const tables = await sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;
  
  return tables.map(row => row['table_name']);
};

export const getTableSchema = async (sql: postgres.Sql<{}>, tableName: string): Promise<Record<string, unknown>[]> => {
  const schema = await sql`
    SELECT 
      column_name, 
      data_type, 
      is_nullable, 
      column_default
    FROM 
      information_schema.columns
    WHERE 
      table_schema = 'public' 
      AND table_name = ${tableName}
    ORDER BY 
      ordinal_position
  `;
  
  return schema;
}; 