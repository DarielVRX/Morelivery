export function logEvent(type, payload = {}) {
  const event = {
    timestamp: new Date().toISOString(),
    type,
    payload
  };
  console.log(JSON.stringify(event));
}
