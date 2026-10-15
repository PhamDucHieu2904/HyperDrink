import type { Model3D, ValidationIssue } from '../../catalog/contracts';
import { BASIL_WEB_SEED_MATERIAL, isBasilWebSeedMetadata } from '../../viewer/basil-web-seed-contract';

/** Runtime-created inclusions are valid only when their active GLB node can generate them. */
export function checkModelMaterialSlots(model: Model3D, bytes: Buffer, names: ReadonlySet<string>): ValidationIssue[] {
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8').trimEnd());
  let generatedSeeds = false;
  const visited = new Set<number>();
  const visit = (id: number) => {
    if (visited.has(id)) return;
    visited.add(id);
    const node = gltf.nodes?.[id];
    if (!node) return;
    // Matches the last metadata owner visited by prepareBasilWebLayers.
    if (node.extras?.basilWebSeeds) generatedSeeds = isBasilWebSeedMetadata(node.extras.basilWebSeeds);
    for (const child of node.children ?? []) visit(child);
  };
  for (const id of gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? []) visit(id);
  const missing = Object.entries(model.materialSlots).flatMap(([role, bindings]) => bindings.filter(name =>
    !names.has(name) && !(role === 'inclusions' && name === BASIL_WEB_SEED_MATERIAL && model.layoutProfile === 'glass-290-basil-wrap-v1' && generatedSeeds)));
  return missing.length ? [{ code: 'material_slot_missing', message: `Model “${model.name}” khai báo tên vật liệu/mesh không có trong GLB: ${missing.join(', ')}. Kiểm tra lại material slots.`, collection: 'models3d', entityId: model.id, field: 'materialSlots', severity: 'error' }] : [];
}

/** Called after inspectMedia has validated the self-contained GLB structure.
 * A UV on an unrelated mesh cannot validate the model's printable label slot. */
export function checkModelLabelGeometry(model: Model3D, bytes: Buffer): ValidationIssue[] {
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8').trimEnd()) as {
    scene?: number;
    scenes: { nodes?: number[] }[];
    nodes: { mesh?: number; children?: number[] }[];
    meshes: { name?: string; primitives: { material?: number; attributes: { TEXCOORD_0?: number } }[] }[];
    accessors: { count: number; type: string }[];
    materials?: { name?: string; extensions?: Record<string, unknown> }[];
  };
  const meshIds = new Set<number>();
  const visited = new Set<number>();
  const visit = (id: number) => {
    if (visited.has(id)) return;
    visited.add(id);
    const node = gltf.nodes[id];
    if (node.mesh !== undefined) meshIds.add(node.mesh);
    for (const child of node.children ?? []) visit(child);
  };
  for (const node of gltf.scenes[gltf.scene ?? 0].nodes ?? []) visit(node);
  const bindings = [...meshIds].flatMap(id => {
    const mesh = gltf.meshes[id];
    const rawName = mesh.name ?? `mesh-${id}`;
    const sanitizedName = rawName.replace(/\s/g, '_').replace(/[\[\]\.:\/]/g, '');
    return mesh.primitives.map(primitive => {
      const material = primitive.material === undefined ? undefined : gltf.materials?.[primitive.material];
      const uv = primitive.attributes.TEXCOORD_0 === undefined ? undefined : gltf.accessors[primitive.attributes.TEXCOORD_0];
      return { names: [rawName, sanitizedName, material?.name ?? ''], hasUv: !!uv && uv.count > 0 && uv.type === 'VEC2', unlit: material?.extensions?.KHR_materials_unlit !== undefined };
    });
  });
  const issues: ValidationIssue[] = [];
  for (const name of model.materialSlots.label ?? []) {
    const matching = bindings.filter(binding => binding.names.includes(name));
    const issue = (code: string, message: string) => issues.push({ code, message, collection: 'models3d', entityId: model.id, field: 'materialSlots.label', severity: 'error' });
    if (!matching.length) issue('label_slot_missing', `Model “${model.name}”: material/mesh nhãn “${name}” không thuộc scene được render.`);
    else if (matching.some(binding => !binding.hasUv)) issue('label_uv_missing', `Model “${model.name}”: material/mesh nhãn “${name}” chưa có UV TEXCOORD_0.`);
    else if (matching.some(binding => binding.unlit)) issue('label_material_unsupported', `Model “${model.name}”: material nhãn “${name}” cần vật liệu PBR nhận artwork.`);
  }
  return issues;
}
