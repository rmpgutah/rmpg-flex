import { describe, it, expect } from 'vitest';
import { Semaphore } from '../../src/utils/semaphore';

describe('Semaphore', () => {
  it('allows up to N concurrent acquires', async () => {
    const sem = new Semaphore(3);
    await sem.acquire();
    await sem.acquire();
    await sem.acquire();
    expect(sem.available).toBe(0);
  });

  it('blocks when at capacity and resumes after release', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    let resolved = false;
    const pending = sem.acquire().then(() => { resolved = true; });

    await new Promise(r => setTimeout(r, 10));
    expect(resolved).toBe(false);

    sem.release();
    await pending;
    expect(resolved).toBe(true);
  });

  it('tracks waiting count', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();
    const p1 = sem.acquire();
    const p2 = sem.acquire();
    await new Promise(r => setTimeout(r, 5));
    expect(sem.waiting).toBe(2);

    sem.release(); await p1;
    sem.release(); await p2;
    expect(sem.waiting).toBe(0);
  });

  it('throws on invalid permit count', () => {
    expect(() => new Semaphore(0)).toThrow();
    expect(() => new Semaphore(-1)).toThrow();
  });

  it('processes queue in FIFO order', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    const order: number[] = [];
    const p1 = sem.acquire().then(() => order.push(1));
    const p2 = sem.acquire().then(() => order.push(2));
    const p3 = sem.acquire().then(() => order.push(3));

    sem.release(); await p1;
    sem.release(); await p2;
    sem.release(); await p3;

    expect(order).toEqual([1, 2, 3]);
  });
});
