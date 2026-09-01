// A Remembrr "moment" — one card on the debt-story timeline.
// Amounts are milliunits server-side (app convention); the page edits dollars.
export type StoryKind = 'opened' | 'closed' | 'note'

export interface StoryEvent {
  id: string
  dateLabel: string
  kind: StoryKind
  title: string
  amount: number
  note: string
}
