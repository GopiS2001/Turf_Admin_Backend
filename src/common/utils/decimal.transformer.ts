import type { ValueTransformer } from 'typeorm';

/** MySQL DECIMAL columns come back as strings; expose them as numbers. */
export const decimal: ValueTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | null) => (value == null ? value : Number(value)),
};

export const money = (n: number) => Math.round(n * 100) / 100;
