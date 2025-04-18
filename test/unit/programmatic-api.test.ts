// Set environment to test mode to prevent actual connection attempts
process.env['BUN_ENV'] = 'test';

import { test, expect, mock } from 'bun:test';
import { createPostgresMcp } from '../../src/core';

// Mock the database connections and methods
const mockExecuteQuery = mock(() => Promise.resolve(JSON.stringify([{ id: 1, name: 'test' }])));
const mockExecuteCommand = mock(() => Promise.resolve('Rows affected: 1'));
const mockExecuteTransaction = mock(() => Promise.resolve(JSON.stringify({ success: true, results: [] })));
const mockListTables = mock(() => Promise.resolve(['users', 'posts']));
const mockGetTableSchema = mock(() => Promise.resolve([{ column_name: 'id', data_type: 'integer' }]));
const mockClose = mock(() => Promise.resolve());

// Mock FastMCP
mock.module('fastmcp', () => {
  return {
    FastMCP: class MockFastMCP {
      constructor() {}
      addTool() { return this; }
      addResourceTemplate() { return this; }
      on() { return this; }
      start() { return this; }
    },
    UserError: class MockUserError extends Error {}
  };
});

// Mock postgres
mock.module('postgres', () => {
  return () => ({
    unsafe: () => Promise.resolve([{ id: 1, name: 'test' }]),
    end: () => Promise.resolve()
  });
});

// Test the programmatic API
test('createPostgresMcp creates a valid instance', () => {
  const postgresMcp = createPostgresMcp({
    databaseConfigs: {
      test: {
        host: 'localhost',
        port: 5432,
        database: 'test',
        user: 'test',
        password: 'test',
        ssl: 'disable'
      }
    }
  });
  
  expect(postgresMcp).toBeDefined();
  expect(typeof postgresMcp.start).toBe('function');
  expect(typeof postgresMcp.stop).toBe('function');
  expect(typeof postgresMcp.executeQuery).toBe('function');
  expect(typeof postgresMcp.executeCommand).toBe('function');
  expect(typeof postgresMcp.executeTransaction).toBe('function');
  expect(typeof postgresMcp.getTableSchema).toBe('function');
  expect(typeof postgresMcp.listTables).toBe('function');
});

// Test the custom configuration options
test('createPostgresMcp accepts custom options', () => {
  const postgresMcp = createPostgresMcp({
    databaseConfigs: {
      custom: {
        host: 'custom-db',
        port: 1234,
        database: 'custom_db',
        user: 'custom_user',
        password: 'custom_password',
        ssl: 'require'
      }
    },
    serverConfig: {
      name: 'Custom MCP Server',
      version: '2.0.0',
      defaultDbAlias: 'custom',
      enableAuth: true,
      apiKey: 'test-api-key'
    },
    transport: 'http',
    port: 8080,
    autoStart: false
  });
  
  expect(postgresMcp).toBeDefined();
}); 