const glslTypeToWgsl = new Map([
  ['bool', 'bool'],
  ['float', 'f32'],
  ['int', 'i32'],
  ['mat2', 'mat2x2<f32>'],
  ['mat3', 'mat3x3<f32>'],
  ['mat4', 'mat4x4<f32>'],
  ['vec2', 'vec2<f32>'],
  ['vec3', 'vec3<f32>'],
  ['vec4', 'vec4<f32>'],
]);

export const defaultFragmentTranslationTargets = [
  { name: 'mx_square', parameterTypes: ['float'], returnType: 'float' },
  { name: 'mx_pow5', parameterTypes: ['float'], returnType: 'float' },
  { name: 'mx_pow6', parameterTypes: ['float'], returnType: 'float' },
  { name: 'mx_average_alpha', parameterTypes: ['vec2'], returnType: 'float' },
  { name: 'mx_ior_to_f0', parameterTypes: ['float'], returnType: 'float' },
  { name: 'mx_ggx_smith_G1', parameterTypes: ['float', 'float'], returnType: 'float' },
  { name: 'mx_ggx_smith_G2', parameterTypes: ['float', 'float', 'float'], returnType: 'float' },
  { name: 'mx_oren_nayar_diffuse', parameterTypes: ['float', 'float', 'float', 'float'], returnType: 'float' },
];

export function translateMaterialXFragmentGlsl(source, options = {}) {
  const targets = options.targets || defaultFragmentTranslationTargets;
  const functions = extractGlslFunctions(source);
  const translated = [];
  const skipped = [];

  for (const target of targets) {
    const match = findFunction(functions, target);
    if (!match) {
      skipped.push({ name: target.name, reason: 'missing' });
      continue;
    }

    try {
      translated.push(translateGlslFunction(match));
    } catch (error) {
      skipped.push({
        name: target.name,
        reason: error?.message || String(error),
      });
    }
  }

  return {
    requestedCount: targets.length,
    skipped,
    translated,
    translatedCount: translated.length,
    wgsl: translated.map(entry => entry.source).join('\n\n'),
  };
}

function extractGlslFunctions(source) {
  const functions = [];
  const signaturePattern = /\b(?<returnType>bool|float|int|mat[234]|vec[234])\s+(?<name>[A-Za-z_]\w*)\s*\(/g;
  let match;

  while ((match = signaturePattern.exec(source))) {
    const openParenIndex = source.indexOf('(', match.index);
    const closeParenIndex = findMatchingDelimiter(source, openParenIndex, '(', ')');
    if (closeParenIndex < 0) continue;

    const bodyStart = source.indexOf('{', closeParenIndex);
    if (bodyStart < 0) continue;

    const betweenSignatureAndBody = source.slice(closeParenIndex + 1, bodyStart).trim();
    if (betweenSignatureAndBody) continue;

    const bodyEnd = findMatchingDelimiter(source, bodyStart, '{', '}');
    if (bodyEnd < 0) continue;

    functions.push({
      body: source.slice(bodyStart + 1, bodyEnd).trim(),
      name: match.groups.name,
      parameters: parseParameters(source.slice(openParenIndex + 1, closeParenIndex)),
      returnType: match.groups.returnType,
    });
    signaturePattern.lastIndex = bodyEnd + 1;
  }

  return functions;
}

function findFunction(functions, target) {
  return functions.find(candidate => (
    candidate.name === target.name
    && candidate.returnType === target.returnType
    && candidate.parameters.length === target.parameterTypes.length
    && candidate.parameters.every((parameter, index) => parameter.type === target.parameterTypes[index])
  ));
}

function parseParameters(source) {
  const trimmed = source.trim();
  if (!trimmed) return [];

  return splitTopLevelArguments(trimmed).map((parameter) => {
    const parts = parameter
      .trim()
      .replace(/\b(const|in)\b/g, '')
      .trim()
      .split(/\s+/);
    return {
      name: parts.at(-1),
      source: parameter.trim(),
      type: parts.at(-2),
    };
  });
}

function translateGlslFunction(fn) {
  if (!glslTypeToWgsl.has(fn.returnType)) {
    throw new Error(`unsupported return type ${fn.returnType}`);
  }

  for (const parameter of fn.parameters) {
    if (!glslTypeToWgsl.has(parameter.type)) {
      throw new Error(`unsupported parameter type ${parameter.type}`);
    }
    if (/\b(out|inout)\b/.test(parameter.source)) {
      throw new Error('out/inout parameters are not supported yet');
    }
  }

  const body = translateGlslBody(fn.body);
  const unsupported = [
    [/\?/, 'untranslated ternary expressions'],
    [/\b(for|while|switch)\b/, 'control-flow loops/switches'],
    [/\b(out|inout)\b/, 'out/inout declarations'],
    [/#/, 'preprocessor directives'],
    [/\+\+|--/, 'increment/decrement operators'],
  ].find(([pattern]) => pattern.test(body));

  if (unsupported) {
    throw new Error(`${unsupported[1]} are not supported yet`);
  }

  const parameters = fn.parameters
    .map(parameter => `${parameter.name}: ${glslTypeToWgsl.get(parameter.type)}`)
    .join(', ');
  return {
    name: fn.name,
    source: `fn ${fn.name}(${parameters}) -> ${glslTypeToWgsl.get(fn.returnType)} {\n${indent(body)}\n}`,
  };
}

function translateGlslBody(source) {
  return source
    .replace(/\bfloat\s+([A-Za-z_]\w*)\s*=/g, 'let $1 =')
    .replace(/\bint\s+([A-Za-z_]\w*)\s*=/g, 'let $1 =')
    .replace(/\bvec([234])\s+([A-Za-z_]\w*)\s*=/g, 'let $2 =')
    .replace(/\bmat([234])\s+([A-Za-z_]\w*)\s*=/g, 'let $2 =')
    .replace(/\bvec([234])\s*\(/g, 'vec$1<f32>(')
    .replace(/\bmat2\s*\(/g, 'mat2x2<f32>(')
    .replace(/\bmat3\s*\(/g, 'mat3x3<f32>(')
    .replace(/\bmat4\s*\(/g, 'mat4x4<f32>(')
    .replace(/\bfloat\s*\(/g, 'f32(')
    .replace(/\bint\s*\(/g, 'i32(')
    .replace(/(let\s+[A-Za-z_]\w*\s*=\s*)\(([^()?:;]+)\)\s*\?\s*([^:;]+)\s*:\s*([^;]+);/g, '$1select($4, $3, $2);');
}

function splitTopLevelArguments(source) {
  const args = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === '(' || character === '[' || character === '{') {
      depth++;
    } else if (character === ')' || character === ']' || character === '}') {
      depth--;
    } else if (character === ',' && depth === 0) {
      args.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }

  const tail = source.slice(start).trim();
  if (tail) args.push(tail);
  return args;
}

function findMatchingDelimiter(source, openIndex, open, close) {
  let depth = 0;
  for (let index = openIndex; index < source.length; index++) {
    const character = source[index];
    if (character === open) {
      depth++;
    } else if (character === close) {
      depth--;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function indent(source) {
  return source
    .split('\n')
    .map(line => (line.trim() ? `  ${line.trim()}` : ''))
    .join('\n');
}
