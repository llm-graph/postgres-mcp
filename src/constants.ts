import { DatabaseConfig, DatabaseConnections, ServerConfig } from './types';

export const DEFAULT_SERVER_CONFIG: ServerConfig = {
  name: 'FastPostgresMCP',
  version: '1.0.0',
  defaultDbAlias: 'main',
  enableAuth: false
};

export const loadDbAliases = (): string[] => {
  const aliases = process.env['DB_ALIASES'];
  return aliases ? aliases.split(',').map(alias => alias.trim()) : ['main'];
};

export const loadDefaultDbAlias = (): string => {
  return process.env['DEFAULT_DB_ALIAS'] || 'main';
};

export const loadEnableAuth = (): boolean => {
  const enableAuth = process.env['ENABLE_AUTH'];
  return enableAuth === 'true' || enableAuth === '1';
};

export const loadApiKey = (): string | undefined => {
  return process.env['MCP_API_KEY'];
};

export const createDbConfigFromEnv = (alias: string): DatabaseConfig => {
  const upperAlias = alias.toUpperCase();
  
  const url = process.env[`DB_${upperAlias}_URL`];
  if (url) {
    try {
      const dbUrl = new URL(url);
      const userPass = dbUrl.username && dbUrl.password ? 
        `${dbUrl.username}:${dbUrl.password}` : '';
      
      // Extract database name from pathname (remove leading slash)
      const dbName = dbUrl.pathname.substring(1);
      
      // Parse SSL mode from query parameters
      const params = new URLSearchParams(dbUrl.search);
      const sslMode = params.get('sslmode');
      
      return {
        host: dbUrl.hostname,
        port: parseInt(dbUrl.port || '5432', 10),
        database: dbName,
        user: decodeURIComponent(dbUrl.username || ''),
        password: decodeURIComponent(dbUrl.password || ''),
        ssl: sslMode || undefined
      };
    } catch (error) {
      console.error(`Invalid database URL for ${alias}:`, error);
      // Fall back to individual env vars
    }
  }
  
  return {
    host: process.env[`DB_${upperAlias}_HOST`] || 'localhost',
    port: parseInt(process.env[`DB_${upperAlias}_PORT`] || '5432', 10),
    database: process.env[`DB_${upperAlias}_NAME`] || 'postgres',
    user: process.env[`DB_${upperAlias}_USER`] || 'postgres',
    password: process.env[`DB_${upperAlias}_PASSWORD`] || '',
    ssl: process.env[`DB_${upperAlias}_SSL`]
  };
};

export const loadDatabaseConnections = (): DatabaseConnections => {
  const aliases = loadDbAliases();
  return aliases.reduce<DatabaseConnections>((configs, alias) => {
    configs[alias] = createDbConfigFromEnv(alias);
    return configs;
  }, {});
};

export const getServerConfig = (): ServerConfig => ({
  ...DEFAULT_SERVER_CONFIG,
  defaultDbAlias: loadDefaultDbAlias(),
  enableAuth: loadEnableAuth(),
  apiKey: loadApiKey()
}); 