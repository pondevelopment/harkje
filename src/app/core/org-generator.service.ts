import { Injectable } from '@angular/core';
import { FlatNode } from '../models/org.types';

type OrgSize = 'small' | 'medium' | 'large';

/**
 * Deterministic local org generator (no external API).
 *
 * Previously named `geminiService.ts` in the React app (kept the misleading name
 * intentionally there); renamed to an honest name in the Angular port. Uses a
 * seeded RNG (xmur3 + mulberry32) so results are stable per input.
 */
@Injectable({ providedIn: 'root' })
export class OrgGeneratorService {
  // --- Seeded RNG ---

  private xmur3 = (str: string): (() => number) => {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return () => {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      h ^= h >>> 16;
      return h >>> 0;
    };
  };

  private mulberry32 = (seed: number): (() => number) => {
    let t = seed >>> 0;
    return () => {
      t += 0x6d2b79f5;
      let x = Math.imul(t ^ (t >>> 15), 1 | t);
      x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  };

  private makeRng(seedString: string): () => number {
    const seedFn = this.xmur3(seedString);
    return this.mulberry32(seedFn());
  }

  // --- Helpers ---

  private pick = <T>(rng: () => number, items: readonly T[]): T =>
    items[Math.floor(rng() * items.length)]!;

  private randInt = (rng: () => number, min: number, max: number): number => {
    const lo = Math.ceil(min);
    const hi = Math.floor(max);
    return Math.floor(rng() * (hi - lo + 1)) + lo;
  };

  private clamp = (v: number, min: number, max: number): number =>
    Math.max(min, Math.min(max, v));

  // --- Name / role data ---

  private readonly FIRST_NAMES = [
    'Alex', 'Sam', 'Taylor', 'Jordan', 'Casey', 'Riley', 'Morgan', 'Avery', 'Jamie', 'Cameron',
    'Quinn', 'Reese', 'Parker', 'Rowan', 'Skyler', 'Dakota', 'Kai', 'Mila', 'Noah', 'Sofia',
  ] as const;

  private readonly LAST_NAMES = [
    'Nguyen', 'Patel', 'Kim', 'Garcia', 'Smith', 'Johnson', 'Brown', 'Martinez', 'Wilson', 'Anderson',
    'Thomas', 'Jackson', 'White', 'Harris', 'Clark', 'Lewis', 'Walker', 'Young', 'Allen', 'King',
  ] as const;

  private readonly DEPARTMENTS = [
    'Executive', 'Engineering', 'Product', 'Design', 'Sales', 'Marketing',
    'Operations', 'Finance', 'People', 'Customer Success',
  ] as const;

  private readonly ROLE_BY_DEPT: Record<string, readonly string[]> = {
    Executive: ['CEO', 'COO', 'CFO', 'CTO'],
    Engineering: ['VP Engineering', 'Engineering Manager', 'Staff Engineer', 'Software Engineer', 'DevOps Engineer'],
    Product: ['VP Product', 'Product Manager', 'Product Analyst'],
    Design: ['Design Director', 'Product Designer', 'UX Researcher'],
    Sales: ['VP Sales', 'Account Executive', 'Sales Development Rep'],
    Marketing: ['VP Marketing', 'Growth Marketer', 'Content Strategist'],
    Operations: ['VP Operations', 'Operations Manager', 'Program Manager'],
    Finance: ['Finance Director', 'Financial Analyst'],
    People: ['Head of People', 'HR Manager', 'Recruiter'],
    'Customer Success': ['CS Director', 'Customer Success Manager', 'Support Specialist'],
  };

  private makeName = (rng: () => number): string =>
    `${this.pick(rng, this.FIRST_NAMES)} ${this.pick(rng, this.LAST_NAMES)}`;

  private makeDetails = (rng: () => number, dept: string, title: string, theme: string): string => {
    const flavor = this.pick(rng, [
      'focused on scalable processes',
      'known for clear communication',
      'drives cross-team alignment',
      'prioritizes customer impact',
      'optimizes for speed and quality',
      'mentors and grows the team',
    ] as const);
    const themeBit = theme?.trim() ? ` in the ${theme.trim()} context` : '';
    return `${title} in ${dept}${themeBit}, ${flavor}.`;
  };

  private sizeToCount = (rng: () => number, size: OrgSize): number => {
    if (size === 'small') return this.randInt(rng, 5, 8);
    if (size === 'medium') return this.randInt(rng, 15, 20);
    return this.randInt(rng, 30, 40);
  };

  private generateFlatOrg(rng: () => number, count: number, theme: string): FlatNode[] {
    const safeCount = this.clamp(count, 2, 80);
    const nodes: FlatNode[] = [];

    // Root
    nodes.push({
      id: '1',
      parentId: 'null',
      name: this.makeName(rng),
      title: 'CEO',
      department: 'Executive',
      details: this.makeDetails(rng, 'Executive', 'CEO', theme),
    });

    // Ensure a few department heads under the CEO for structure.
    const deptHeads = ['Engineering', 'Product', 'Sales', 'Operations'] as const;
    const headIds: string[] = [];
    let nextId = 2;

    for (const dept of deptHeads) {
      if (nodes.length >= safeCount) break;
      const title = this.pick(rng, this.ROLE_BY_DEPT[dept]!);
      const id = String(nextId++);
      nodes.push({
        id,
        parentId: '1',
        name: this.makeName(rng),
        title,
        department: dept,
        details: this.makeDetails(rng, dept, title, theme),
      });
      headIds.push(id);
    }

    const managerBias = () => {
      if (rng() < 0.7) {
        const maxIndex = Math.max(1, Math.floor(nodes.length * 0.55));
        return nodes[this.randInt(rng, 0, maxIndex - 1)]!.id;
      }
      return nodes[this.randInt(rng, 0, nodes.length - 1)]!.id;
    };

    while (nodes.length < safeCount) {
      const dept = this.pick(rng, this.DEPARTMENTS);
      const titleOptions = this.ROLE_BY_DEPT[dept] ?? ['Team Member'];
      const title = this.pick(rng, titleOptions);
      const id = String(nextId++);

      const parentPool = nodes.filter((n) => n.department === dept && n.id !== id);
      const parentId =
        parentPool.length > 0 && rng() < 0.6
          ? this.pick(rng, parentPool).id
          : headIds.length > 0
            ? this.pick(rng, headIds)
            : managerBias();

      nodes.push({
        id,
        parentId,
        name: this.makeName(rng),
        title,
        department: dept,
        details: this.makeDetails(rng, dept, title, theme),
      });
    }

    return nodes;
  }

  /** Generate an org from a free-text description (deterministic). */
  generateOrgStructure(description: string): Promise<FlatNode[]> {
    const seedBase = description?.trim() ? description.trim() : 'default';
    const rng = this.makeRng(`from-description:${seedBase}`);
    const approxCount = this.clamp(8 + Math.floor(seedBase.length / 40) * 4, 8, 28);
    const theme = seedBase.slice(0, 40);
    return Promise.resolve(this.generateFlatOrg(rng, approxCount, theme));
  }

  /** Generate a random org by size + theme + optional nonce (deterministic). */
  generateRandomOrgStructure(size: OrgSize, theme: string, nonce?: string | number): Promise<FlatNode[]> {
    const salt = nonce === undefined || nonce === null ? '' : String(nonce);
    const rng = this.makeRng(`quick:${size}:${theme || 'default'}:${salt}`);
    const count = this.sizeToCount(rng, size);
    return Promise.resolve(this.generateFlatOrg(rng, count, theme));
  }
}
