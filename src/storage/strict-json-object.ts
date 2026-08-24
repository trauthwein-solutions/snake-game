export const parseStrictJsonObject = (
  serialized: string,
  requiredMemberNames: readonly string[],
): Record<string, unknown> | null => {
  const parsed: unknown = JSON.parse(serialized);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const memberNames: string[] = [];
  let depth = 0;
  let expectsMemberName = false;

  // JSON.parse has established valid syntax. Scan only top-level string keys,
  // decoding each token so escaped-equivalent duplicate names remain visible.
  for (let index = 0; index < serialized.length; index += 1) {
    const character = serialized[index];

    if (character === '"') {
      const tokenStart = index;
      index += 1;

      while (index < serialized.length) {
        if (serialized[index] === '\\') {
          index += 2;
          continue;
        }
        if (serialized[index] === '"') {
          break;
        }
        index += 1;
      }

      if (depth === 1 && expectsMemberName) {
        memberNames.push(JSON.parse(serialized.slice(tokenStart, index + 1)));
        expectsMemberName = false;
      }
      continue;
    }

    if (character === '{' || character === '[') {
      depth += 1;
      if (depth === 1) {
        expectsMemberName = true;
      }
    } else if (character === '}' || character === ']') {
      depth -= 1;
    } else if (character === ',' && depth === 1) {
      expectsMemberName = true;
    }
  }

  if (
    memberNames.length !== requiredMemberNames.length ||
    requiredMemberNames.some((name) => !memberNames.includes(name))
  ) {
    return null;
  }

  return parsed as Record<string, unknown>;
};
