import { describe, it, expect } from 'vitest';

import { endianness } from '@/constants';
import { DBusBuffer } from '@/dbus-buffer';
import { marshall } from '@/marshall';
import { marshallMessage, messageToJsFmt } from '@/marshall-compat';
import { unmarshall } from '@/message';
import { Variant } from '@/variant';

const roundtripBody = (signature: string, marshallerBody: unknown[]): unknown[] => {
  const buf = marshall(signature, marshallerBody, 0);
  const dbuf = new DBusBuffer(buf, 0, endianness.le, null, { ayBuffer: true });
  return dbuf.read(signature);
};

const roundtripMessage = (signature: string, jsBody: unknown[]): unknown[] => {
  const [buf] = marshallMessage({ serial: 1, type: 1, signature, body: jsBody });
  const raw = unmarshall(buf, { ayBuffer: true });
  return messageToJsFmt(raw).body ?? [];
};

describe('marshall/unmarshall round-trip (low-level)', () => {
  it('handles simple integer and float types', () => {
    expect(roundtripBody('y', [255])).toEqual([255]);
    expect(roundtripBody('b', [true])).toEqual([true]);
    expect(roundtripBody('b', [false])).toEqual([false]);
    expect(roundtripBody('n', [-12345])).toEqual([-12345]);
    expect(roundtripBody('q', [65535])).toEqual([65535]);
    expect(roundtripBody('i', [-2147483648])).toEqual([-2147483648]);
    expect(roundtripBody('u', [4294967295])).toEqual([4294967295]);
    expect(roundtripBody('d', [3.141592653589793])).toEqual([3.141592653589793]);
  });

  it('handles string types', () => {
    expect(roundtripBody('s', ['hello world'])).toEqual(['hello world']);
    expect(roundtripBody('o', ['/org/freedesktop/DBus'])).toEqual(['/org/freedesktop/DBus']);
    expect(roundtripBody('g', ['a{sv}'])).toEqual(['a{sv}']);
  });

  it('handles 64-bit signed integers (x) with native BigInt', () => {
    expect(roundtripBody('x', [BigInt(0)])).toEqual([BigInt(0)]);
    expect(roundtripBody('x', [BigInt(42)])).toEqual([BigInt(42)]);
    expect(roundtripBody('x', [BigInt(-42)])).toEqual([BigInt(-42)]);
    expect(roundtripBody('x', [BigInt('9223372036854775807')])).toEqual([
      BigInt('9223372036854775807'),
    ]);
    expect(roundtripBody('x', [BigInt('-9223372036854775807')])).toEqual([
      BigInt('-9223372036854775807'),
    ]);
  });

  it('handles 64-bit unsigned integers (t) with native BigInt', () => {
    expect(roundtripBody('t', [BigInt(0)])).toEqual([BigInt(0)]);
    expect(roundtripBody('t', [BigInt(42)])).toEqual([BigInt(42)]);
    expect(roundtripBody('t', [BigInt('18446744073709551615')])).toEqual([
      BigInt('18446744073709551615'),
    ]);
  });

  it('handles arrays and structs', () => {
    expect(roundtripBody('ai', [[1, 2, 3, -4]])).toEqual([[1, 2, 3, -4]]);
    expect(roundtripBody('as', [['a', 'bb', 'ccc']])).toEqual([['a', 'bb', 'ccc']]);
    expect(roundtripBody('(is)', [[42, 'answer']])).toEqual([[42, 'answer']]);
    expect(roundtripBody('(ax)', [[[BigInt(1), BigInt(2)]]])).toEqual([[[BigInt(1), BigInt(2)]]]);
  });

  it('treats ay as a Buffer', () => {
    const result = roundtripBody('ay', [Buffer.from([1, 2, 3, 4])]);
    expect(Buffer.isBuffer(result[0])).toBe(true);
    expect(result[0]).toEqual(Buffer.from([1, 2, 3, 4]));
  });
});

describe('full message round-trip (JS format)', () => {
  it('round-trips primitives through a full message', () => {
    expect(roundtripMessage('s', ['hi'])).toEqual(['hi']);
    expect(roundtripMessage('x', [BigInt('-9223372036854775807')])).toEqual([
      BigInt('-9223372036854775807'),
    ]);
    expect(roundtripMessage('t', [BigInt('18446744073709551615')])).toEqual([
      BigInt('18446744073709551615'),
    ]);
    expect(roundtripMessage('iu', [-5, 5])).toEqual([-5, 5]);
  });

  it('round-trips variants', () => {
    const result = roundtripMessage('v', [new Variant('s', 'hello')]);
    expect(result[0]).toBeInstanceOf(Variant);
    expect(result[0]).toEqual(new Variant('s', 'hello'));
  });

  it('round-trips a dict of variants a{sv}', () => {
    const result = roundtripMessage('a{sv}', [
      { foo: new Variant('s', 'bar'), n: new Variant('i', 7) },
    ]);
    expect(result).toEqual([{ foo: new Variant('s', 'bar'), n: new Variant('i', 7) }]);
  });

  it('round-trips a nested structure', () => {
    const body = [[BigInt(10), 'hello', [true, false]]];
    expect(roundtripMessage('(xsab)', body)).toEqual(body);
  });
});
