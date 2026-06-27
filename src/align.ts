import type { Put } from '@/put';

export const align = (ps: Put, n: number): void => {
  const pad = n - (ps._offset % n);
  if (pad === 0 || pad === n) return;
  // TODO: write8(0) in a loop (3 to 7 times here) could be more efficient
  ps.put(Buffer.alloc(pad));
  ps._offset += pad;
};
