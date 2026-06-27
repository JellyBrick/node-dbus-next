import { marshall } from '@/message';
import { parseSignature, collapseSignature } from '@/signature';
import { Variant } from '@/variant';

import type { RawMessage } from '@/message';
import type { SignatureNode } from '@/signature';

const isSignatureNode = (x: unknown): x is SignatureNode => {
  return typeof x === 'object' && x !== null && 'type' in x && typeof x.type === 'string';
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !Buffer.isBuffer(value) &&
    !(value instanceof Variant)
  );
};

const valueIsMarshallVariant = (value: unknown): value is [SignatureNode[], unknown[]] => {
  // used for the marshaller variant type
  if (!Array.isArray(value) || value.length !== 2) {
    return false;
  }
  const treePart = value[0];
  if (!Array.isArray(treePart) || treePart.length === 0) {
    return false;
  }
  return isSignatureNode(treePart[0]);
};

const marshallVariantToJs = (variant: [SignatureNode[], unknown[]]): unknown => {
  // XXX The marshaller uses a different body format than what the connection
  // is expected to emit. These two formats should be unified.
  // parses a single complete variant in marshall format
  const type = variant[0][0];
  const value = variant[1][0];

  if (type === undefined) {
    throw new Error('variant is missing a type');
  }

  if (!type.child.length) {
    if (valueIsMarshallVariant(value)) {
      const innerType = value[0][0];
      if (innerType === undefined) {
        throw new Error('variant is missing a type');
      }
      return new Variant(collapseSignature(innerType), marshallVariantToJs(value));
    } else {
      return value;
    }
  }

  if (type.type === 'a') {
    const childType = type.child[0];
    if (childType === undefined) {
      throw new Error('array is missing an element type');
    }
    if (childType.type === 'y') {
      // this gives us a buffer
      return value;
    } else if (childType.type === '{') {
      // this is an array of dictionary entries
      const result: Record<string, unknown> = {};
      if (Array.isArray(value)) {
        const valueType = childType.child[1];
        if (valueType === undefined) {
          throw new Error('dictionary entry is missing a value type');
        }
        for (const entry of value) {
          if (Array.isArray(entry) && entry.length >= 2) {
            // dictionary keys must have basic types
            result[String(entry[0])] = marshallVariantToJs([[valueType], [entry[1]]]);
          }
        }
      }
      return result;
    } else {
      // other arrays only have one type
      const result: unknown[] = [];
      if (Array.isArray(value)) {
        for (const item of value) {
          result.push(marshallVariantToJs([[childType], [item]]));
        }
      }
      return result;
    }
  } else if (type.type === '(') {
    // structs have types equal to the number of children
    const result: unknown[] = [];
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; ++i) {
        const memberType = type.child[i];
        if (memberType === undefined) {
          throw new Error('struct member is missing a type');
        }
        result.push(marshallVariantToJs([[memberType], [value[i]]]));
      }
    }
    return result;
  }

  return undefined;
};

export const messageToJsFmt = (message: RawMessage): RawMessage => {
  // XXX The marshaller uses a different body format than what the connection
  // is expected to emit. These two formats should be unified.
  const signature = message.signature ?? '';
  const body = message.body ?? [];
  const bodyJs: unknown[] = [];
  const signatureTree = parseSignature(signature);
  for (let i = 0; i < signatureTree.length; ++i) {
    const tree = signatureTree[i];
    if (tree === undefined) {
      continue;
    }
    bodyJs.push(marshallVariantToJs([[tree], [body[i]]]));
  }

  message.body = bodyJs;
  message.signature = signature;
  return message;
};

export const jsToMarshalFmt = (
  signature: string | SignatureNode,
  value: unknown,
): [string, unknown] => {
  // XXX The connection accepts a message body in plain js format and converts
  // it to the marshaller format for writing. These two formats should be
  // unified.
  if (value === undefined) {
    const signatureStr = typeof signature === 'string' ? signature : collapseSignature(signature);
    throw new Error(`expected value for signature: ${signatureStr}`);
  }

  let signatureStr: string;
  let node: SignatureNode;
  if (typeof signature === 'string') {
    signatureStr = signature;
    const parsed = parseSignature(signature)[0];
    if (parsed === undefined) {
      throw new Error(`expected a complete type for signature: ${signature}`);
    }
    node = parsed;
  } else {
    signatureStr = collapseSignature(signature);
    node = signature;
  }

  if (node.child.length === 0) {
    if (node.type === 'v') {
      if (!(value instanceof Variant)) {
        throw new Error(`expected a Variant for value (got ${typeof value})`);
      }
      return [node.type, jsToMarshalFmt(value.signature, value.value)];
    } else {
      return [node.type, value];
    }
  }

  const childType = node.child[0];

  if (
    node.type === 'a' &&
    childType !== undefined &&
    childType.type === 'y' &&
    Buffer.isBuffer(value)
  ) {
    // special case: ay is a buffer
    return [signatureStr, value];
  } else if (node.type === 'a') {
    if (childType === undefined) {
      throw new Error(`invalid array signature '${signatureStr}'`);
    }
    const result: unknown[] = [];
    if (childType.type === 'y') {
      if (!Array.isArray(value)) {
        throw new Error(`expecting an array for signature '${signatureStr}' (got ${typeof value})`);
      }
      return [signatureStr, value];
    } else if (childType.type === '{') {
      // this is an array of dictionary elements
      if (!isPlainObject(value)) {
        throw new Error(
          `expecting an object for signature '${signatureStr}' (got ${typeof value})`,
        );
      }
      const keyNode = childType.child[0];
      const valNode = childType.child[1];
      for (const rawKey of Object.keys(value)) {
        const v = value[rawKey];
        // js always converts keys of objects to string
        // convert them back if the signature requires it
        let key: string | number | boolean = rawKey;
        if (keyNode) {
          const keyType = keyNode.type;
          if (['y', 'n', 'q', 'i', 'x', 't'].includes(keyType)) {
            // key should be integer
            key = parseInt(rawKey, 10);
          } else if (['b'].includes(keyType)) {
            // key should be boolean
            if (!(rawKey === 'true' || rawKey === 'false')) {
              throw new Error(
                `error parsing dict key for signature '${signatureStr}' (key: ${rawKey})`,
              );
            }
            key = rawKey === 'true';
          }
        }
        if (v instanceof Variant) {
          result.push([key, jsToMarshalFmt(v.signature, v.value)]);
        } else {
          if (valNode === undefined) {
            throw new Error(`invalid dictionary signature '${signatureStr}'`);
          }
          result.push([key, jsToMarshalFmt(valNode, v)[1]]);
        }
      }
    } else {
      if (!Array.isArray(value)) {
        throw new Error(`expecting an array for signature '${signatureStr}' (got ${typeof value})`);
      }
      for (const v of value) {
        if (v instanceof Variant) {
          result.push(jsToMarshalFmt(v.signature, v.value));
        } else {
          result.push(jsToMarshalFmt(childType, v)[1]);
        }
      }
    }
    return [signatureStr, result];
  } else if (node.type === '(') {
    if (!Array.isArray(value)) {
      throw new Error(`expecting an array for signature '${signatureStr}' (got ${typeof value})`);
    }
    if (value.length !== node.child.length) {
      throw new Error(
        `expecting struct to have ${node.child.length} members (got ${value.length} members)`,
      );
    }
    const result: unknown[] = [];
    for (let i = 0; i < value.length; ++i) {
      const v = value[i];
      const memberNode = node.child[i];
      if (memberNode === undefined) {
        throw new Error(`invalid struct signature '${signatureStr}'`);
      }
      if (memberNode.type === 'v') {
        if (!(v instanceof Variant)) {
          throw new Error(`expected a Variant for struct member ${i + 1} (got ${String(v)})`);
        }
        result.push(jsToMarshalFmt(v.signature, v.value));
      } else {
        result.push(jsToMarshalFmt(memberNode, v)[1]);
      }
    }
    return [signatureStr, result];
  } else {
    throw new Error(`got unknown complex type: ${node.type}`);
  }
};

export const marshallMessage = (msg: RawMessage): [Buffer, number[]] => {
  // XXX The connection accepts a message body in plain js format and converts
  // it to the marshaller format for writing. These two formats should be
  // unified.
  const signature = msg.signature ?? '';
  const body = msg.body ?? [];

  const signatureTree = parseSignature(signature);

  if (signatureTree.length !== body.length) {
    throw new Error(
      `Expected ${signatureTree.length} body elements for signature '${signature}' (got ${body.length})`,
    );
  }

  const marshallerBody: unknown[] = [];
  for (let i = 0; i < body.length; ++i) {
    const sigNode = signatureTree[i];
    if (sigNode === undefined) {
      throw new Error(
        `Expected ${signatureTree.length} body elements for signature '${signature}'`,
      );
    }
    if (sigNode.type === 'v') {
      const v = body[i];
      if (!(v instanceof Variant)) {
        throw new Error(
          `Expected a Variant() argument for position ${i + 1} (value='${String(body[i])}')`,
        );
      }
      marshallerBody.push(jsToMarshalFmt(v.signature, v.value));
    } else {
      marshallerBody.push(jsToMarshalFmt(sigNode, body[i])[1]);
    }
  }

  msg.signature = signature;
  msg.body = marshallerBody;
  return marshall(msg);
};
