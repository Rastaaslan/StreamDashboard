let context = null;

export function setMobileContext(value) {
  if (context) throw new Error('Mobile context already initialized.');
  context = Object.freeze({ ...value });
}

export function getMobileContext() {
  if (!context) throw new Error('Mobile context not initialized.');
  return context;
}
