// Interests a guest ticks in the Search tab before signing in. The tab
// unmounts when the first-run interests screen appears, so this survives
// outside React state until that screen consumes it.
let draft: string[] = [];

export function getGuestInterestDraft(): string[] {
  return draft;
}

export function setGuestInterestDraft(values: string[]) {
  draft = [...values];
}
