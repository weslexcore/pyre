// Every suggestion kind's handler, by kind. The Record type makes a new kind
// in ../types a type error here until it has one.

import type { SuggestionKind } from '../types';
import { boardCardComment } from './board-card-comment';
import { boardCardCreate } from './board-card-create';
import type { KindHandler } from './handler';
import { sopEdit } from './sop-edit';

export const SUGGESTION_KIND_HANDLERS: { [K in SuggestionKind]: KindHandler<K> } = {
  'board_card.create': boardCardCreate,
  'board_card.comment': boardCardComment,
  'sop.edit': sopEdit,
};

export type { Applied, ApplyContext, KindHandler, Validation } from './handler';
