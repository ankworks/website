/**
 * Shared shapes for V3-C collaboration: reactions and Discussions.
 *
 * Reactions follow GitHub's own vocabulary — nothing here is invented, and a
 * count is only ever what GitHub reported. When the API omits a field (for
 * example because the repository disabled reactions) the UI shows "unavailable"
 * rather than a fabricated zero.
 */

export const REACTION_CONTENTS = [
  'THUMBS_UP',
  'THUMBS_DOWN',
  'LAUGH',
  'HOORAY',
  'CONFUSED',
  'HEART',
  'ROCKET',
  'EYES',
] as const;

export type ReactionContent = (typeof REACTION_CONTENTS)[number];

/** Human-facing label and emoji for each GitHub reaction content. */
export const REACTION_LABELS: Record<ReactionContent, { label: string; emoji: string }> = {
  THUMBS_UP: { label: 'Thumbs up', emoji: '👍' },
  THUMBS_DOWN: { label: 'Thumbs down', emoji: '👎' },
  LAUGH: { label: 'Laugh', emoji: '😄' },
  HOORAY: { label: 'Hooray', emoji: '🎉' },
  CONFUSED: { label: 'Confused', emoji: '😕' },
  HEART: { label: 'Heart', emoji: '❤️' },
  ROCKET: { label: 'Rocket', emoji: '🚀' },
  EYES: { label: 'Eyes', emoji: '👀' },
};

export function isReactionContent(value: unknown): value is ReactionContent {
  return typeof value === 'string' && (REACTION_CONTENTS as readonly string[]).includes(value);
}

/**
 * GitHub spells the same eight reactions differently in REST (`+1`) and in
 * GraphQL (`THUMBS_UP`). Both maps exist so a count is never dropped — and no
 * other spelling is accepted, so an unknown upstream value is ignored rather
 * than shown as a made-up reaction.
 */
const REST_TO_CANONICAL: Record<string, ReactionContent> = {
  '+1': 'THUMBS_UP',
  '-1': 'THUMBS_DOWN',
  laugh: 'LAUGH',
  hooray: 'HOORAY',
  confused: 'CONFUSED',
  heart: 'HEART',
  rocket: 'ROCKET',
  eyes: 'EYES',
};

const CANONICAL_TO_REST: Record<ReactionContent, string> = {
  THUMBS_UP: '+1',
  THUMBS_DOWN: '-1',
  LAUGH: 'laugh',
  HOORAY: 'hooray',
  CONFUSED: 'confused',
  HEART: 'heart',
  ROCKET: 'rocket',
  EYES: 'eyes',
};

/** Canonical name for a value reported by either API; null when unknown. */
export function canonicalReaction(value: unknown): ReactionContent | null {
  if (typeof value !== 'string') return null;
  if (isReactionContent(value)) return value;
  return REST_TO_CANONICAL[value.toLowerCase()] ?? null;
}

/** The spelling the REST API expects when creating a reaction. */
export function restReactionName(value: ReactionContent): string {
  return CANONICAL_TO_REST[value];
}

/** A single reaction tally as reported by GitHub. */
export interface ReactionGroup {
  content: ReactionContent;
  count: number;
  /** True when the signed-in viewer has this reaction on the subject. */
  viewerHasReacted: boolean;
}

/** REST subjects we can react to; `number` is the issue/PR number, `id` a comment id. */
export type ReactionSubjectKind =
  | 'issue'
  | 'issue-comment'
  | 'pull'
  | 'pull-comment'
  | 'discussion'
  | 'discussion-comment';

export const REACTION_SUBJECT_KINDS: readonly ReactionSubjectKind[] = [
  'issue',
  'issue-comment',
  'pull',
  'pull-comment',
  'discussion',
  'discussion-comment',
];

export function isReactionSubjectKind(value: unknown): value is ReactionSubjectKind {
  return typeof value === 'string' && (REACTION_SUBJECT_KINDS as readonly string[]).includes(value);
}

/** Response of GET/POST/DELETE on a reaction subject. */
export interface ReactionsResponse {
  subject: ReactionSubjectKind;
  /** Repository the subject belongs to. */
  repo: string;
  /** Issue/PR number, or the comment/discussion id, depending on the subject. */
  targetId: string;
  reactions: ReactionGroup[];
  /** Total reactions GitHub reported (not computed client-side). */
  totalCount: number;
}

// ---------------------------------------------------------------------------
// Discussions (GraphQL only — GitHub has no Discussions REST endpoints)
// ---------------------------------------------------------------------------

export interface DiscussionAuthor {
  login: string;
  avatarUrl: string | null;
  htmlUrl: string;
}

export interface DiscussionCategory {
  id: string;
  name: string;
  emoji: string;
  slug: string;
  description: string | null;
  isAnswerable: boolean;
}

export interface DiscussionComment {
  id: string;
  body: string;
  author: DiscussionAuthor | null;
  createdAt: string;
  updatedAt: string | null;
  isAnswer: boolean;
  replies: DiscussionComment[];
  viewerCanUpdate: boolean;
  viewerCanDelete: boolean;
  reactions: ReactionGroup[];
}

export interface DiscussionSummary {
  id: string;
  number: number;
  title: string;
  author: DiscussionAuthor | null;
  category: DiscussionCategory | null;
  createdAt: string;
  updatedAt: string | null;
  commentsCount: number;
  upvoteCount: number;
  locked: boolean;
  answered: boolean;
  url: string;
}

export interface DiscussionDetail extends DiscussionSummary {
  body: string;
  answer: DiscussionComment | null;
  comments: DiscussionComment[];
  viewerCanUpdate: boolean;
  viewerCanDelete: boolean;
  /** False until GitHub confirms the viewer may lock/unlock. */
  viewerCanLock: boolean;
  reactions: ReactionGroup[];
}

export interface DiscussionsResponse {
  repo: string;
  categoryId: string | null;
  discussions: DiscussionSummary[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null; hasPreviousPage: boolean; startCursor: string | null };
}

export interface DiscussionCategoriesResponse {
  repo: string;
  /** False when the repository has Discussions disabled (or GraphQL refused). */
  enabled: boolean;
  categories: DiscussionCategory[];
}

export interface DiscussionDetailResponse {
  repo: string;
  discussion: DiscussionDetail;
}

export interface DiscussionMutationResponse {
  id: string;
  number?: number;
  url: string;
  commentId?: string;
}

// --- type guards ------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isReactionGroup(value: unknown): value is ReactionGroup {
  if (!isRecord(value)) return false;
  return isReactionContent(value.content) && typeof value.count === 'number' && typeof value.viewerHasReacted === 'boolean';
}

export function isReactionsResponse(value: unknown): value is ReactionsResponse {
  if (!isRecord(value)) return false;
  return (
    isReactionSubjectKind(value.subject) &&
    typeof value.repo === 'string' &&
    typeof value.targetId === 'string' &&
    Array.isArray(value.reactions) &&
    value.reactions.every(isReactionGroup) &&
    typeof value.totalCount === 'number'
  );
}

export function isDiscussionCategoriesResponse(value: unknown): value is DiscussionCategoriesResponse {
  if (!isRecord(value)) return false;
  if (typeof value.repo !== 'string' || typeof value.enabled !== 'boolean') return false;
  return Array.isArray(value.categories);
}

export function isDiscussionsResponse(value: unknown): value is DiscussionsResponse {
  if (!isRecord(value)) return false;
  if (typeof value.repo !== 'string' || !Array.isArray(value.discussions)) return false;
  const pageInfo = value.pageInfo;
  return isRecord(pageInfo) && typeof pageInfo.hasNextPage === 'boolean';
}

export function isDiscussionDetailResponse(value: unknown): value is DiscussionDetailResponse {
  if (!isRecord(value)) return false;
  return typeof value.repo === 'string' && isRecord(value.discussion);
}

export function isDiscussionMutationResponse(value: unknown): value is DiscussionMutationResponse {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string' && typeof value.url === 'string';
}
