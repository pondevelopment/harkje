import { FlatNode } from "../types";

type OrgSize = "small" | "medium" | "large";

// Simple seeded RNG (deterministic) so results can be stable per input.
const xmur3 = (str: string) => {
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

const mulberry32 = (seed: number) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
};

const makeRng = (seedString: string) => {
  const seedFn = xmur3(seedString);
  return mulberry32(seedFn());
};

const pick = <T,>(rng: () => number, items: readonly T[]): T => {
  return items[Math.floor(rng() * items.length)]!;
};

const randInt = (rng: () => number, min: number, max: number) => {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  return Math.floor(rng() * (hi - lo + 1)) + lo;
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

const FIRST_NAMES = [
  "Alex", "Sam", "Taylor", "Jordan", "Casey", "Riley", "Morgan", "Avery", "Jamie", "Cameron",
  "Quinn", "Reese", "Parker", "Rowan", "Skyler", "Dakota", "Kai", "Mila", "Noah", "Sofia",
] as const;

const LAST_NAMES = [
  "Nguyen", "Patel", "Kim", "Garcia", "Smith", "Johnson", "Brown", "Martinez", "Wilson", "Anderson",
  "Thomas", "Jackson", "White", "Harris", "Clark", "Lewis", "Walker", "Young", "Allen", "King",
] as const;

const DEPARTMENTS = [
  "Executive",
  "Engineering",
  "Product",
  "Design",
  "Sales",
  "Marketing",
  "Operations",
  "Finance",
  "People",
  "Customer Success",
] as const;

const ROLE_BY_DEPT: Record<string, readonly string[]> = {
  Executive: ["CEO", "COO", "CFO", "CTO"],
  Engineering: ["VP Engineering", "Engineering Manager", "Staff Engineer", "Software Engineer", "DevOps Engineer"],
  Product: ["VP Product", "Product Manager", "Product Analyst"],
  Design: ["Design Director", "Product Designer", "UX Researcher"],
  Sales: ["VP Sales", "Account Executive", "Sales Development Rep"],
  Marketing: ["VP Marketing", "Growth Marketer", "Content Strategist"],
  Operations: ["VP Operations", "Operations Manager", "Program Manager"],
  Finance: ["Finance Director", "Financial Analyst"],
  People: ["Head of People", "HR Manager", "Recruiter"],
  "Customer Success": ["CS Director", "Customer Success Manager", "Support Specialist"],
};

const makeName = (rng: () => number) => `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`;

const makeDetails = (rng: () => number, dept: string, title: string, theme: string) => {
  const flavor = pick(rng, [
    "focused on scalable processes",
    "known for clear communication",
    "drives cross-team alignment",
    "prioritizes customer impact",
    "optimizes for speed and quality",
    "mentors and grows the team",
  ] as const);
  const themeBit = theme?.trim() ? ` in the ${theme.trim()} context` : "";
  return `${title} in ${dept}${themeBit}, ${flavor}.`;
};

const sizeToCount = (rng: () => number, size: OrgSize) => {
  if (size === "small") return randInt(rng, 5, 8);
  if (size === "medium") return randInt(rng, 15, 20);
  return randInt(rng, 30, 40);
};

const generateFlatOrg = (rng: () => number, count: number, theme: string): FlatNode[] => {
  const safeCount = clamp(count, 2, 80);
  const nodes: FlatNode[] = [];

  // Root
  nodes.push({
    id: "1",
    parentId: "null",
    name: makeName(rng),
    title: "CEO",
    department: "Executive",
    details: makeDetails(rng, "Executive", "CEO", theme),
  });

  // Ensure a few department heads under the CEO for structure.
  const deptHeads = ["Engineering", "Product", "Sales", "Operations"] as const;
  const headIds: string[] = [];
  let nextId = 2;

  for (const dept of deptHeads) {
    if (nodes.length >= safeCount) break;
    const title = pick(rng, ROLE_BY_DEPT[dept]);
    const id = String(nextId++);
    nodes.push({
      id,
      parentId: "1",
      name: makeName(rng),
      title,
      department: dept,
      details: makeDetails(rng, dept, title, theme),
    });
    headIds.push(id);
  }

  // Add the rest of the org. Prefer adding to existing managers to keep depth.
  const managerBias = () => {
    // 70% chance: pick a non-leaf-ish manager (early nodes), else anyone.
    if (rng() < 0.7) {
      const maxIndex = Math.max(1, Math.floor(nodes.length * 0.55));
      return nodes[randInt(rng, 0, maxIndex - 1)]!.id;
    }
    return nodes[randInt(rng, 0, nodes.length - 1)]!.id;
  };

  while (nodes.length < safeCount) {
    const dept = pick(rng, DEPARTMENTS);
    const titleOptions = ROLE_BY_DEPT[dept] ?? ["Team Member"];
    const title = pick(rng, titleOptions);
    const id = String(nextId++);

    // If possible, attach within the same dept head; otherwise fallback to CEO.
    const parentPool = nodes.filter(n => n.department === dept && n.id !== id);
    const parentId = parentPool.length > 0 && rng() < 0.6
      ? pick(rng, parentPool).id
      : (headIds.length > 0 ? pick(rng, headIds) : managerBias());

    nodes.push({
      id,
      parentId,
      name: makeName(rng),
      title,
      department: dept,
      details: makeDetails(rng, dept, title, theme),
    });
  }

  return nodes;
};

// Previously used Gemini; now generates a deterministic randomized org based on the description.
export const generateOrgStructure = async (description: string): Promise<FlatNode[]> => {
  const seedBase = description?.trim() ? description.trim() : "default";
  const rng = makeRng(`from-description:${seedBase}`);
  const approxCount = clamp(8 + Math.floor(seedBase.length / 40) * 4, 8, 28);
  const theme = seedBase.slice(0, 40);
  return generateFlatOrg(rng, approxCount, theme);
};

export const generateRandomOrgStructure = async (size: OrgSize, theme: string): Promise<FlatNode[]> => {
export const generateRandomOrgStructure = async (
  size: OrgSize,
  theme: string,
  nonce?: string | number,
): Promise<FlatNode[]> => {
  const salt = nonce === undefined || nonce === null ? '' : String(nonce);
  const rng = makeRng(`quick:${size}:${theme || "default"}:${salt}`);
  const count = sizeToCount(rng, size);
  return generateFlatOrg(rng, count, theme);
};