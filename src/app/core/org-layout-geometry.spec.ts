import { describe, expect, it } from 'vitest';
import { classifyOrthogonalSegments, OrthogonalPoint } from './org-layout-geometry';

const point = (breadth: number, depth: number): OrthogonalPoint => ({ breadth, depth });

describe('classifyOrthogonalSegments', () => {
  it('classifies a perpendicular interior crossing', () => {
    expect(classifyOrthogonalSegments(
      point(-20, 10),
      point(20, 10),
      point(0, 0),
      point(0, 20),
    )).toBe('crossing');
  });

  it('classifies a T-junction', () => {
    expect(classifyOrthogonalSegments(
      point(-20, 10),
      point(20, 10),
      point(0, 10),
      point(0, 30),
    )).toBe('t-junction');
  });

  it('classifies collinear overlap', () => {
    expect(classifyOrthogonalSegments(
      point(-20, 10),
      point(20, 10),
      point(0, 10),
      point(30, 10),
    )).toBe('collinear-overlap');
  });

  it('classifies a shared endpoint without overlap', () => {
    expect(classifyOrthogonalSegments(
      point(-20, 10),
      point(0, 10),
      point(0, 10),
      point(0, 30),
    )).toBe('endpoint-touch');
  });

  it('returns none for separated segments', () => {
    expect(classifyOrthogonalSegments(
      point(-20, 10),
      point(20, 10),
      point(30, 0),
      point(30, 20),
    )).toBe('none');
  });
});
