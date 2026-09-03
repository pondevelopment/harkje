# Organogram Layout Requirements

This document defines the requirements for an algorithm that lays out Harkje's
organizational charts. It separates the minimum renderer contract from the
stronger hierarchy, routing, and aspect-ratio requirements of an adaptive
layout algorithm.

The canonical TypeScript contract is defined in
[`src/app/core/org-layout-algorithm.ts`](src/app/core/org-layout-algorithm.ts),
and the shared result types are defined in
[`src/app/models/org.types.ts`](src/app/models/org.types.ts).

## 1. Terminology

- **Card**: the fixed-size rectangle used to render one person.
- **Rank**: a set of direct reports shown at the same hierarchy depth.
- **Peer row or peer band**: one displayed row of a manager's direct reports.
- **Subtree block**: a node together with all visible descendants, cards,
  connector routes, occupied bounds, and layout metrics.
- **Breadth axis**: the axis along which peers are arranged.
- **Depth axis**: the axis along which reporting levels progress.
- **Content bounds**: the smallest rectangle containing all cards and routes.
- **Frame bounds**: the padded export rectangle adjusted to the requested ratio.
- **Route owner**: the manager at the source of a parent-child connector.

## 2. Input Model

The algorithm receives a D3 hierarchy:

```ts
computeLayout(
  root: d3.HierarchyNode<OrgNode>,
  direction: LayoutDirection,
  targetAspectRatio: number,
): LayoutResult;
```

The input hierarchy must satisfy these invariants:

1. There is exactly one logical root.
2. Every visible non-root node has exactly one parent.
3. Node IDs are unique strings.
4. The hierarchy has no cycles or disconnected nodes.
5. Child array order is meaningful and must be preserved.
6. The hierarchy may already be pruned because one or more managers are
   collapsed. Only visible nodes participate in layout.
7. Labels such as name, title, and department must not affect geometry because
   cards have fixed dimensions.

The supported directions are:

- `TopDown`: reporting depth progresses downward.
- `LeftRight`: reporting depth progresses to the right.

The requested physical width-to-height ratio is clamped to the inclusive range
`0.25` through `4`. A missing or non-finite value uses `1`.

## 3. Output Contract

The algorithm must:

1. Write finite physical `x` and `y` coordinates to every visible hierarchy
   node.
2. Return a complete `LayoutResult`.
3. Return a resolvable orthogonal route for every visible parent-child link.
4. Return each manager's displayed row partition in `rowsByParent`.
5. Return deterministic `bounds`, `frameBounds`, `signature`, and
   `candidateCount` values.

`LayoutResult` contains:

```ts
interface LayoutResult {
  bounds: LayoutBounds;
  frameBounds: LayoutBounds;
  routes: ReadonlyMap<string, readonly LayoutPoint[]>;
  rowsByParent: ReadonlyMap<string, readonly (readonly string[])[]>;
  targetAspectRatio: number;
  achievedAspectRatio: number;
  signature: string;
  candidateCount: number;
}
```

The route-map key is algorithm-specific. `buildLinkRoute()` and
`buildLinkPath()` must resolve it consistently for each D3 hierarchy link.

## 4. Coordinate and Dimension Rules

The current fixed geometry is:

| Property | Value |
| --- | ---: |
| Card width | `180` |
| Card height | `74` |
| Minimum horizontal peer gap | `20` |
| Inter-rank gap | `48` |
| Connector-to-card clearance | `4` |
| Minimum export padding per side | `40` |

For every node:

- `x` is the horizontal center of its card.
- `y` is the top edge of its card.
- Its physical card bounds are
  `[x - CARD_WIDTH / 2, x + CARD_WIDTH / 2]` horizontally and
  `[y, y + CARD_HEIGHT]` vertically.

Changing the target aspect ratio may change row partitions and subtree
arrangements. It must not scale card dimensions, coordinates, fonts, or gaps.

## 5. Hard Geometry Constraints

A candidate is invalid if it violates any of these constraints:

1. A visible node is missing, duplicated, or assigned non-finite coordinates.
2. Two card rectangles overlap.
3. Cards whose depth ranges overlap have less than the fixed peer-axis gap.
4. A parent-child link has fewer than two route points.
5. A route segment is neither horizontal nor vertical.
6. A route passes through an unrelated card or its clearance margin.
7. Routes owned by different managers cross.
8. Routes owned by different managers overlap collinearly.
9. Routes owned by different managers form a T-junction.
10. Routes owned by different managers touch at endpoints.
11. Returned content bounds fail to enclose every card and route point.

Routes belonging to the same manager may share that manager's connector bus.
Routes belonging to different managers must remain visually distinct.

These are validity rules, not scoring penalties. Unsafe candidates must be
rejected before ratio or compactness is considered.

## 6. Hierarchy and Ordering Constraints

### 6.1 Source Order

For each manager, flattening `rowsByParent.get(managerId)` must reproduce the
manager's original child order exactly. A layout may split children into rows,
but it may not reorder them.

Every row must therefore be a contiguous ordered partition of the child list.
For children `[A, B, C, D]`, `[[A, B], [C, D]]` is valid, while
`[[A, C], [B, D]]` is not.

### 6.2 Rank Placement

- Reports in one peer row share one depth baseline.
- The first peer row starts one card-depth plus one inter-rank gap after its
  manager.
- Each wrapped row advances by exactly one additional card-depth plus one
  inter-rank gap.
- A deep subtree in an earlier row must not push a later direct report down by
  the full height of that subtree.
- Descendants must remain beyond their visible manager on the depth axis.

### 6.3 Complete Subtrees

Each child candidate is an indivisible block containing:

- all card placements in the child subtree;
- all internal connector routes;
- its entry port;
- card and route bounds;
- clearance corridors; and
- hierarchy and compactness metrics.

A parent may translate the complete child block. It must not independently
move descendants or alter the child's internal routes while packing siblings.

### 6.4 Contour Packing

Sibling blocks should be packed against their actual occupied contours rather
than only their rectangular subtree bounds. Packing must:

- retain fixed card clearance;
- reserve required connector channels;
- prefer the earliest feasible peer rows;
- avoid unnecessary sparse staircases; and
- avoid a singleton final row when a similarly suitable balanced partition is
  available.

## 7. Connector Requirements

Every connector must be an orthogonal polyline joining a manager to one direct
report.

For each manager:

1. All direct-report routes leave through one common first inter-rank bus.
2. Reports in lower peer rows descend through reserved columns or channels.
3. The complete route must clear unrelated cards.
4. The route must not become visually connected to a route owned by another
   manager.

At an extreme portrait target, a set of visible leaf peers may be displayed as
one aligned column with a manager-owned side bus. This special roster topology
is allowed only when every child in the roster is a leaf. A visible manager
subtree must never be flattened into the roster.

## 8. Aspect-Ratio Requirements

Let the unpadded physical content ratio be:

$$
r = \frac{\text{content width}}{\text{content height}}
$$

For target ratio $t$, compare candidates using logarithmic error:

$$
E(r,t) = \left|\ln\left(\frac{r}{t}\right)\right|
$$

Logarithmic error treats reciprocal portrait and landscape deviations
symmetrically.

The selected topology must be based on unpadded content bounds. Export-frame
padding must not make a poor content layout appear ratio-optimal.

For a ratio-aware algorithm, increasing the requested ratio should generally
produce monotonically wider selected topologies. This is accomplished by
changing row and subtree topology, not by coordinate scaling.

## 9. Candidate Selection

### 9.1 Safety and Ratio Envelope

Selection occurs in this order:

1. Reject all candidates that violate hard geometry constraints.
2. Select the safest remaining route-overlap group.
3. Find the minimum content-ratio error $E_{min}$ in that group.
4. Keep candidates satisfying:

$$
E(r,t) \le E_{min} + 0.08
$$

5. Compare only those ratio-suitable candidates for hierarchy quality.

### 9.2 Hierarchy Comparator

Compare ratio-suitable candidates lexicographically by:

1. fewer rank inversions;
2. fewer peer bands;
3. lower peer-band imbalance;
4. fewer recursive rows;
5. fewer singleton tails;
6. lower cumulative peer-band delay;
7. smaller physical area;
8. lower maximum peer-band offset;
9. shorter total connector length;
10. lower total row imbalance;
11. lower ratio error; and
12. stable signature order as the final deterministic tie-breaker.

A rank inversion occurs when a later direct-report row starts at or below the
depth already occupied by descendants of an earlier peer row.

### 9.3 Hierarchy Dominance

Before capping a candidate frontier, remove a candidate when another safe
candidate:

- has no more route conflicts;
- has no more rank inversions;
- uses strictly fewer local peer bands;
- has no greater cumulative peer delay;
- has no greater maximum band offset; and
- requires no more than `0.20` logarithmic sibling-breadth growth.

Dominance must be evaluated across all row partitions and child-subtree
variants, not only within one partition.

## 10. Export Frame

Start with content bounds plus at least `40` units of symmetric padding on every
side. Expand the shorter frame dimension symmetrically until:

$$
\frac{\text{frame width}}{\text{frame height}} = t
$$

`frameBounds` must always enclose `bounds`. `achievedAspectRatio` reports the
unpadded content ratio, while the frame ratio must equal the clamped target.

## 11. Recommended Solver Structure

The adaptive problem is naturally solved post-order from leaves to root:

```text
solve(node):
  if node is a leaf:
    return one card-only subtree candidate

  childFrontiers = solve every visible child

  for each bounded combination of child candidates:
    for each ordered row partition:
      place rows at fixed rank offsets
      contour-pack complete child blocks along the breadth axis
      reserve connector channels
      construct manager-owned orthogonal routes
      reject invalid geometry
      calculate bounds and hierarchy metrics

  remove hierarchy-dominated candidates globally
  retain narrow, wide, compact, and hierarchy-optimal anchors
  return a bounded candidate frontier

select(rootFrontier, target):
  reject unsafe geometry
  apply the content-ratio envelope
  apply the deterministic hierarchy comparator
  write selected node coordinates
  return LayoutResult
```

The current bounded-search targets are:

- Enumerate every ordered row cut for up to eight direct reports.
- Above eight reports, use an incremental ordered-partition beam.
- Retain at most `32` partition states.
- Retain at most `16` child-block combinations at each composition step.
- Retain at most `32` final candidates per subtree frontier.

Pruning must explicitly retain:

- the narrowest candidate;
- the widest candidate;
- minimum-width and minimum-height candidates;
- the minimum-area candidate;
- the shortest-connector candidate;
- candidates near representative aspect profiles; and
- the hierarchy-optimal candidate.

This prevents bounded search from silently losing the only useful portrait,
landscape, compact, or hierarchy-preserving topology.

## 12. Determinism and Caching

For the same visible hierarchy, direction, and target ratio, the algorithm must
return the same signature, coordinates, routes, rows, and bounds.

The candidate frontier may be cached by hierarchy identity and direction
because it is target-independent. A ratio change may select another cached
candidate but must rewrite every node position and return that candidate's
routes without stale values.

A different visible hierarchy, including one created by collapsing or
expanding a manager, must receive a newly computed frontier.

## 13. Acceptance Criteria

A production adaptive algorithm should pass all of the following checks:

- Every visible node receives finite coordinates.
- Cards retain the fixed width and height.
- No cards overlap.
- Fixed peer and rank gaps are preserved.
- Every visible parent-child link has a valid orthogonal route.
- No connector enters an unrelated card's clearance area.
- Connectors owned by different managers never cross, overlap, touch, or form
  T-junctions.
- Every manager's rows flatten to the original child order.
- Wrapped rows advance by exactly one fixed row step.
- Complete child subtrees move rigidly.
- Labels do not affect geometry.
- Portrait and landscape targets can select different topologies.
- Wider target ratios do not select progressively narrower layouts for the same
  hierarchy.
- The unpadded selected content stays within `0.08` logarithmic error of the
  best safe frontier candidate.
- The export frame matches the clamped target ratio exactly.
- Repeated calls are deterministic and restore cached coordinates and routes.
- Collapsed hierarchies are recomputed using only visible nodes.
- Both top-down and left-right directions satisfy the geometry contract.
- Every ordered rooted tree shape through six nodes passes.
- Generated trees from approximately 2 through 80 nodes pass at target ratios
  `0.25`, `0.5`, `1`, `2`, and `4`.

The current executable examples and geometry oracle live in
[`src/app/core/adaptive-org-layout.service.spec.ts`](src/app/core/adaptive-org-layout.service.spec.ts)
and
[`src/app/core/org-layout-algorithm.spec.ts`](src/app/core/org-layout-algorithm.spec.ts).