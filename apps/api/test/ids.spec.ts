import { describe, expect, it } from 'vitest';
import { slugify, uuidv7 } from '../src/common/ids';

describe('public identity primitives', () => {
  it('creates a UUIDv7 identifier with a stable version and variant', () => {
    const id = uuidv7(1_726_000_000_000);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('creates readable, safe workspace slugs', () => {
    expect(slugify('  AI Evaluation — Core!  ')).toBe('ai-evaluation-core');
  });
});
