import { config } from 'dotenv';
import type { DatabaseConfig, DatabaseConnections, ServerConfig } from './types';

// Load environment variables from .env file
config();

console.log('Environment variables loaded from .env file');

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
  
  // Log which environment variables we're looking for
  console.log(`Looking for database configuration for alias '${alias}'...`);
  console.log(`Checking for DB_${upperAlias}_URL or individual environment variables`);
  
  const url = process.env[`DB_${upperAlias}_URL`];
  if (url) {
    try {
      console.log(`Found DB_${upperAlias}_URL, parsing connection string`);
      const dbUrl = new URL(url);
      
      // Extract database name from pathname (remove leading slash)
      const dbName = dbUrl.pathname.substring(1);
      
      // Parse SSL mode from query parameters
      const params = new URLSearchParams(dbUrl.search);
      const sslMode = params.get('sslmode');
      
      const config = {
        host: dbUrl.hostname,
        port: parseInt(dbUrl.port || '5432', 10),
        database: dbName,
        user: decodeURIComponent(dbUrl.username || ''),
        password: decodeURIComponent(dbUrl.password || '') ? '********' : '', // Hide actual password
        ssl: sslMode || undefined
      };
      
      console.log(`Configured '${alias}' database connection from URL:`);
      console.log(`  Host: ${config.host}`);
      console.log(`  Port: ${config.port}`);
      console.log(`  Database: ${config.database}`);
      console.log(`  User: ${config.user}`);
      console.log(`  SSL: ${config.ssl || 'not specified'}`);
      
      // Return the actual config with real password
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
      console.error(`URL format should be: postgresql://user:password@host:port/database?sslmode=prefer`);
      console.log(`Falling back to individual environment variables`);
      // Fall back to individual env vars
    }
  }
  
  // If we get here, we're using individual env vars
  const host = process.env[`DB_${upperAlias}_HOST`] || 'localhost';
  const port = parseInt(process.env[`DB_${upperAlias}_PORT`] || '5432', 10);
  const database = process.env[`DB_${upperAlias}_NAME`] || 'postgres';
  const user = process.env[`DB_${upperAlias}_USER`] || 'postgres';
  const password = process.env[`DB_${upperAlias}_PASSWORD`] || '';
  const ssl = process.env[`DB_${upperAlias}_SSL`];
  
  console.log(`Configured '${alias}' database connection from environment variables:`);
  console.log(`  Host: ${host} (from DB_${upperAlias}_HOST or default)`);
  console.log(`  Port: ${port} (from DB_${upperAlias}_PORT or default)`);
  console.log(`  Database: ${database} (from DB_${upperAlias}_NAME or default)`);
  console.log(`  User: ${user} (from DB_${upperAlias}_USER or default)`);
  console.log(`  Password: ${password ? '********' : 'not set'} (from DB_${upperAlias}_PASSWORD)`);
  console.log(`  SSL: ${ssl || 'not specified'} (from DB_${upperAlias}_SSL)`);
  
  return {
    host,
    port,
    database,
    user,
    password,
    ssl
  };
};

// Improve validation of environment variables
export const validateEnvVars = (): boolean => {
  let isValid = true;
  const missingVars = [];
  const mainConnectionVars = [
    'DB_MAIN_URL',
    ['DB_MAIN_HOST', 'DB_MAIN_PORT', 'DB_MAIN_NAME', 'DB_MAIN_USER', 'DB_MAIN_PASSWORD']
  ];
  
  console.log('Validating database environment variables...');
  console.log('Environment variables received:');
  console.log('DB_MAIN_HOST:', process.env['DB_MAIN_HOST'] || '(not set)');
  console.log('DB_MAIN_PORT:', process.env['DB_MAIN_PORT'] || '(not set)');
  console.log('DB_MAIN_NAME:', process.env['DB_MAIN_NAME'] || '(not set)');
  console.log('DB_MAIN_USER:', process.env['DB_MAIN_USER'] || '(not set)');
  console.log('DB_MAIN_PASSWORD:', process.env['DB_MAIN_PASSWORD'] ? '(set)' : '(not set)');
  console.log('DB_MAIN_SSL:', process.env['DB_MAIN_SSL'] || '(not set)');
  console.log('DB_MAIN_URL:', process.env['DB_MAIN_URL'] || '(not set)');
  
  // Check for URL-based connection string
  if (!process.env['DB_MAIN_URL']) {
    console.log('No DB_MAIN_URL found, checking for individual connection parameters...');
    
    // Check for individual connection parameters
    const individualVars = mainConnectionVars[1] as string[];
    const missing = individualVars.filter(varName => !process.env[varName]);
    
    if (missing.length > 0) {
      console.log(`Missing recommended environment variables: ${missing.join(', ')}`);
      missingVars.push(...missing);
      
      // Mark as invalid if required fields are missing
      if (!process.env['DB_MAIN_HOST']) {
        console.error('DB_MAIN_HOST is required but not provided or is empty');
        isValid = false;
      }
      
      if (!process.env['DB_MAIN_NAME']) {
        console.error('DB_MAIN_NAME is required but not provided or is empty');
        isValid = false;
      }
    }
  } else {
    console.log('Found DB_MAIN_URL environment variable');
    
    // Validate URL format
    try {
      new URL(process.env['DB_MAIN_URL'] as string);
    } catch (error) {
      console.error('Invalid DB_MAIN_URL format:', error);
      console.error('Expected format: postgresql://user:password@host:port/database?sslmode=prefer');
      isValid = false;
    }
  }
  
  // Fix default settings if not critical variables are missing
  if (isValid) {
    // If host and database are provided but other variables are missing, we can still proceed
    if (process.env['DB_MAIN_HOST'] && process.env['DB_MAIN_NAME']) {
      console.log('Environment variable validation passed with essential variables');
      
      // Automatically provide defaults for missing non-critical variables
      if (!process.env['DB_MAIN_PORT']) {
        process.env['DB_MAIN_PORT'] = '5432'; // Default PostgreSQL port
        console.log('Using default PostgreSQL port: 5432');
      }
      
      if (!process.env['DB_MAIN_USER']) {
        process.env['DB_MAIN_USER'] = 'postgres'; // Default PostgreSQL user
        console.log('Using default PostgreSQL user: postgres');
      }
    }
  }
  
  // Report validation results
  if (isValid) {
    console.log('Environment variable validation passed');
    if (missingVars.length > 0) {
      console.log(`Note: Using default values for: ${missingVars.join(', ')}`);
    }
  } else {
    console.error('Environment variable validation FAILED');
    console.error('Database connection will likely fail without proper configuration');
    console.error('Make sure your .env file exists and contains the necessary variables.');
  }
  
  return isValid;
};

// Update loadDatabaseConnections to call validateEnvVars
export const loadDatabaseConnections = (): DatabaseConnections => {
  // Validate environment variables first
  validateEnvVars();
  
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