/** Tags have no positional meaning. Preserve case and duplicate counts. */
export function sameTwitchTags(actual: readonly string[] | undefined, expected: readonly string[]): boolean {
  const left = [...(actual ?? [])].sort();
  const right = [...expected].sort();
  return left.length === right.length && left.every((tag, index) => tag === right[index]);
}
