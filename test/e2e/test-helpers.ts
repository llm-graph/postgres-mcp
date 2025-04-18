import { sleep } from 'bun';
import postgres from 'postgres';
import { TestResources, cleanupTestDb } from '../unit/test-db-utils';

export const retryDatabaseOperation = async <T>(
  operation: () => Promise<T>,
  retries = 3,
  delay = 2000
): Promise<T> => {
  let lastError: unknown;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        console.log(`Database operation failed, retrying (${attempt}/${retries})...`);
        await sleep(delay);
      }
    }
  }
  
  throw lastError;
};

const globalTestResources: TestResources[] = [];

export const registerTestResources = (resources: TestResources): number => {
  globalTestResources.push(resources);
  return globalTestResources.length - 1;
};

export const performCleanup = async (resources: TestResources): Promise<void> => {
  if (resources.isCleanedUp) {
    return;
  }
  
  console.log('┌─────────────────────────────────────────────────┐');
  console.log('│ Running test cleanup                            │');
  console.log('└─────────────────────────────────────────────────┘');
  
  try {
    if (resources.sql) {
      console.log('Closing database connection...');
      await Promise.race([
        resources.sql.end(),
        new Promise(resolve => setTimeout(() => {
          console.log('Database connection close timeout reached, continuing...');
          resolve(null);
        }, 3000))
      ]);
      resources.sql = undefined;
    }
    
    if (resources.useDockerDb) {
      if (resources.originalDbAlias) {
        process.env['DEFAULT_DB_ALIAS'] = resources.originalDbAlias;
      } else {
        delete process.env['DEFAULT_DB_ALIAS'];
      }
      
      await cleanupTestDb();
    }
    
    resources.isCleanedUp = true;
    console.log('Cleanup completed successfully.');
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
};

export const cleanupAllResources = async (): Promise<void> => {
  console.log(`Cleaning up all ${globalTestResources.length} registered test resources`);
  
  for (const resources of globalTestResources) {
    if (!resources.isCleanedUp) {
      await performCleanup(resources);
    }
  }
  
  globalTestResources.length = 0;
};

export const setupSignalHandlers = (): void => {
  let handlerInstalled = false;
  
  if (!handlerInstalled) {
    process.on('SIGINT', async () => {
      console.log('\nSIGINT received, cleaning up test resources...');
      await cleanupAllResources();
      process.exit(1);
    });
    
    process.on('SIGTERM', async () => {
      console.log('\nSIGTERM received, cleaning up test resources...');
      await cleanupAllResources();
      process.exit(1);
    });
    
    process.on('beforeExit', async () => {
      console.log('Process about to exit, cleaning up test resources...');
      await cleanupAllResources();
    });
    
    handlerInstalled = true;
  }
}; 