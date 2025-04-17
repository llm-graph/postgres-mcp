import { describe, expect, test } from 'bun:test';
import { safeJsonStringify } from '../../src/utils';

describe('Utilities', () => {
  test('safeJsonStringify returns JSON string for valid data', () => {
    const testData = { key: 'value', num: 123 };
    const result = safeJsonStringify(testData);
    expect(result).toEqual('{"key":"value","num":123}');
  });
  
  test('safeJsonStringify returns empty array string for circular references', () => {
    const circularObj: Record<string, unknown> = {};
    circularObj['self'] = circularObj;
    
    const result = safeJsonStringify(circularObj);
    expect(result).toEqual('[]');
  });
}); 