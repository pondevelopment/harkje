/**
 * Concrete layout-algorithm registry. This module imports the interface file
 * (`org-layout-algorithm.ts`) AND the concrete implementations, then registers
 * each one. It is intentionally separate from the interface file to break what
 * would otherwise be a circular import (the implementations import the
 * interface, the interface must not import the implementations).
 *
 * Import this module once at app startup (e.g. from the AppComponent or a
 * `providedAppInitializer` / constructor effect) so {@link LAYOUT_ALGORITHMS}
 * is populated before the renderer looks an algorithm up. Importing it has no
 * side effects beyond registration.
 */

import { AdaptiveOrgLayoutService } from './adaptive-org-layout.service';
import { BasicTreeLayoutService } from './basic-tree-layout.service';
import { registerLayoutAlgorithm } from './org-layout-algorithm';

let registered = false;

function registerOnce(): void {
  if (registered) return;
  registered = true;
  registerLayoutAlgorithm({
    id: 'adaptive',
    label: 'Adaptive (ratio-aware)',
    algorithm: new AdaptiveOrgLayoutService(),
  });
  registerLayoutAlgorithm({
    id: 'basic',
    label: 'Basic (subtree)',
    algorithm: new BasicTreeLayoutService(),
  });
}

// Register on module load.
registerOnce();

export {};
