import type { SignatureNode } from '@/signature';

export const headerSignature: SignatureNode[] = [
  {
    type: 'a',
    child: [
      {
        type: '(',
        child: [
          { type: 'y', child: [] },
          { type: 'v', child: [] },
        ],
      },
    ],
  },
];
