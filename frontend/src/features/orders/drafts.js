export function buildSuggestionDraft(items = []) {
  const draft = {};
  items.forEach((item) => {
    draft[item.menuItemId] = item.quantity;
  });
  return draft;
}
