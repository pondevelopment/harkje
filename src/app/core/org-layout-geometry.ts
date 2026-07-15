export interface OrthogonalPoint {
  breadth: number;
  depth: number;
}

export type SegmentRelationship =
  | 'none'
  | 'collinear-overlap'
  | 'crossing'
  | 't-junction'
  | 'endpoint-touch';

const EPSILON = 0.001;

/** Classify the geometric relationship between two axis-aligned segments. */
export function classifyOrthogonalSegments(
  aStart: OrthogonalPoint,
  aEnd: OrthogonalPoint,
  bStart: OrthogonalPoint,
  bEnd: OrthogonalPoint,
): SegmentRelationship {
  const aHorizontal = Math.abs(aStart.depth - aEnd.depth) < EPSILON;
  const bHorizontal = Math.abs(bStart.depth - bEnd.depth) < EPSILON;
  const aVertical = Math.abs(aStart.breadth - aEnd.breadth) < EPSILON;
  const bVertical = Math.abs(bStart.breadth - bEnd.breadth) < EPSILON;
  if ((!aHorizontal && !aVertical) || (!bHorizontal && !bVertical)) return 'none';

  if (aHorizontal === bHorizontal) {
    const sameAxis = aHorizontal
      ? Math.abs(aStart.depth - bStart.depth) < EPSILON
      : Math.abs(aStart.breadth - bStart.breadth) < EPSILON;
    if (!sameAxis) return 'none';
    const a1 = aHorizontal ? aStart.breadth : aStart.depth;
    const a2 = aHorizontal ? aEnd.breadth : aEnd.depth;
    const b1 = aHorizontal ? bStart.breadth : bStart.depth;
    const b2 = aHorizontal ? bEnd.breadth : bEnd.depth;
    const overlapStart = Math.max(Math.min(a1, a2), Math.min(b1, b2));
    const overlapEnd = Math.min(Math.max(a1, a2), Math.max(b1, b2));
    if (overlapStart > overlapEnd + EPSILON) return 'none';
    return overlapEnd - overlapStart > EPSILON
      ? 'collinear-overlap'
      : 'endpoint-touch';
  }

  const horizontalStart = aHorizontal ? aStart : bStart;
  const horizontalEnd = aHorizontal ? aEnd : bEnd;
  const verticalStart = aHorizontal ? bStart : aStart;
  const verticalEnd = aHorizontal ? bEnd : aEnd;
  const crossing = {
    breadth: verticalStart.breadth,
    depth: horizontalStart.depth,
  };
  if (
    !within(crossing.breadth, horizontalStart.breadth, horizontalEnd.breadth) ||
    !within(crossing.depth, verticalStart.depth, verticalEnd.depth)
  ) {
    return 'none';
  }

  const onHorizontalEndpoint = pointsEqual(crossing, horizontalStart) ||
    pointsEqual(crossing, horizontalEnd);
  const onVerticalEndpoint = pointsEqual(crossing, verticalStart) ||
    pointsEqual(crossing, verticalEnd);
  if (onHorizontalEndpoint && onVerticalEndpoint) return 'endpoint-touch';
  if (onHorizontalEndpoint || onVerticalEndpoint) return 't-junction';
  return 'crossing';
}

function within(value: number, first: number, second: number): boolean {
  return value >= Math.min(first, second) - EPSILON &&
    value <= Math.max(first, second) + EPSILON;
}

function pointsEqual(first: OrthogonalPoint, second: OrthogonalPoint): boolean {
  return Math.abs(first.breadth - second.breadth) < EPSILON &&
    Math.abs(first.depth - second.depth) < EPSILON;
}
