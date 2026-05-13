import type { ElementKind, Mesh, Point } from "./types.js";
import { elementKindFromNodeCount } from "./topology.js";

type MeshImportFormat = "json" | "vtk" | "vtu" | "inp" | "k";

export function parseMeshJSON(text: string): Mesh {
  return meshFromSerializable(JSON.parse(text));
}

export function parseMeshText(text: string, fileName = ""): Mesh {
  const importLabel = fileName ? ` in ${fileName}` : "";
  const format = detectMeshImportFormat(text, fileName);

  if (format) {
    try {
      return parseMeshByFormat(text, format);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not import mesh${importLabel}. ${message}`);
    }
  }

  try {
    return parseMeshJSON(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not import mesh${importLabel}. Expected JSON, legacy VTK (.vtk), VTU (.vtu), Abaqus INP (.inp), or LS-DYNA keyword (.k/.key) mesh data. ${message}`);
  }
}

export function parseLegacyVtkMesh(text: string): Mesh {
  const lines = normalizeImportText(text).split("\n");
  if (lines.length < 4 || !/^#\s*vtk\b/i.test(lines[0] ?? "")) {
    throw new Error("VTK import expects a legacy VTK file starting with '# vtk DataFile Version'");
  }
  if ((lines[2] ?? "").trim().toUpperCase() !== "ASCII") {
    throw new Error("VTK import currently supports ASCII legacy VTK files only");
  }
  if ((lines[3] ?? "").trim().toUpperCase() !== "DATASET UNSTRUCTURED_GRID") {
    throw new Error("VTK import currently supports DATASET UNSTRUCTURED_GRID only");
  }

  let index = 4;
  index = skipBlankLines(lines, index);

  const pointsHeader = (lines[index] ?? "").trim();
  const pointsMatch = pointsHeader.match(/^POINTS\s+(\d+)\s+\S+/i);
  if (!pointsMatch) {
    throw new Error("VTK import could not find a valid POINTS section");
  }
  index += 1;
  const pointCount = Number(pointsMatch[1]);
  const pointValues = consumeNumericValues(lines, index, pointCount * 3, "POINTS");
  index = pointValues.nextIndex;

  const nodes: Point[] = [];
  for (let offset = 0; offset < pointValues.values.length; offset += 3) {
    nodes.push([
      pointValues.values[offset]!,
      pointValues.values[offset + 1]!,
      pointValues.values[offset + 2]!
    ]);
  }

  index = skipBlankLines(lines, index);
  const cellsHeader = (lines[index] ?? "").trim();
  const cellsMatch = cellsHeader.match(/^CELLS\s+(\d+)\s+(\d+)/i);
  if (!cellsMatch) {
    throw new Error("VTK import could not find a valid CELLS section");
  }
  index += 1;
  const cellCount = Number(cellsMatch[1]);
  const cellIntCount = Number(cellsMatch[2]);
  const cellValues = consumeNumericValues(lines, index, cellIntCount, "CELLS");
  index = cellValues.nextIndex;

  const elements: number[][] = [];
  let cursor = 0;
  for (let elementId = 1; elementId <= cellCount; elementId += 1) {
    const rawNodeCount = cellValues.values[cursor] ?? Number.NaN;
    if (!Number.isInteger(rawNodeCount) || rawNodeCount <= 0) {
      throw new Error(`VTK CELLS entry ${elementId} is missing a valid node count`);
    }
    const nodeCount: number = rawNodeCount;
    cursor += 1;
    const vtkNodeIds = cellValues.values.slice(cursor, cursor + nodeCount);
    if (vtkNodeIds.length !== nodeCount) {
      throw new Error(`VTK CELLS entry ${elementId} is truncated`);
    }
    const element = vtkNodeIds.map((nodeId) => {
      if (!Number.isInteger(nodeId) || nodeId < 0) {
        throw new Error(`VTK CELLS entry ${elementId} contains an invalid node id ${nodeId}`);
      }
      const oneBasedNodeId = nodeId + 1;
      if (oneBasedNodeId > nodes.length) {
        throw new Error(`VTK CELLS entry ${elementId} references missing point ${nodeId}`);
      }
      return oneBasedNodeId;
    });
    validateElementNodeIds(element, elementId);
    elements.push(element);
    cursor += nodeCount;
  }

  index = skipBlankLines(lines, index);
  const cellTypesHeader = (lines[index] ?? "").trim();
  const cellTypesMatch = cellTypesHeader.match(/^CELL_TYPES\s+(\d+)/i);
  if (!cellTypesMatch) {
    throw new Error("VTK import could not find a valid CELL_TYPES section");
  }
  index += 1;
  const vtkCellTypeCount = Number(cellTypesMatch[1]);
  if (vtkCellTypeCount !== cellCount) {
    throw new Error(`VTK CELL_TYPES count ${vtkCellTypeCount} does not match CELLS count ${cellCount}`);
  }
  const cellTypes = consumeNumericValues(lines, index, cellCount, "CELL_TYPES").values;
  const uniqueCellTypes = [...new Set(cellTypes)];
  if (uniqueCellTypes.length !== 1) {
    throw new Error(`VTK import only supports pure meshes. Found mixed CELL_TYPES: ${uniqueCellTypes.join(", ")}`);
  }

  const vtkCellType = uniqueCellTypes[0];
  const kind = vtkCellType === 9
    ? "Q1"
    : vtkCellType === 12
      ? "H1"
      : undefined;
  if (!kind) {
    throw new Error(`VTK import only supports CELL_TYPES 9 (QUAD) and 12 (HEXAHEDRON), got ${vtkCellType}`);
  }

  const expectedNodeCount = kind === "Q1" ? 4 : 8;
  for (let elementId = 1; elementId <= elements.length; elementId += 1) {
    const element = elements[elementId - 1]!;
    if (element.length !== expectedNodeCount) {
      throw new Error(`VTK ${kind} import expected ${expectedNodeCount} nodes per element, got ${element.length} at element ${elementId}`);
    }
  }

  return { kind, nodes, elements };
}

export function parseVtuMesh(text: string): Mesh {
  const normalized = normalizeImportText(text);
  if (!/<VTKFile\b[^>]*\btype\s*=\s*["']UnstructuredGrid["']/i.test(normalized)) {
    throw new Error("VTU import expects a VTK XML UnstructuredGrid file");
  }

  const nodes: Point[] = [];
  const elements: number[][] = [];
  let inferredKind: ElementKind | undefined;
  const pieceMatches = [...normalized.matchAll(/<Piece\b([^>]*)>([\s\S]*?)<\/Piece>/gi)];

  if (pieceMatches.length === 0) {
    throw new Error("VTU import could not find any Piece sections");
  }

  for (const pieceMatch of pieceMatches) {
    const attrs = readXmlAttributes(pieceMatch[1] ?? "");
    const pieceText = pieceMatch[2] ?? "";
    const pointCount = readRequiredIntegerAttribute(attrs, "NumberOfPoints", "VTU Piece");
    const cellCount = readRequiredIntegerAttribute(attrs, "NumberOfCells", "VTU Piece");
    const nodeOffset = nodes.length;

    const pointsSection = matchXmlSection(pieceText, "Points", "VTU import could not find a Points section");
    const pointsArray = matchVtuDataArray(pointsSection, (dataAttrs) => !dataAttrs.Name, "VTU Points");
    const pointComponentCount = Number(pointsArray.attrs.NumberOfComponents ?? "3");
    if (!Number.isInteger(pointComponentCount) || pointComponentCount < 2 || pointComponentCount > 3) {
      throw new Error(`VTU Points DataArray must have 2 or 3 components, got ${pointsArray.attrs.NumberOfComponents ?? "undefined"}`);
    }
    const pointValues = parseVtuNumericDataArray(pointsArray, pointCount * pointComponentCount, "VTU Points");
    for (let index = 0; index < pointCount; index += 1) {
      const base = index * pointComponentCount;
      const point: Point = pointComponentCount === 2
        ? [
          pointValues[base]!,
          pointValues[base + 1]!
        ]
        : [
          pointValues[base]!,
          pointValues[base + 1]!,
          pointValues[base + 2]!
        ];
      nodes.push(point);
    }

    const cellsSection = matchXmlSection(pieceText, "Cells", "VTU import could not find a Cells section");
    const connectivityArray = matchVtuDataArray(cellsSection, (dataAttrs) => equalsIgnoreCase(dataAttrs.Name, "connectivity"), "VTU Cells connectivity");
    const offsetsArray = matchVtuDataArray(cellsSection, (dataAttrs) => equalsIgnoreCase(dataAttrs.Name, "offsets"), "VTU Cells offsets");
    const typesArray = matchVtuDataArray(cellsSection, (dataAttrs) => equalsIgnoreCase(dataAttrs.Name, "types"), "VTU Cells types");

    const offsets = parseVtuNumericDataArray(offsetsArray, cellCount, "VTU Cells offsets");
    const connectivityCountValue = offsets[offsets.length - 1];
    if (connectivityCountValue === undefined || !Number.isInteger(connectivityCountValue) || connectivityCountValue < 0) {
      throw new Error("VTU Cells offsets must end with a non-negative integer");
    }
    const connectivityCount: number = connectivityCountValue;
    const connectivity = parseVtuNumericDataArray(connectivityArray, connectivityCount, "VTU Cells connectivity");
    const types = parseVtuNumericDataArray(typesArray, cellCount, "VTU Cells types");
    const uniqueCellTypes = [...new Set(types)];
    if (uniqueCellTypes.length !== 1) {
      throw new Error(`VTU import only supports pure meshes. Found mixed cell types: ${uniqueCellTypes.join(", ")}`);
    }

    const vtkCellType = uniqueCellTypes[0];
    const pieceKind = vtkCellType === 9
      ? "Q1"
      : vtkCellType === 12
        ? "H1"
        : undefined;
    if (!pieceKind) {
      throw new Error(`VTU import only supports VTK cell types 9 (QUAD) and 12 (HEXAHEDRON), got ${vtkCellType}`);
    }
    if (inferredKind && inferredKind !== pieceKind) {
      throw new Error(`VTU import only supports pure meshes. Found mixed element kinds: ${inferredKind} and ${pieceKind}`);
    }
    inferredKind = pieceKind;

    const expectedNodeCount = pieceKind === "Q1" ? 4 : 8;
    let previousOffset = 0;
    for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
      const nextOffset = offsets[cellIndex]!;
      if (!Number.isInteger(nextOffset) || nextOffset < previousOffset) {
        throw new Error(`VTU cell ${cellIndex + 1} has an invalid offset ${nextOffset}`);
      }
      const cellConnectivity = connectivity.slice(previousOffset, nextOffset);
      if (cellConnectivity.length !== expectedNodeCount) {
        throw new Error(`VTU ${pieceKind} import expected ${expectedNodeCount} nodes per element, got ${cellConnectivity.length} at element ${cellIndex + 1}`);
      }
      const element = cellConnectivity.map((nodeId) => {
        if (!Number.isInteger(nodeId) || nodeId < 0 || nodeId >= pointCount) {
          throw new Error(`VTU element ${cellIndex + 1} references invalid point ${nodeId}`);
        }
        return nodeOffset + nodeId + 1;
      });
      validateElementNodeIds(element, cellIndex + 1);
      elements.push(element);
      previousOffset = nextOffset;
    }
  }

  if (!inferredKind || nodes.length === 0 || elements.length === 0) {
    throw new Error("VTU import did not contain any supported nodes or elements");
  }

  return meshFromSerializable({ kind: inferredKind, nodes, elements });
}

export function parseAbaqusInpMesh(text: string): Mesh {
  const lines = normalizeImportText(text).split("\n");
  const nodesByExternalId = new Map<number, Point>();
  const elementsByExternalId: number[][] = [];
  let section: "none" | "node" | "element" = "none";
  let expectedNodeCount: number | undefined;
  let pendingElementFields: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const line = rawLine.trim();
    if (!line || line.startsWith("**")) {
      continue;
    }
    if (line.startsWith("*")) {
      pendingElementFields = [];
      if (/^\*NODE\b/i.test(line)) {
        section = "node";
        expectedNodeCount = undefined;
        continue;
      }
      if (/^\*ELEMENT\b/i.test(line)) {
        section = "element";
        expectedNodeCount = inferAbaqusElementNodeCount(line);
        continue;
      }
      section = "none";
      expectedNodeCount = undefined;
      continue;
    }

    if (section === "node") {
      const fields = splitDelimitedRecord(rawLine);
      if (fields.length < 3) {
        throw new Error(`Abaqus *Node record on line ${index + 1} must contain node id and at least two coordinates`);
      }
      const nodeId = parsePositiveInteger(fields[0], `Abaqus node id on line ${index + 1}`);
      if (nodesByExternalId.has(nodeId)) {
        throw new Error(`Abaqus import found duplicate node id ${nodeId}`);
      }
      const point = parsePointFields(fields.slice(1), `Abaqus node ${nodeId}`, 2, 3);
      nodesByExternalId.set(nodeId, point);
      continue;
    }

    if (section === "element") {
      pendingElementFields.push(...splitDelimitedRecord(rawLine));
      const resolvedNodeCount = expectedNodeCount ?? inferConnectivityNodeCountFromFieldCount(
        pendingElementFields.length,
        "Abaqus *Element"
      );
      if (pendingElementFields.length < resolvedNodeCount + 1) {
        continue;
      }
      if (pendingElementFields.length > resolvedNodeCount + 1) {
        throw new Error(`Abaqus *Element record on line ${index + 1} has too many fields for a ${resolvedNodeCount}-node element`);
      }
      parseExternalElementRecord(
        pendingElementFields,
        resolvedNodeCount,
        `Abaqus element on line ${index + 1}`,
        elementsByExternalId
      );
      pendingElementFields = [];
    }
  }

  if (pendingElementFields.length > 0) {
    throw new Error("Abaqus import ended with an incomplete *Element record");
  }

  return buildMeshFromExternalRecords(nodesByExternalId, elementsByExternalId, "Abaqus INP");
}

export function parseLsdynaKeywordMesh(text: string): Mesh {
  const lines = normalizeImportText(text).split("\n");
  const nodesByExternalId = new Map<number, Point>();
  const elementsByExternalId: number[][] = [];
  let section: "none" | "node" | "shell" | "solid" = "none";
  let pendingElementFields: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const line = rawLine.trim();
    if (!line || line.startsWith("$")) {
      continue;
    }
    if (line.startsWith("*")) {
      pendingElementFields = [];
      if (/^\*NODE\b/i.test(line)) {
        section = "node";
        continue;
      }
      if (/^\*ELEMENT_SHELL\b/i.test(line)) {
        section = "shell";
        continue;
      }
      if (/^\*ELEMENT_SOLID\b/i.test(line)) {
        section = "solid";
        continue;
      }
      section = "none";
      continue;
    }

    if (section === "node") {
      const fields = splitDelimitedRecord(rawLine);
      if (fields.length < 4) {
        throw new Error(`LS-DYNA *NODE record on line ${index + 1} must contain node id and three coordinates`);
      }
      const nodeId = parsePositiveInteger(fields[0], `LS-DYNA node id on line ${index + 1}`);
      if (nodesByExternalId.has(nodeId)) {
        throw new Error(`LS-DYNA import found duplicate node id ${nodeId}`);
      }
      const point = parsePointFields(fields.slice(1), `LS-DYNA node ${nodeId}`, 3, 3);
      nodesByExternalId.set(nodeId, point);
      continue;
    }

    if (section === "shell" || section === "solid") {
      const expected = section === "shell" ? 4 : 8;
      pendingElementFields.push(...splitDelimitedRecord(rawLine));
      if (pendingElementFields.length < expected + 2) {
        continue;
      }
      if (pendingElementFields.length > expected + 2) {
        throw new Error(`LS-DYNA ${section === "shell" ? "*ELEMENT_SHELL" : "*ELEMENT_SOLID"} record on line ${index + 1} has too many fields`);
      }
      parseExternalElementRecord(
        pendingElementFields.slice(0, 1).concat(pendingElementFields.slice(2)),
        expected,
        `LS-DYNA element on line ${index + 1}`,
        elementsByExternalId
      );
      pendingElementFields = [];
    }
  }

  if (pendingElementFields.length > 0) {
    throw new Error("LS-DYNA import ended with an incomplete element record");
  }

  return buildMeshFromExternalRecords(nodesByExternalId, elementsByExternalId, "LS-DYNA keyword");
}

export function meshFromSerializable(value: unknown): Mesh {
  const object = readObject(value);
  const rawNodes = readArray(object.nodes, "mesh.nodes must be an array");
  const rawElements = readArray(object.elements, "mesh.elements must be an array");

  if (rawNodes.length === 0) {
    throw new Error("mesh.nodes must contain at least one node");
  }
  if (rawElements.length === 0) {
    throw new Error("mesh.elements must contain at least one element");
  }

  const firstElement = readElement(rawElements[0], 1, undefined, rawNodes.length);
  const inferredKind = elementKindFromNodeCount(firstElement.length);
  const explicitKind = readKind(object.kind);
  const kind = explicitKind ?? inferredKind;

  if (explicitKind && explicitKind !== inferredKind) {
    throw new Error(`mesh.kind ${explicitKind} does not match ${firstElement.length}-node elements`);
  }

  const nodes = rawNodes.map((node, index) => readPoint(node, kind, index + 1));
  const elements = rawElements.map((element, index) => readElement(element, index + 1, kind, nodes.length));

  return { kind, nodes, elements };
}

function readKind(value: unknown): ElementKind | undefined {
  if (value === "Q1" || value === "H1") {
    return value;
  }
  return undefined;
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readArray(value: unknown, error: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(error);
  }
  return value;
}

function readPoint(value: unknown, kind: ElementKind, nodeId: number): Point {
  if (!Array.isArray(value)) {
    throw new Error(`node ${nodeId} must be an array of coordinates`);
  }

  const requiredDimension = kind === "H1" ? 3 : 2;
  if (value.length < requiredDimension) {
    throw new Error(`node ${nodeId} must contain at least ${requiredDimension} coordinates`);
  }

  const coords = value
    .slice(0, Math.min(3, value.length))
    .map((coordinate) => typeof coordinate === "number" ? coordinate : Number(coordinate));

  if (!coords.every((coordinate) => Number.isFinite(coordinate))) {
    throw new Error(`node ${nodeId} contains a non-finite coordinate`);
  }

  return coords;
}

function readElement(
  value: unknown,
  elementId: number,
  kind: ElementKind | undefined,
  nodeCount: number
): number[] {
  if (!Array.isArray(value)) {
    throw new Error(`element ${elementId} must be an array of node ids`);
  }

  const element = value.map((nodeId) => typeof nodeId === "number" ? nodeId : Number(nodeId));
  if (!element.every((nodeId) => Number.isInteger(nodeId) && nodeId > 0)) {
    throw new Error(`element ${elementId} contains an invalid node id`);
  }

  const inferredKind = elementKindFromNodeCount(element.length);
  if (kind && inferredKind !== kind) {
    throw new Error(`element ${elementId} has ${element.length} nodes but mesh kind is ${kind}`);
  }

  for (const nodeId of element) {
    if (nodeId > nodeCount) {
      throw new Error(`element ${elementId} references missing node ${nodeId}`);
    }
  }

  validateElementNodeIds(element, elementId);
  return element;
}

function validateElementNodeIds(element: readonly number[], elementId: number): void {
  if (new Set(element).size !== element.length) {
    throw new Error(`element ${elementId} repeats one or more node ids`);
  }
}

function skipBlankLines(lines: readonly string[], start: number): number {
  let index = start;
  while (index < lines.length && lines[index]!.trim() === "") {
    index += 1;
  }
  return index;
}

function consumeNumericValues(
  lines: readonly string[],
  startIndex: number,
  count: number,
  sectionName: string
): { values: number[]; nextIndex: number } {
  const values: number[] = [];
  let index = startIndex;

  while (index < lines.length && values.length < count) {
    const line = lines[index]!;
    index += 1;
    if (line.trim() === "") {
      continue;
    }
    const parts = line.trim().split(/\s+/);
    for (const part of parts) {
      const value = Number(part);
      if (!Number.isFinite(value)) {
        throw new Error(`VTK ${sectionName} section contains a non-numeric value '${part}'`);
      }
      values.push(value);
      if (values.length === count) {
        break;
      }
    }
  }

  if (values.length !== count) {
    throw new Error(`VTK ${sectionName} section is truncated: expected ${count} numeric values, got ${values.length}`);
  }

  return { values, nextIndex: index };
}

function detectMeshImportFormat(text: string, fileName = ""): MeshImportFormat | undefined {
  const normalized = normalizeImportText(text);
  const trimmed = normalized.trimStart();
  const lowerFileName = fileName.toLowerCase();

  if (lowerFileName.endsWith(".vtk")) {
    return "vtk";
  }
  if (lowerFileName.endsWith(".vtu")) {
    return "vtu";
  }
  if (lowerFileName.endsWith(".inp")) {
    return "inp";
  }
  if (lowerFileName.endsWith(".k") || lowerFileName.endsWith(".key")) {
    return "k";
  }
  if (lowerFileName.endsWith(".json")) {
    return "json";
  }

  if (/^#\s*vtk\b/i.test(trimmed)) {
    return "vtk";
  }
  if (/^<\?xml\b/i.test(trimmed) || /^<VTKFile\b/i.test(trimmed)) {
    if (/\bUnstructuredGrid\b/i.test(normalized)) {
      return "vtu";
    }
  }
  if ((/^\*KEYWORD\b/im.test(normalized) || /^\*ELEMENT_(?:SHELL|SOLID)\b/im.test(normalized)) && /^\*NODE\b/im.test(normalized)) {
    return "k";
  }
  if (/^\*ELEMENT\b/im.test(normalized) && /^\*NODE\b/im.test(normalized)) {
    return "inp";
  }
  if (/^[\[{]/.test(trimmed)) {
    return "json";
  }
  return undefined;
}

function parseMeshByFormat(text: string, format: MeshImportFormat): Mesh {
  switch (format) {
    case "json":
      return parseMeshJSON(text);
    case "vtk":
      return parseLegacyVtkMesh(text);
    case "vtu":
      return parseVtuMesh(text);
    case "inp":
      return parseAbaqusInpMesh(text);
    case "k":
      return parseLsdynaKeywordMesh(text);
  }
}

function normalizeImportText(text: string): string {
  return text.replace(/^\uFEFF/, "").replace(/\r/g, "");
}

function inferAbaqusElementNodeCount(line: string): number | undefined {
  const typeMatch = line.match(/\btype\s*=\s*([^,\s]+)/i);
  const type = typeMatch?.[1]?.toUpperCase();
  if (!type) {
    return undefined;
  }
  if (/^(C3D8|DC3D8|AC3D8|SC8)/.test(type)) {
    return 8;
  }
  if (/^(CPS4|CPE4|CAX4|S4|M3D4|R3D4|DS4|COH2D4)/.test(type)) {
    return 4;
  }
  return undefined;
}

function inferConnectivityNodeCountFromFieldCount(fieldCount: number, label: string): number {
  if (fieldCount === 5) {
    return 4;
  }
  if (fieldCount === 9) {
    return 8;
  }
  throw new Error(`${label} only supports 4-node quad/shell or 8-node hex/solid elements`);
}

function parseExternalElementRecord(
  fields: readonly string[],
  nodeCount: number,
  label: string,
  elements: number[][]
): void {
  if (fields.length !== nodeCount + 1) {
    throw new Error(`${label} expected ${nodeCount + 1} fields, got ${fields.length}`);
  }
  parsePositiveInteger(fields[0], `${label} id`);
  const connectivity = fields
    .slice(1)
    .map((nodeId, index) => parsePositiveInteger(nodeId, `${label} node ${index + 1}`));
  validateElementNodeIds(connectivity, elements.length + 1);
  elements.push(connectivity);
}

function buildMeshFromExternalRecords(
  nodesByExternalId: ReadonlyMap<number, Point>,
  externalElements: readonly number[][],
  label: string
): Mesh {
  if (nodesByExternalId.size === 0) {
    throw new Error(`${label} import did not contain any nodes`);
  }
  if (externalElements.length === 0) {
    throw new Error(`${label} import did not contain any supported elements`);
  }

  const nodes: Point[] = [];
  const nodeIdByExternalId = new Map<number, number>();
  for (const [externalId, point] of nodesByExternalId) {
    nodeIdByExternalId.set(externalId, nodes.length + 1);
    nodes.push(point);
  }

  const firstKind = elementKindFromNodeCount(externalElements[0]!.length);
  const elements = externalElements.map((element, index) => {
    const kind = elementKindFromNodeCount(element.length);
    if (kind !== firstKind) {
      throw new Error(`${label} import only supports pure meshes. Element ${index + 1} has ${element.length} nodes while the first element has ${externalElements[0]!.length}`);
    }
    return element.map((externalNodeId) => {
      const nodeId = nodeIdByExternalId.get(externalNodeId);
      if (nodeId === undefined) {
        throw new Error(`${label} element ${index + 1} references missing node ${externalNodeId}`);
      }
      return nodeId;
    });
  });

  return meshFromSerializable({
    kind: firstKind,
    nodes,
    elements
  });
}

function splitDelimitedRecord(line: string): string[] {
  return line
    .trim()
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parsePointFields(
  fields: readonly string[],
  label: string,
  minDimension: 2 | 3,
  maxDimension: 3
): Point {
  if (fields.length < minDimension) {
    throw new Error(`${label} must contain at least ${minDimension} coordinates`);
  }
  const coords = fields
    .slice(0, Math.min(maxDimension, fields.length))
    .map((value) => parseFiniteNumber(value, `${label} coordinate`));
  if (coords.length === 2) {
    return [coords[0]!, coords[1]!];
  }
  return [coords[0]!, coords[1]!, coords[2]!];
}

function parsePositiveInteger(value: string | undefined, label: string): number {
  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue <= 0) {
    throw new Error(`${label} must be a positive integer, got '${value ?? ""}'`);
  }
  return numericValue;
}

function parseFiniteNumber(value: string | undefined, label: string): number {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    throw new Error(`${label} must be a finite number, got '${value ?? ""}'`);
  }
  return numericValue;
}

function matchXmlSection(text: string, tagName: string, errorMessage: string): string {
  const match = text.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  if (!match) {
    throw new Error(errorMessage);
  }
  return match[1] ?? "";
}

function matchVtuDataArray(
  text: string,
  predicate: (attributes: Record<string, string>) => boolean,
  label: string
): { attrs: Record<string, string>; body: string } {
  const matches = [...text.matchAll(/<DataArray\b([^>]*)>([\s\S]*?)<\/DataArray>/gi)];
  for (const match of matches) {
    const attrs = readXmlAttributes(match[1] ?? "");
    if (predicate(attrs)) {
      return {
        attrs,
        body: match[2] ?? ""
      };
    }
  }
  throw new Error(`${label} section is missing a matching DataArray`);
}

function readXmlAttributes(text: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of text.matchAll(/([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*["']([^"']*)["']/g)) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) {
      attributes[key] = value;
    }
  }
  return attributes;
}

function readRequiredIntegerAttribute(attributes: Record<string, string>, name: string, label: string): number {
  const value = Number(attributes[name]);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} is missing a valid ${name} attribute`);
  }
  return value;
}

function parseVtuNumericDataArray(
  array: { attrs: Record<string, string>; body: string },
  expectedCount: number,
  label: string
): number[] {
  const format = (array.attrs.format ?? "ascii").toLowerCase();
  if (format !== "ascii") {
    throw new Error(`${label} only supports ASCII DataArray content`);
  }
  const values = array.body
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => {
      const value = Number(part);
      if (!Number.isFinite(value)) {
        throw new Error(`${label} contains a non-numeric value '${part}'`);
      }
      return value;
    });
  if (values.length !== expectedCount) {
    throw new Error(`${label} expected ${expectedCount} numeric values, got ${values.length}`);
  }
  return values;
}

function equalsIgnoreCase(value: string | undefined, expected: string): boolean {
  return (value ?? "").toLowerCase() === expected.toLowerCase();
}
