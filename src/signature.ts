// parse signature from string to tree

export interface SignatureNode {
  type: string;
  child: SignatureNode[];
}

const match: Record<string, string> = {
  '{': '}',
  '(': ')',
};

const knownTypes: Record<string, boolean> = {};
'(){}ybnqiuxtdsogarvehm*?@&^'.split('').forEach((c) => {
  knownTypes[c] = true;
});

export const parseSignature = (signature: string): SignatureNode[] => {
  let index = 0;
  const next = (): string | null => {
    if (index < signature.length) {
      const c = signature[index];
      ++index;
      return c ?? null;
    }
    return null;
  };

  const parseOne = (c: string): SignatureNode => {
    const checkNotEnd = (ch: string | null): string => {
      if (!ch) {
        throw new Error('Bad signature: unexpected end');
      }
      return ch;
    };

    if (!knownTypes[c]) {
      throw new Error(`Unknown type: "${c}" in signature "${signature}"`);
    }

    let ele: string | null;
    const res: SignatureNode = { type: c, child: [] };
    switch (c) {
      case 'a': // array
        res.child.push(parseOne(checkNotEnd(next())));
        return res;
      case '{': // dict entry
      case '(': // struct
        while ((ele = next()) !== null && ele !== match[c]) {
          res.child.push(parseOne(ele));
        }
        checkNotEnd(ele);
        return res;
    }
    return res;
  };

  const ret: SignatureNode[] = [];
  let c: string | null;
  while ((c = next()) !== null) {
    ret.push(parseOne(c));
  }
  return ret;
};

export const collapseSignature = (value: SignatureNode): string => {
  if (value.child.length === 0) {
    return value.type;
  }

  let type = value.type;
  for (const child of value.child) {
    type += collapseSignature(child);
  }
  if (type[0] === '{') {
    type += '}';
  } else if (type[0] === '(') {
    type += ')';
  }
  return type;
};
