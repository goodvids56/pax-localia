import { z } from 'zod';

const SerializableSchema = z.json();

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  if (typeof value === 'number' && Object.is(value, -0)) {
    return 0;
  }
  return value;
}

export function canonicalStringify(value: unknown): string {
  const parsed = SerializableSchema.parse(value);
  return JSON.stringify(canonicalize(parsed));
}

export function stableNumericHash(value: unknown): number {
  const serialized = canonicalStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
