import { parseStrictJson } from '../src/strict-json';

describe('parseStrictJson', () => {
  it('parses valid JSON', () => {
    expect(parseStrictJson(Buffer.from('{"a":[1,"x",{"b":null}],"c":{"d":true}}'))).toEqual({ a: [1, 'x', { b: null }], c: { d: true } });
    expect(parseStrictJson(Buffer.from(' "s" '))).toBe('s');
  });

  it.each([
    ['{"a":1,"a":2}'],
    ['{"a":{"b":1,"b":2}}'],
    ['[{"x":1,"x":1}]'],
    ['{"Image":"a","\\u0049mage":"b"}'],
    ['{"a\\"":1,"a\\u0022":2}'],
  ])('refuses duplicate keys in %s', (text) => {
    expect(() => parseStrictJson(Buffer.from(text))).toThrow(/duplicate key/);
  });

  it('allows the same key in sibling objects', () => {
    expect(parseStrictJson(Buffer.from('[{"a":1},{"a":2}]'))).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it.each([[''], ['{'], ['{"a":1,}'], ["{'a':1}"], ['﻿{}'], ['{} {}']])('refuses invalid JSON %p', (text) => {
    expect(() => parseStrictJson(Buffer.from(text))).toThrow();
  });

  it('refuses invalid UTF-8', () => {
    expect(() => parseStrictJson(Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]))).toThrow(/UTF-8/);
  });

  it('refuses keys that JavaScript treats specially', () => {
    expect(() => parseStrictJson(Buffer.from('{"__proto__":{"x":1}}'))).toThrow(/__proto__/);
  });
});
