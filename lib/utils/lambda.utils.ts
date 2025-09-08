import path from 'path';

function getLambdaEntryPath(functionName: string) {
  return path.join(
    import.meta.dirname,
    '../../lambda/handlers',
    `${functionName}.ts`
  );
}

export { getLambdaEntryPath };
