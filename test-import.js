// Import from the built module
import { createPostgresMcp } from './dist/index.js';

console.log('Successfully imported createPostgresMcp');
console.log('Type:', typeof createPostgresMcp);

// Create a PostgresMcp instance
const postgresMcp = createPostgresMcp({
  databaseConfigs: {
    test: {
      host: 'localhost',
      port: 5432,
      database: 'test',
      user: 'test',
      password: 'test'
    }
  },
  autoStart: false
});

console.log('Successfully created PostgresMcp instance');
console.log('Instance methods:', Object.keys(postgresMcp)); 