/**
 * A module is complete when the member has completed every published video in
 * it. Pure + testable; the data (published ids, completed ids) is fetched by
 * the service.
 */
export function isModuleComplete(
  publishedVideoIds: string[],
  completedVideoIds: ReadonlySet<string>,
): boolean {
  if (publishedVideoIds.length === 0) return false;
  return publishedVideoIds.every((id) => completedVideoIds.has(id));
}
