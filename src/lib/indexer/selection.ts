export function mergeIndexIncludePaths(configured: string[], additional: string[]): string[] {
  return [...new Set([...configured, ...additional])];
}

export function getIndexChanges(previousFiles: string[], currentFiles: string[], changedFiles: string[]): string[] {
  const previous = new Set(previousFiles);
  const current = new Set(currentFiles);
  return [...new Set([
    ...changedFiles,
    ...currentFiles.filter((filePath) => !previous.has(filePath)),
    ...previousFiles.filter((filePath) => !current.has(filePath)),
  ])];
}