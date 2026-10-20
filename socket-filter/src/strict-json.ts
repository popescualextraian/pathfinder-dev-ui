// JSON parsing without parser differentials: invalid UTF-8, duplicate keys (at any depth, compared after
// unescaping) and __proto__ keys are refused, so what the filter checks is what the daemon would see.

export class JsonError extends Error {}

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export function parseStrictJson(bytes: Buffer): unknown {
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    throw new JsonError('body is not valid UTF-8');
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new JsonError('body is not valid JSON');
  }
  checkKeys(text);
  return value;
}

// Walks the (already validated) JSON text and checks the keys of every object.
function checkKeys(text: string): void {
  const stack: Array<Set<string> | null> = [];
  let expectKey = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      const top = stack[stack.length - 1];
      if (top && expectKey) {
        const key = JSON.parse(text.slice(i, j + 1)) as string;
        if (key === '__proto__') throw new JsonError('key __proto__ is not allowed');
        if (top.has(key)) throw new JsonError('duplicate key in JSON object');
        top.add(key);
        expectKey = false;
      }
      i = j + 1;
      continue;
    }
    if (c === '{') {
      stack.push(new Set());
      expectKey = true;
    } else if (c === '[') {
      stack.push(null);
    } else if (c === '}' || c === ']') {
      stack.pop();
    } else if (c === ',') {
      expectKey = stack[stack.length - 1] !== null;
    }
    i++;
  }
}
