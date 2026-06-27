import assert from 'node:assert';

import { align } from '@/align';
import { MakeSimpleMarshaller } from '@/marshallers';
import { put } from '@/put';
import { parseSignature } from '@/signature';

import type { Put } from '@/put';
import type { SignatureNode } from '@/signature';

export const marshall = (signature: string, data: unknown, offset = 0, fds?: number[]): Buffer => {
  const tree = parseSignature(signature);
  if (!Array.isArray(data) || data.length !== tree.length) {
    throw new Error(
      `message body does not match message signature. Body:${JSON.stringify(
        data,
      )}, signature:${signature}`,
    );
  }
  const putstream = put();
  putstream._offset = offset;
  const buf = writeStruct(putstream, tree, data, fds).buffer();
  return buf;
};

// TODO: serialise JS objects as a{sv}
// function writeHash(ps, treeKey, treeVal, data) {
//
// }

const writeStruct = (ps: Put, tree: SignatureNode[], data: unknown[], fds?: number[]): Put => {
  if (tree.length !== data.length) {
    throw new Error('Invalid struct data');
  }
  for (let i = 0; i < tree.length; ++i) {
    const ele = tree[i];
    if (ele === undefined) {
      throw new Error('Invalid struct data');
    }
    write(ps, ele, data[i], fds);
  }
  return ps;
};

const write = (ps: Put, ele: SignatureNode, data: unknown, fds?: number[]): void => {
  switch (ele.type) {
    case '(':
    case '{': {
      align(ps, 8);
      if (!Array.isArray(data)) {
        throw new Error('Invalid struct data');
      }
      writeStruct(ps, ele.child, data, fds);
      return;
    }
    case 'a': {
      // array serialisation:
      // length of array body aligned at 4 byte boundary
      // (optional 4 bytes to align first body element on 8-byte boundary if element
      // body
      const childType = ele.child[0];
      if (childType === undefined) {
        throw new Error('Incorrect array element signature');
      }
      let items: ArrayLike<unknown>;
      if (Array.isArray(data)) {
        items = data;
      } else if (Buffer.isBuffer(data)) {
        items = data;
      } else {
        throw new Error('Expecting an array for array signature');
      }
      const arrPut = put();
      arrPut._offset = ps._offset;
      const _offset = arrPut._offset;
      writeSimple(arrPut, 'u', 0); // array length placeholder
      const lengthOffset = arrPut._offset - 4 - _offset;
      // we need to align here because alignment is not included in array length
      if (['x', 't', 'd', '{', '('].includes(childType.type)) {
        align(arrPut, 8);
      }
      const startOffset = arrPut._offset;
      for (let i = 0; i < items.length; ++i) {
        write(arrPut, childType, items[i], fds);
      }
      const arrBuff = arrPut.buffer();
      const length = arrPut._offset - startOffset;
      // lengthOffset in the range 0 to 3 depending on number of align bytes padded _before_ arrayLength
      arrBuff.writeUInt32LE(length, lengthOffset);
      ps.put(arrBuff);
      ps._offset += arrBuff.length;
      return;
    }
    case 'v': {
      // TODO: allow serialisation of simple types as variants, e. g 123 -> ['u', 123], true -> ['b', 1], 'abc' -> ['s', 'abc']
      if (!Array.isArray(data) || data.length !== 2) {
        throw new Error('variant data should be [signature, data]');
      }
      const variantSignature = data[0];
      if (typeof variantSignature !== 'string') {
        throw new Error('variant signature should be a string');
      }
      const signatureEle: SignatureNode = {
        type: 'g',
        child: [],
      };
      write(ps, signatureEle, variantSignature, fds);
      const tree = parseSignature(variantSignature);
      assert(tree.length === 1);
      const valueEle = tree[0];
      if (valueEle === undefined) {
        throw new Error('variant signature must have a single complete type');
      }
      write(ps, valueEle, data[1], fds);
      return;
    }
    case 'h': {
      if (fds) {
        if (typeof data !== 'number') {
          throw new Error('Expected a file descriptor (number) for type h');
        }
        const idx = fds.push(data);
        writeSimple(ps, ele.type, idx - 1);
        return;
      }
      writeSimple(ps, ele.type, data);
      return;
    }
    default:
      writeSimple(ps, ele.type, data);
  }
};

const stringTypes = ['g', 'o', 's'];

const writeSimple = (ps: Put, type: string, data: unknown): Put => {
  if (data === undefined) {
    throw new Error("Serialisation of JS 'undefined' type is not supported by d-bus");
  }
  if (data === null) {
    throw new Error('Serialisation of null value is not supported by d-bus');
  }

  let value: unknown = data;
  if (Buffer.isBuffer(value)) value = value.toString(); // encoding?
  if (stringTypes.includes(type) && typeof value !== 'string') {
    throw new Error(
      `Expected string or buffer argument, got ${JSON.stringify(data)} of type '${type}'`,
    );
  }

  const simpleMarshaller = MakeSimpleMarshaller(type);
  simpleMarshaller.marshall(ps, value);
  return ps;
};
