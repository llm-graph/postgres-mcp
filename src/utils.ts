import postgres from 'postgres';
import { DatabaseConfig, DatabaseConnections } from './types';

export const createPostgresClient = (config: DatabaseConfig): postgres.Sql<{}> => {
  const { host, port, database, user, password, ssl } = config;
  
  try {
    console.log(`Creating Postgres client for ${host}:${port}/${database} with user ${user}`);
    
    const sslConfig = ssl ? {
      ssl: ssl === 'disable' ? false : 
           ssl === 'require' ? { rejectUnauthorized: false } :
           ssl === 'verify-ca' || ssl === 'verify-full' ? { rejectUnauthorized: true } :
           { rejectUnauthorized: false } // Default to 'prefer' behavior
    } : {};
    
    if (!host) {
      throw new Error('Database host is required but was not provided');
    }
    
    if (!database) {
      throw new Error('Database name is required but was not provided');
    }
    
    return postgres({
      host,
      port,
      database,
      user,
      password,
      ...sslConfig,
      max: 10,
      idle_timeout: 30,
      connection: {
        application_name: 'postgres-mcp'
      },
      onnotice: (notice) => {
        console.log(`[PostgreSQL Notice] ${notice['message']}`);
      },
      onparameter: (key, value) => {
        console.log(`[PostgreSQL Parameter] ${key}=${value}`);
      }
    });
  } catch (error) {
    console.error('Error creating Postgres client:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    if (!errorMessage || errorMessage.trim() === '') {
      throw new Error(`Failed to create database client for ${host}:${port}/${database}. Check connection parameters.`);
    }
    
    // Improve the error message based on the error
    if (errorMessage.includes('ECONNREFUSED')) {
      throw new Error(`Connection refused to ${host}:${port}. Make sure PostgreSQL is running and accessible.`);
    } else if (errorMessage.includes('authentication')) {
      throw new Error(`Authentication failed for user ${user}. Check username and password.`);
    } else if (errorMessage.includes('does not exist')) {
      throw new Error(`Database ${database} does not exist. Check the database name.`);
    } else {
      throw new Error(`Database connection error: ${errorMessage}`);
    }
  }
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
    console.error(`Database connection for alias '${alias}' not found. Available aliases: ${Object.keys(connections).join(', ')}`);
    throw new Error(`Database connection for alias '${alias}' not found. Check your .env configuration.`);
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
  try {
    // First check if the table exists
    const tableExists = await sql`
      SELECT EXISTS (
        SELECT 1 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_name = ${tableName}
      ) as exists
    `;
    
    if (!tableExists || !tableExists[0] || !tableExists[0]['exists']) {
      throw new Error(`Table '${tableName}' does not exist in the database.`);
    }
    
    // Then get the schema if table exists
    const schema = await sql`
      SELECT 
        column_name, 
        data_type, 
        is_nullable, 
        column_default,
        ordinal_position
      FROM 
        information_schema.columns
      WHERE 
        table_schema = 'public' 
        AND table_name = ${tableName}
      ORDER BY 
        ordinal_position
    `;
    
    if (schema.length === 0) {
      throw new Error(`No columns found for table '${tableName}'.`);
    }
    
    return schema;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error retrieving schema for table '${tableName}':`, error);
    
    // Handle empty error messages by providing a default message
    if (!errorMessage || errorMessage.trim() === '') {
      console.error('Empty error message received, using generic error');
      throw new Error(`Failed to retrieve schema for '${tableName}': Database connection error or permission issue`);
    }
    
    // Use a more detailed error message that includes the original error
    if (errorMessage.includes('permission denied') || errorMessage.includes('access denied')) {
      throw new Error(`Permission denied accessing table '${tableName}': ${errorMessage}`);
    } else if (errorMessage.includes('connection')) {
      throw new Error(`Database connection error while retrieving schema for '${tableName}': ${errorMessage}`);
    } else {
      throw new Error(`Failed to retrieve schema for '${tableName}': ${errorMessage}`);
    }
  }
};

export const getAllTableSchemas = async (sql: postgres.Sql<{}>): Promise<Record<string, Record<string, unknown>[]>> => {
  try {
    const tables = await listTables(sql);
    
    if (tables.length === 0) {
      return {};
    }
    
    const schemas: Record<string, Record<string, unknown>[]> = {};
    
    for (const tableName of tables) {
      try {
        schemas[tableName] = await getTableSchema(sql, tableName);
      } catch (error) {
        // Log errors but continue with other tables
        console.error(`Error retrieving schema for table '${tableName}':`, error);
        schemas[tableName] = [];
      }
    }
    
    return schemas;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error retrieving all table schemas:`, error);
    
    // Handle empty error messages by providing a default message
    if (!errorMessage || errorMessage.trim() === '') {
      throw new Error(`Failed to retrieve all table schemas: Database connection error or permission issue`);
    }
    
    // Use a more detailed error message that includes the original error
    if (errorMessage.includes('permission denied') || errorMessage.includes('access denied')) {
      throw new Error(`Permission denied accessing tables: ${errorMessage}`);
    } else if (errorMessage.includes('connection')) {
      throw new Error(`Database connection error while retrieving schemas: ${errorMessage}`);
    } else {
      throw new Error(`Failed to retrieve all table schemas: ${errorMessage}`);
    }
  }
};

export const detectDevEnvironment = (): boolean => {
  return process.argv.some(arg => 
    arg.includes('dev') || 
    arg.includes('inspect') || 
    arg.includes('fastmcp')
  );
};

export const startCliProcess = (): void => {
  import('child_process').then(({ spawn }) => {
    import('dotenv').then((dotenv) => {
      import('path').then(({ join }) => {
        const result = dotenv.config({ path: join(process.cwd(), '.env') });
        
        if (result.error) {
          console.error('Error loading .env file:', result.error);
          console.error('Make sure .env file exists in project root and has correct format');
        } else {
          console.log('Environment variables loaded from .env file');
          
          console.log('Essential environment variables:');
          console.log('DB_MAIN_HOST:', process.env['DB_MAIN_HOST'] || '(not set)');
          console.log('DB_MAIN_NAME:', process.env['DB_MAIN_NAME'] || '(not set)');
        }
        
        console.log('Starting MCP dev environment...');
        
        const mcpProcess = spawn('bunx', ['fastmcp', 'dev', 'src/index.ts'], {
          stdio: 'inherit',
          shell: true,
          env: process.env
        });
        
        mcpProcess.on('exit', (code) => {
          if (code !== 0) {
            console.error(`fastmcp exited with code ${code}`);
          }
          process.exit(code);
        });
        
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
      });
    });
  });
};

export const runCli = (): void => {
  import('./core').then(({ startServer }) => {
    startServer();
    
    process.stdin.resume();
    
    process.on('SIGINT', () => {
      console.log('Shutting down MCP server...');
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      console.log('Shutting down MCP server...');
      process.exit(0);
    });
  });
}; 