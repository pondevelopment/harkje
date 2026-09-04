import { describe, expect, it } from 'vitest';
import * as d3 from 'd3';
import { LayoutDirection } from '../models/org.types';
import { AdaptiveOrgLayoutService } from './adaptive-org-layout.service';
import { CsvParserService } from './csv-parser.service';
import { OrgTreeService } from './org-tree.service';

describe('AdaptiveOrgLayoutService performance', () => {
  it('measures a wide generated-manager import', () => {
    const lines = ['user;manager;title;department'];
    for (let index = 1; index <= 100; index++) {
      lines.push(`Employee ${index};Manager ${index};Role;Department`);
    }

    const flatNodes = new CsvParserService().buildFlatNodesFromCsv(lines.join('\n'));
    const tree = new OrgTreeService().buildTree(flatNodes).root;
    expect(tree).not.toBeNull();

    const root = d3.hierarchy(tree!);
    const startedAt = performance.now();
    const result = new AdaptiveOrgLayoutService().computeLayout(
      root,
      LayoutDirection.TopDown,
      1,
    );
    const durationMs = Math.round(performance.now() - startedAt);

    console.info(`wide generated-manager layout: ${durationMs}ms`);
    expect(root.descendants()).toHaveLength(201);
    expect(result.candidateCount).toBeGreaterThan(0);
    expect(durationMs).toBeLessThan(15_000);
  }, 120_000);
});