export function buildSuggestionDraft(items = []) {
  const draft = {};
  items.forEach((item) => {
    draft[item.menuItemId] = item.quantity;
  });
  return draft;
}

export function buildSuggestionItems(draft = {}) {
  return Object.entries(draft)
    .filter(([, quantity]) => Number(quantity) > 0)
    .map(([menuItemId, quantity]) => ({ menuItemId, quantity: Number(quantity) }));
}

export function buildSuggestionResponseBody(accepted, draft = {}) {
  const body = { accepted };
  if (!accepted) return body;
  const items = buildSuggestionItems(draft);
  if (items.length > 0) body.items = items;
  return body;
}
