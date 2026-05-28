const propertyGroups = [
  {
    id: 'base',
    label: 'Base',
    properties: [
      { name: 'base', label: 'Weight', max: 1, min: 0, step: 0.01 },
      { control: 'color', name: 'baseColor', label: 'Color' },
      { name: 'diffuseRoughness', label: 'Diffuse Roughness', max: 1, min: 0, step: 0.01 },
      { name: 'metalness', label: 'Metalness', max: 1, min: 0, step: 0.01 },
    ],
  },
  {
    id: 'specular',
    label: 'Specular',
    properties: [
      { name: 'specular', label: 'Weight', max: 1, min: 0, step: 0.01 },
      { control: 'color', name: 'specularColor', label: 'Color' },
      { name: 'specularRoughness', label: 'Roughness', max: 1, min: 0, step: 0.01 },
      { name: 'specularIor', label: 'IOR', max: 3, min: 1, step: 0.01 },
      { name: 'specularAnisotropy', label: 'Anisotropy', max: 1, min: 0, step: 0.01 },
      { name: 'specularRotation', label: 'Rotation', max: 1, min: 0, step: 0.01 },
    ],
  },
  {
    id: 'transmission',
    label: 'Transmission',
    properties: [
      { name: 'transmission', label: 'Weight', max: 1, min: 0, step: 0.01 },
      { control: 'color', name: 'transmissionColor', label: 'Color' },
      { name: 'transmissionDepth', label: 'Depth', max: 2, min: 0, step: 0.01 },
      { name: 'transmissionExtraRoughness', label: 'Extra Roughness', max: 1, min: 0, step: 0.01 },
      { control: 'boolean', name: 'thinWalled', label: 'Thin Walled' },
      { control: 'color', name: 'opacity', label: 'Opacity' },
    ],
  },
  {
    id: 'subsurface',
    label: 'Subsurface',
    properties: [
      { name: 'subsurface', label: 'Weight', max: 1, min: 0, step: 0.01 },
      { control: 'color', name: 'subsurfaceColor', label: 'Color' },
      { name: 'subsurfaceScale', label: 'Scale', max: 2, min: 0, step: 0.01 },
      { name: 'subsurfaceAnisotropy', label: 'Anisotropy', max: 1, min: -1, step: 0.01 },
    ],
  },
  {
    id: 'sheen',
    label: 'Sheen',
    properties: [
      { name: 'sheen', label: 'Weight', max: 1, min: 0, step: 0.01 },
      { control: 'color', name: 'sheenColor', label: 'Color' },
      { name: 'sheenRoughness', label: 'Roughness', max: 1, min: 0, step: 0.01 },
    ],
  },
  {
    id: 'coat',
    label: 'Coat',
    properties: [
      { name: 'coat', label: 'Weight', max: 1, min: 0, step: 0.01 },
      { control: 'color', name: 'coatColor', label: 'Color' },
      { name: 'coatRoughness', label: 'Roughness', max: 1, min: 0, step: 0.01 },
      { name: 'coatAnisotropy', label: 'Anisotropy', max: 1, min: 0, step: 0.01 },
      { name: 'coatRotation', label: 'Rotation', max: 1, min: 0, step: 0.01 },
      { name: 'coatIor', label: 'IOR', max: 3, min: 1, step: 0.01 },
      { name: 'coatAffectColor', label: 'Affect Color', max: 1, min: 0, step: 0.01 },
      { name: 'coatAffectRoughness', label: 'Affect Roughness', max: 1, min: 0, step: 0.01 },
    ],
  },
  {
    id: 'emission',
    label: 'Emission',
    properties: [
      { name: 'emission', label: 'Weight', max: 4, min: 0, step: 0.01 },
      { control: 'color', name: 'emissionColor', label: 'Color' },
    ],
  },
  {
    id: 'thin-film',
    label: 'Thin Film',
    properties: [
      { name: 'thinFilmThickness', label: 'Thickness', max: 1200, min: 0, step: 1 },
      { name: 'thinFilmIor', label: 'IOR', max: 3, min: 1, step: 0.01 },
    ],
  },
];

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function hasOwn(object, key) {
  return Object.hasOwn(object || {}, key);
}

function cloneValue(value) {
  return Array.isArray(value) ? [...value] : value;
}

function findGeneratedPort(sample, definition) {
  return sample?.uniformLayout?.byName?.[definition.name]
    || sample?.uniformLayout?.byField?.[definition.field];
}

function getPropertySupport(sample, definition, shaderMode, capabilities = {}) {
  const generatedPort = findGeneratedPort(sample, definition);
  const hasGeneratedValue = generatedPort && hasOwn(sample?.uniformValues, generatedPort.field);
  const hasBridgeValue = hasOwn(sample?.ports, definition.name);
  const renderer = capabilities.renderer || 'direct-webgpu';

  if (renderer === 'webgl') {
    if (hasBridgeValue) {
      return { detail: 'available after MaterialX reload in WebGL fallback', status: 'reload' };
    }
    return { detail: 'not found in selected MaterialX document', status: 'unsupported' };
  }

  if (sample?.source !== 'shadergen' && hasBridgeValue) {
    return { detail: 'fallback uniforms', status: 'live' };
  }

  if (shaderMode === 'naga') {
    if (hasGeneratedValue) {
      return { detail: 'uniform upload', status: 'live' };
    }
    return { detail: 'not in generated public block', status: 'unsupported' };
  }

  if (hasBridgeValue) {
    return { detail: 'bridge uniform upload', status: 'live' };
  }

  if (generatedPort) {
    return { detail: 'Naga path only', status: 'readonly' };
  }

  return { detail: 'not in active shader', status: 'unsupported' };
}

function getPropertyValue(sample, definition, shaderMode) {
  const generatedPort = findGeneratedPort(sample, definition);
  if (shaderMode === 'naga' && generatedPort && hasOwn(sample?.uniformValues, generatedPort.field)) {
    return cloneValue(sample.uniformValues[generatedPort.field]);
  }

  if (hasOwn(sample?.ports, definition.name)) {
    return cloneValue(sample.ports[definition.name]);
  }

  return definition.control === 'color' ? [0, 0, 0] : 0;
}

function normalizePropertyValue(definition, value) {
  if (definition.control === 'color') {
    const components = Array.isArray(value) ? value : [0, 0, 0];
    return components.slice(0, 3).map(component => clamp(Number(component) || 0));
  }

  if (definition.control === 'boolean') {
    return value ? 1 : 0;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? clamp(numeric, definition.min ?? Number.NEGATIVE_INFINITY, definition.max ?? Number.POSITIVE_INFINITY)
    : 0;
}

function normalizeDefinition(definition) {
  return {
    control: definition.control || 'range',
    field: definition.field || '',
    max: definition.max ?? 1,
    min: definition.min ?? 0,
    name: definition.name,
    step: definition.step ?? 0.01,
    ...definition,
  };
}

export function createMaterialPropertyModel({ capabilities = {}, sample, shaderMode }) {
  return {
    groups: propertyGroups.map(group => ({
      ...group,
      properties: group.properties.map((rawDefinition) => {
        const definition = normalizeDefinition(rawDefinition);
        const support = getPropertySupport(sample, definition, shaderMode, capabilities);
        return {
          ...definition,
          detail: support.detail,
          status: support.status,
          value: getPropertyValue(sample, definition, shaderMode),
        };
      }),
    })),
    sampleLabel: sample?.label || 'Material',
    shaderMode,
  };
}

export function setMaterialPropertyValue(sample, definition, value, shaderMode) {
  const nextValue = normalizePropertyValue(definition, value);
  const generatedPort = findGeneratedPort(sample, definition);
  let updated = false;

  if (shaderMode === 'naga' && generatedPort && hasOwn(sample?.uniformValues, generatedPort.field)) {
    sample.uniformValues[generatedPort.field] = cloneValue(nextValue);
    updated = true;
  }

  if (hasOwn(sample?.ports, definition.name)) {
    sample.ports[definition.name] = cloneValue(nextValue);
    updated = true;
  }

  return updated;
}

export function summarizeMaterialPropertySupport(model) {
  const counts = { live: 0, readonly: 0, reload: 0, unsupported: 0 };
  for (const group of model.groups) {
    for (const property of group.properties) {
      counts[property.status] = (counts[property.status] || 0) + 1;
    }
  }

  const parts = [`${counts.live} live`];
  if (counts.readonly) parts.push(`${counts.readonly} read-only`);
  if (counts.reload) parts.push(`${counts.reload} reload`);
  if (counts.unsupported) parts.push(`${counts.unsupported} unsupported`);
  return parts.join(' / ');
}

function formatNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0.00';
  if (Math.abs(numeric) >= 100) return numeric.toFixed(0);
  if (Math.abs(numeric) >= 10) return numeric.toFixed(1);
  return numeric.toFixed(2);
}

function colorToHex(value) {
  const components = Array.isArray(value) ? value : [0, 0, 0];
  return `#${components
    .slice(0, 3)
    .map(component => Math.round(clamp(Number(component) || 0) * 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

function hexToColor(value) {
  const normalized = String(value || '').replace(/^#/, '');
  if (!/^[\da-f]{6}$/i.test(normalized)) return [0, 0, 0];
  return [0, 2, 4].map(index => parseInt(normalized.slice(index, index + 2), 16) / 255);
}

function createStatusPill(property) {
  const pill = document.createElement('span');
  pill.className = `support-pill is-${property.status}`;
  pill.textContent = property.status === 'readonly' ? 'read' : property.status;
  pill.title = property.detail;
  return pill;
}

function createRangeControl(property, onChange) {
  const wrapper = document.createElement('div');
  wrapper.className = 'property-control';

  const input = document.createElement('input');
  input.disabled = property.status !== 'live';
  input.max = String(property.max);
  input.min = String(property.min);
  input.step = String(property.step);
  input.type = 'range';
  input.value = String(normalizePropertyValue(property, property.value));

  const output = document.createElement('output');
  output.textContent = formatNumber(input.value);

  input.addEventListener('input', () => {
    output.textContent = formatNumber(input.value);
    onChange(property, Number(input.value));
  });

  wrapper.append(input, output);
  return wrapper;
}

function createColorControl(property, onChange) {
  const input = document.createElement('input');
  input.className = 'property-color';
  input.disabled = property.status !== 'live';
  input.type = 'color';
  input.value = colorToHex(property.value);
  input.addEventListener('input', () => onChange(property, hexToColor(input.value)));
  return input;
}

function createBooleanControl(property, onChange) {
  const wrapper = document.createElement('span');
  wrapper.className = 'toggle-control';

  const input = document.createElement('input');
  input.disabled = property.status !== 'live';
  input.checked = Boolean(Number(property.value));
  input.type = 'checkbox';
  input.addEventListener('change', () => onChange(property, input.checked ? 1 : 0));

  wrapper.append(input);
  return wrapper;
}

function createControl(property, onChange) {
  if (property.control === 'color') {
    return createColorControl(property, onChange);
  }

  if (property.control === 'boolean') {
    return createBooleanControl(property, onChange);
  }

  return createRangeControl(property, onChange);
}

export function renderMaterialPropertiesPanel(root, model, { onChange } = {}) {
  if (!root) return;

  const fragment = document.createDocumentFragment();
  for (const group of model.groups) {
    const section = document.createElement('section');
    section.className = 'property-group';
    section.dataset.group = group.id;

    const heading = document.createElement('h2');
    heading.className = 'property-group-title';
    heading.textContent = group.label;
    section.append(heading);

    for (const property of group.properties) {
      const row = document.createElement('div');
      row.className = 'property-row';
      row.dataset.status = property.status;

      const label = document.createElement('label');
      label.className = 'property-label';
      label.textContent = property.label;

      row.append(label, createControl(property, onChange || (() => {})), createStatusPill(property));
      section.append(row);
    }

    fragment.append(section);
  }

  root.replaceChildren(fragment);
}
