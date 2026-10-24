export type Via = 'call' | 'rest' | 'event' | 'file' | 'other';
export type Severity = 'error' | 'warn' | 'info';
export type FindingStatus = 'open' | 'fixed' | 'accepted';
export type ChangeKind = 'new' | 'changed' | 'removed';
export type PlanSize = 'S' | 'M' | 'L';

export interface ModelLayer { id: string; name: string; mayUse: string[] }
export interface ModelModule { id: string; name: string }
export interface ModelPart { id: string; name: string; layers: ModelLayer[]; modules: ModelModule[] }
export interface ModelComponent {
  id: string; name: string; part: string; layer: string; module: string | null;
  parent: string | null; summary: string; page: string;
}
export interface ModelConnection { from: string; to: string; via: Via }
export interface Model {
  version: 1;
  style: { id: string; name: string };
  parts: ModelPart[];
  components: ModelComponent[];
  connections: ModelConnection[];
}

export interface FullReviewFinding {
  id: string; rule: string; component: string; severity: Severity;
  source: 'depcruise' | 'llm' | 'jscpd' | 'knip'; text: string; status: FindingStatus; since?: string;
}
export interface FullReview {
  version: 1; kind: 'full'; commit: string; reviewedAt: string;
  components: Record<string, { reviewedAt: string }>;
  findings: FullReviewFinding[];
}

export interface PlanProposed {
  name: string; part: string; layer: string; module: string | null; summary: string;
  talks_to: { to: string; via: Via }[];
}
export interface PlanChange { component: string; change: ChangeKind; line: string; proposed?: PlanProposed }
export interface PlanFinding {
  id: string; rule: string; component: string; severity: Severity; text: string;
  alternative?: string; status: FindingStatus;
}
export interface PlanReview {
  version: 1; kind: 'plan'; title: string; plan: string; baseCommit: string; reviewedAt: string;
  size: PlanSize; summary: string; changes: PlanChange[]; findings: PlanFinding[]; passed: string[];
}

// Results of ArchitectureService.
export interface CurrentArchitecture {
  repository: string; branch: string; sha: string; model: Model;
  fullReview: FullReview | null; fullReviewError: string | null; pageBase: string | null;
}
export interface ReviewSummary {
  branch: string; slug: string; sha: string; title: string; plan: string; reviewedAt: string;
  size: PlanSize; summary: string; touched: { component: string; change: ChangeKind }[];
  openFindings: number; findings: number;
}
export interface RefusedReview { branch: string; slug: string | null; file: string; error: string }
export interface ReviewList {
  repository: string; branch: string; sha: string; reviews: ReviewSummary[]; refused: RefusedReview[];
  // Branches beyond the first 100 were not searched.
  truncated: boolean;
}
export interface ReviewDetail {
  repository: string; branch: string; sha: string; slug: string; model: Model;
  review: PlanReview; pageBase: string | null;
}
