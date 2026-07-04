import { inferMeshKind } from "./mesh.js";
const H1_EXPORT_EDGES = [
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 1],
    [5, 6],
    [6, 7],
    [7, 8],
    [8, 5],
    [1, 5],
    [2, 6],
    [3, 7],
    [4, 8]
];
export function exportKindOptionsForMeshKind(kind) {
    return kind === "Q1"
        ? ["Q4", "T3", "Q9"]
        : ["H8", "H20"];
}
export function normalizeExportKind(meshKind, requested) {
    if (meshKind === "Q1") {
        if (requested === "T3" || requested === "Q9" || requested === "Q4") {
            return requested;
        }
        return "Q4";
    }
    if (requested === "H20") {
        return "H20";
    }
    return "H8";
}
export function prepareExportMesh(exported, requestedKind) {
    const meshKind = inferMeshKind(exported.mesh);
    const exportKind = normalizeExportKind(meshKind, requestedKind);
    const converted = convertMeshForExport(exported.mesh, exportKind);
    return {
        mesh: converted.mesh,
        sourceElementIds: converted.sourceElementIds,
        sets: remapExportSets(exported.sets, converted.sourceElementIds)
    };
}
export function convertMeshForExport(mesh, requestedKind) {
    const meshKind = inferMeshKind(mesh);
    const exportKind = normalizeExportKind(meshKind, requestedKind);
    if (exportKind === "Q4") {
        return {
            mesh: { kind: "Q4", nodes: mesh.nodes, elements: mesh.elements },
            sourceElementIds: sequence(mesh.elements.length)
        };
    }
    if (exportKind === "H8") {
        return {
            mesh: { kind: "H8", nodes: mesh.nodes, elements: mesh.elements },
            sourceElementIds: sequence(mesh.elements.length)
        };
    }
    if (exportKind === "T3") {
        return convertQuadMeshToTriangles(mesh);
    }
    if (exportKind === "Q9") {
        return elevateQuadMeshToQ9(mesh);
    }
    return elevateHexMeshToH20(mesh);
}
export function buildNativeSessionExportPlan(session, options = {}) {
    const kind = session.kind === "Q1" ? "Q4" : "H8";
    const activeCellIds = [...session.activeLeafIds]
        .sort((a, b) => (session.cells.get(a)?.ordinal ?? 0) - (session.cells.get(b)?.ordinal ?? 0));
    const nodes = [];
    const nodeIdBySessionNodeId = new Map();
    const exactNodeIdByKey = new Map();
    const tolerance = Math.max(0, options.mergeTolerance ?? 0);
    const toleranceSquared = tolerance * tolerance;
    const buckets = tolerance > 0 ? new Map() : undefined;
    for (const cellId of activeCellIds) {
        const cell = session.cells.get(cellId);
        if (!cell || !cell.active || cell.hidden) {
            continue;
        }
        for (const sessionNodeId of cell.element) {
            if (nodeIdBySessionNodeId.has(sessionNodeId)) {
                continue;
            }
            const point = session.nodes[sessionNodeId - 1];
            if (!point) {
                throw new Error(`active cell ${cellId} references missing node ${sessionNodeId}`);
            }
            let nodeId;
            if (tolerance === 0) {
                const key = exactPointKey(point);
                nodeId = exactNodeIdByKey.get(key);
                if (nodeId === undefined) {
                    nodeId = nodes.length + 1;
                    nodes.push(point);
                    exactNodeIdByKey.set(key, nodeId);
                }
            }
            else {
                nodeId = findNativeExportNodeId(point, nodes, buckets, tolerance, toleranceSquared);
                if (nodeId === undefined) {
                    nodeId = nodes.length + 1;
                    nodes.push(point);
                    addNativeExportBucket(point, nodeId, buckets, tolerance);
                }
            }
            nodeIdBySessionNodeId.set(sessionNodeId, nodeId);
        }
    }
    return {
        kind,
        session,
        activeCellIds,
        nodes,
        nodeIdBySessionNodeId,
        sets: remapNativeSessionSets(activeCellIds, nodeIdBySessionNodeId, options.sets ?? {})
    };
}
export function* iterateLegacyVtkLines(mesh, options = {}) {
    const spec = vtkCellSpec(mesh);
    const title = sanitizeTitle(options.title ?? "HexRefine mesh");
    const scalarEntries = Object.entries(options.cellScalars ?? {});
    for (const [name, values] of scalarEntries) {
        if (values.length !== mesh.elements.length) {
            throw new Error(`cell scalar ${name} has ${values.length} values, expected ${mesh.elements.length}`);
        }
    }
    yield "# vtk DataFile Version 3.0";
    yield title;
    yield "ASCII";
    yield "DATASET UNSTRUCTURED_GRID";
    yield `POINTS ${mesh.nodes.length} double`;
    for (const point of mesh.nodes) {
        yield formatPoint3(point);
    }
    const cellIntCount = mesh.elements.reduce((total, element) => total + element.length + 1, 0);
    yield `CELLS ${mesh.elements.length} ${cellIntCount}`;
    for (const element of mesh.elements) {
        if (element.length !== spec.expectedNodeCount) {
            throw new Error(`VTK export expected ${spec.expectedNodeCount}-node elements for ${spec.kind}, got ${element.length}`);
        }
        yield `${element.length} ${element.map((nodeId) => nodeId - 1).join(" ")}`;
    }
    yield `CELL_TYPES ${mesh.elements.length}`;
    for (let i = 0; i < mesh.elements.length; i += 1) {
        yield String(spec.vtkCellType);
    }
    if (scalarEntries.length > 0) {
        yield `CELL_DATA ${mesh.elements.length}`;
        for (const [name, values] of scalarEntries) {
            yield `SCALARS ${sanitizeName(name)} double 1`;
            yield "LOOKUP_TABLE default";
            for (const value of values) {
                yield formatNumber(value);
            }
        }
    }
}
export function* iterateNativeSessionVtkLines(plan, options = {}) {
    const spec = nativeSessionVtkSpec(plan.kind);
    const title = sanitizeTitle(options.title ?? "HexRefine mesh");
    const scalarEntries = Object.entries(options.cellScalars ?? {});
    for (const [name, values] of scalarEntries) {
        if (values.length !== plan.activeCellIds.length) {
            throw new Error(`cell scalar ${name} has ${values.length} values, expected ${plan.activeCellIds.length}`);
        }
    }
    yield "# vtk DataFile Version 3.0";
    yield title;
    yield "ASCII";
    yield "DATASET UNSTRUCTURED_GRID";
    yield `POINTS ${plan.nodes.length} double`;
    for (const point of plan.nodes) {
        yield formatPoint3(point);
    }
    yield `CELLS ${plan.activeCellIds.length} ${plan.activeCellIds.length * (spec.expectedNodeCount + 1)}`;
    for (const cellId of plan.activeCellIds) {
        const element = nativeSessionMappedElement(plan, cellId, spec.expectedNodeCount);
        yield `${element.length} ${element.map((nodeId) => nodeId - 1).join(" ")}`;
    }
    yield `CELL_TYPES ${plan.activeCellIds.length}`;
    for (let index = 0; index < plan.activeCellIds.length; index += 1) {
        yield String(spec.vtkCellType);
    }
    if (scalarEntries.length > 0) {
        yield `CELL_DATA ${plan.activeCellIds.length}`;
        for (const [name, values] of scalarEntries) {
            yield `SCALARS ${sanitizeName(name)} double 1`;
            yield "LOOKUP_TABLE default";
            for (const value of values) {
                yield formatNumber(value);
            }
        }
    }
}
export function meshToLegacyVtk(mesh, options = {}) {
    let text = "";
    for (const line of iterateLegacyVtkLines(mesh, options)) {
        text += `${line}\n`;
    }
    return text;
}
export function refinementSessionExportToInp(exported, options = {}) {
    return preparedExportToInp(prepareExportMesh(exported, options.elementKind), options);
}
export function preparedExportToInp(prepared, options = {}) {
    let text = "";
    for (const line of iteratePreparedInpLines(prepared, options)) {
        text += `${line}\n`;
    }
    return text;
}
export function* iterateNativeSessionInpLines(plan, options = {}) {
    const materialBySet = normalizeMaterialEntries(options.materials);
    const spec = nativeSessionVtkSpec(plan.kind);
    const elements = plan.activeCellIds.map((cellId) => nativeSessionMappedElement(plan, cellId, spec.expectedNodeCount));
    const sets = withAutomaticBoundarySetsForInp({
        kind: plan.kind,
        nodes: plan.nodes,
        elements
    }, plan.sets, options);
    yield "*Heading";
    yield sanitizeTitle(options.title ?? "HexRefine mesh");
    yield "*Node";
    for (let index = 0; index < plan.nodes.length; index += 1) {
        const point = toPoint3(plan.nodes[index]);
        yield `${index + 1}, ${formatInpNumber(point[0])}, ${formatInpNumber(point[1])}, ${formatInpNumber(point[2])}`;
    }
    yield `*Element, type=${inpElementType(plan.kind)}`;
    for (let index = 0; index < elements.length; index += 1) {
        yield `${index + 1}, ${elements[index].join(", ")}`;
    }
    yield* iterateInpSets("Nset", sets.nodeSets);
    yield* iterateInpSets("Elset", sets.cellSets);
    for (const [setName] of sets.cellSets) {
        const material = materialBySet.get(setName);
        if (!material) {
            continue;
        }
        const materialName = sanitizeSetName(material.name);
        yield `*Solid Section, elset=${sanitizeSetName(setName)}, material=${materialName}`;
        yield ",";
        yield `*Material, name=${materialName}`;
        yield "*Elastic";
        yield `${formatInpNumber(material.elasticModulus ?? 1)}, ${formatInpNumber(material.poissonRatio ?? 0.3)}`;
    }
}
export function* iteratePreparedInpLines(prepared, options = {}) {
    const elementKind = prepared.mesh.kind;
    const materialBySet = normalizeMaterialEntries(options.materials);
    const sets = withAutomaticBoundarySetsForInp(prepared.mesh, prepared.sets, options);
    yield "*Heading";
    yield sanitizeTitle(options.title ?? "HexRefine mesh");
    yield "*Node";
    for (let index = 0; index < prepared.mesh.nodes.length; index += 1) {
        const point = toPoint3(prepared.mesh.nodes[index]);
        yield `${index + 1}, ${formatInpNumber(point[0])}, ${formatInpNumber(point[1])}, ${formatInpNumber(point[2])}`;
    }
    yield `*Element, type=${inpElementType(elementKind)}`;
    for (let index = 0; index < prepared.mesh.elements.length; index += 1) {
        yield `${index + 1}, ${prepared.mesh.elements[index].join(", ")}`;
    }
    yield* iterateInpSets("Nset", sets.nodeSets);
    yield* iterateInpSets("Elset", sets.cellSets);
    for (const [setName] of sets.cellSets) {
        const material = materialBySet.get(setName);
        if (!material) {
            continue;
        }
        const materialName = sanitizeSetName(material.name);
        yield `*Solid Section, elset=${sanitizeSetName(setName)}, material=${materialName}`;
        yield ",";
        yield `*Material, name=${materialName}`;
        yield "*Elastic";
        yield `${formatInpNumber(material.elasticModulus ?? 1)}, ${formatInpNumber(material.poissonRatio ?? 0.3)}`;
    }
}
export function missingSetSummary(sets) {
    return {
        missingCells: [...sets.missingCellIdsBySet].reduce((total, [, ids]) => total + ids.length, 0),
        missingNodes: [...sets.missingNodeIdsBySet].reduce((total, [, ids]) => total + ids.length, 0)
    };
}
function convertQuadMeshToTriangles(mesh) {
    const kind = inferMeshKind(mesh);
    if (kind !== "Q1") {
        throw new Error("T3 export conversion requires a Q1 mesh");
    }
    const elements = [];
    const sourceElementIds = [];
    mesh.elements.forEach((element, index) => {
        const [n1, n2, n3, n4] = element;
        elements.push([n1, n2, n3], [n1, n3, n4]);
        sourceElementIds.push(index + 1, index + 1);
    });
    return {
        mesh: {
            kind: "T3",
            nodes: clonePoints(mesh.nodes),
            elements
        },
        sourceElementIds
    };
}
function elevateQuadMeshToQ9(mesh) {
    const kind = inferMeshKind(mesh);
    if (kind !== "Q1") {
        throw new Error("Q9 export conversion requires a Q1 mesh");
    }
    const nodes = clonePoints(mesh.nodes);
    const edgeNodeByKey = new Map();
    const elements = [];
    const sourceElementIds = [];
    mesh.elements.forEach((element, index) => {
        const [n1, n2, n3, n4] = element;
        const mids = [
            midEdgeNodeId(nodes, mesh.nodes, edgeNodeByKey, n1, n2),
            midEdgeNodeId(nodes, mesh.nodes, edgeNodeByKey, n2, n3),
            midEdgeNodeId(nodes, mesh.nodes, edgeNodeByKey, n3, n4),
            midEdgeNodeId(nodes, mesh.nodes, edgeNodeByKey, n4, n1)
        ];
        const centerId = appendPoint(nodes, averagePoints([
            mesh.nodes[n1 - 1],
            mesh.nodes[n2 - 1],
            mesh.nodes[n3 - 1],
            mesh.nodes[n4 - 1]
        ]));
        elements.push([n1, n2, n3, n4, mids[0], mids[1], mids[2], mids[3], centerId]);
        sourceElementIds.push(index + 1);
    });
    return {
        mesh: { kind: "Q9", nodes, elements },
        sourceElementIds
    };
}
function elevateHexMeshToH20(mesh) {
    const kind = inferMeshKind(mesh);
    if (kind !== "H1") {
        throw new Error("H20 export conversion requires an H1 mesh");
    }
    const nodes = clonePoints(mesh.nodes);
    const edgeNodeByKey = new Map();
    const elements = [];
    const sourceElementIds = [];
    mesh.elements.forEach((element, index) => {
        const mids = H1_EXPORT_EDGES.map(([a, b]) => midEdgeNodeId(nodes, mesh.nodes, edgeNodeByKey, element[a - 1], element[b - 1]));
        elements.push([...element, ...mids]);
        sourceElementIds.push(index + 1);
    });
    return {
        mesh: { kind: "H20", nodes, elements },
        sourceElementIds
    };
}
function remapExportSets(sets, sourceElementIds) {
    const exportedElementIdsBySource = new Map();
    sourceElementIds.forEach((sourceElementId, index) => {
        let ids = exportedElementIdsBySource.get(sourceElementId);
        if (!ids) {
            ids = [];
            exportedElementIdsBySource.set(sourceElementId, ids);
        }
        ids.push(index + 1);
    });
    const cellSets = new Map();
    for (const [name, ids] of sets.cellSets) {
        const expanded = [];
        for (const sourceId of ids) {
            expanded.push(...(exportedElementIdsBySource.get(sourceId) ?? []));
        }
        cellSets.set(name, uniqueSortedNumbers(expanded));
    }
    return {
        cellSets,
        nodeSets: cloneNumberMap(sets.nodeSets),
        missingCellIdsBySet: cloneGenericMap(sets.missingCellIdsBySet),
        missingNodeIdsBySet: cloneNumberMap(sets.missingNodeIdsBySet)
    };
}
function vtkCellSpec(mesh) {
    const kind = exportMeshKind(mesh);
    switch (kind) {
        case "T3":
            return { kind, vtkCellType: 5, expectedNodeCount: 3 };
        case "Q4":
            return { kind, vtkCellType: 9, expectedNodeCount: 4 };
        case "Q9":
            return { kind, vtkCellType: 28, expectedNodeCount: 9 };
        case "H8":
            return { kind, vtkCellType: 12, expectedNodeCount: 8 };
        case "H20":
            return { kind, vtkCellType: 25, expectedNodeCount: 20 };
    }
}
function exportMeshKind(mesh) {
    if (mesh.kind === "T3" || mesh.kind === "Q4" || mesh.kind === "Q9" || mesh.kind === "H8" || mesh.kind === "H20") {
        return mesh.kind;
    }
    const inferred = inferMeshKind(mesh);
    return inferred === "Q1" ? "Q4" : "H8";
}
function inpElementType(kind) {
    switch (kind) {
        case "T3": return "CPS3";
        case "Q4": return "CPS4";
        case "Q9": return "CPS9";
        case "H8": return "C3D8";
        case "H20": return "C3D20";
    }
}
function midEdgeNodeId(nodes, sourceNodes, edgeNodeByKey, nodeA, nodeB) {
    const key = edgeKey(nodeA, nodeB);
    const existing = edgeNodeByKey.get(key);
    if (existing !== undefined) {
        return existing;
    }
    const point = averagePoints([sourceNodes[nodeA - 1], sourceNodes[nodeB - 1]]);
    const nodeId = appendPoint(nodes, point);
    edgeNodeByKey.set(key, nodeId);
    return nodeId;
}
function edgeKey(a, b) {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
}
function appendPoint(nodes, point) {
    nodes.push(point);
    return nodes.length;
}
function averagePoints(points) {
    const dimension = Math.max(2, ...points.map((point) => Math.min(3, point.length)));
    const sums = [0, 0, 0];
    for (const point of points) {
        sums[0] += point[0] ?? 0;
        sums[1] += point[1] ?? 0;
        sums[2] += point[2] ?? 0;
    }
    const averaged = sums.map((sum) => sum / points.length);
    return averaged.slice(0, dimension);
}
function withAutomaticBoundarySetsForInp(mesh, sets, options) {
    const cellSets = cloneNumberMap(sets.cellSets);
    const nodeSets = cloneNumberMap(sets.nodeSets);
    if (options.includeBoundarySets === false) {
        return { cellSets, nodeSets };
    }
    const boundarySets = buildAutomaticBoundaryInpSets(mesh);
    for (const [name, ids] of boundarySets.cellSets) {
        cellSets.set(uniqueInpSetName(name, cellSets, nodeSets), ids);
    }
    for (const [name, ids] of boundarySets.nodeSets) {
        nodeSets.set(uniqueInpSetName(name, cellSets, nodeSets), ids);
    }
    return { cellSets, nodeSets };
}
function buildAutomaticBoundaryInpSets(mesh) {
    const records = exteriorBoundaryRecords(mesh);
    const recordsBySide = groupBy(records, (record) => record.side);
    const cellSets = new Map();
    const nodeSets = new Map();
    for (const [side, sideRecords] of [...recordsBySide].sort(([a], [b]) => a.localeCompare(b))) {
        const components = connectedBoundaryComponents(sideRecords)
            .sort((a, b) => minimumBoundaryElementId(a) - minimumBoundaryElementId(b));
        components.forEach((component, index) => {
            const suffix = `${side}_${index + 1}`;
            const elementIds = uniqueSortedNumbers(component.map((record) => record.elementId));
            const nodeIds = uniqueSortedNumbers(component.flatMap((record) => record.nodeIds));
            cellSets.set(`AUTO_BND_${suffix}_EL`, elementIds);
            nodeSets.set(`AUTO_BND_${suffix}_N`, nodeIds);
        });
    }
    return { cellSets, nodeSets };
}
function exteriorBoundaryRecords(mesh) {
    const templates = boundaryTemplatesForExportKind(mesh.kind);
    const ownersByKey = new Map();
    mesh.elements.forEach((element, elementIndex) => {
        const elementId = elementIndex + 1;
        const elementCenter = averagePoints(element.map((nodeId) => mesh.nodes[nodeId - 1]));
        for (const template of templates) {
            const matchNodeIds = template.match.map((localIndex) => element[localIndex]);
            const nodeIds = template.nodes.map((localIndex) => element[localIndex]);
            const boundaryCenter = averagePoints(nodeIds.map((nodeId) => mesh.nodes[nodeId - 1]));
            const normal = orientedBoundaryNormal(mesh, element, template, elementCenter, boundaryCenter);
            const side = boundarySideName(normal);
            const key = boundaryKeyFromNodeIds(matchNodeIds);
            const owners = ownersByKey.get(key) ?? [];
            owners.push({ elementId, nodeIds, matchNodeIds, side });
            ownersByKey.set(key, owners);
        }
    });
    const records = [];
    for (const owners of ownersByKey.values()) {
        if (owners.length === 1) {
            records.push(owners[0]);
        }
    }
    return records;
}
function boundaryTemplatesForExportKind(kind) {
    switch (kind) {
        case "T3":
            return [
                { match: [0, 1], nodes: [0, 1] },
                { match: [1, 2], nodes: [1, 2] },
                { match: [2, 0], nodes: [2, 0] }
            ];
        case "Q4":
            return [
                { match: [0, 1], nodes: [0, 1] },
                { match: [1, 2], nodes: [1, 2] },
                { match: [2, 3], nodes: [2, 3] },
                { match: [3, 0], nodes: [3, 0] }
            ];
        case "Q9":
            return [
                { match: [0, 1, 4], nodes: [0, 1, 4] },
                { match: [1, 2, 5], nodes: [1, 2, 5] },
                { match: [2, 3, 6], nodes: [2, 3, 6] },
                { match: [3, 0, 7], nodes: [3, 0, 7] }
            ];
        case "H8":
            return [
                { match: [0, 1, 2, 3], nodes: [0, 1, 2, 3] },
                { match: [4, 5, 6, 7], nodes: [4, 5, 6, 7] },
                { match: [0, 4, 5, 1], nodes: [0, 4, 5, 1] },
                { match: [3, 7, 6, 2], nodes: [3, 7, 6, 2] },
                { match: [1, 5, 6, 2], nodes: [1, 5, 6, 2] },
                { match: [0, 4, 7, 3], nodes: [0, 4, 7, 3] }
            ];
        case "H20":
            return [
                { match: [0, 1, 2, 3, 8, 9, 10, 11], nodes: [0, 1, 2, 3, 8, 9, 10, 11] },
                { match: [4, 5, 6, 7, 12, 13, 14, 15], nodes: [4, 5, 6, 7, 12, 13, 14, 15] },
                { match: [0, 4, 5, 1, 16, 12, 17, 8], nodes: [0, 4, 5, 1, 16, 12, 17, 8] },
                { match: [3, 7, 6, 2, 19, 14, 18, 10], nodes: [3, 7, 6, 2, 19, 14, 18, 10] },
                { match: [1, 5, 6, 2, 17, 13, 18, 9], nodes: [1, 5, 6, 2, 17, 13, 18, 9] },
                { match: [0, 4, 7, 3, 16, 15, 19, 11], nodes: [0, 4, 7, 3, 16, 15, 19, 11] }
            ];
    }
}
function orientedBoundaryNormal(mesh, element, template, elementCenter, boundaryCenter) {
    const points = template.nodes.map((localIndex) => toPoint3(mesh.nodes[element[localIndex] - 1]));
    let normal = points.length <= 3
        ? edgeNormal2(points[0], points[1])
        : faceNormal3(points[0], points[1], points[2]);
    const outward = subtract3(toPoint3(boundaryCenter), toPoint3(elementCenter));
    if (dot3(normal, outward) < 0) {
        normal = [-normal[0], -normal[1], -normal[2]];
    }
    return normal;
}
function boundarySideName(normal) {
    const abs = normal.map((value) => Math.abs(value));
    let axis = 0;
    if (abs[1] > abs[axis]) {
        axis = 1;
    }
    if (abs[2] > abs[axis]) {
        axis = 2;
    }
    return `${["X", "Y", "Z"][axis]}${normal[axis] < 0 ? "MIN" : "MAX"}`;
}
function connectedBoundaryComponents(records) {
    const recordIndicesByNode = new Map();
    records.forEach((record, index) => {
        for (const nodeId of record.matchNodeIds) {
            const indices = recordIndicesByNode.get(nodeId) ?? [];
            indices.push(index);
            recordIndicesByNode.set(nodeId, indices);
        }
    });
    const visited = new Set();
    const components = [];
    for (let start = 0; start < records.length; start += 1) {
        if (visited.has(start)) {
            continue;
        }
        const stack = [start];
        const component = [];
        visited.add(start);
        while (stack.length > 0) {
            const index = stack.pop();
            const record = records[index];
            component.push(record);
            for (const nodeId of record.matchNodeIds) {
                for (const next of recordIndicesByNode.get(nodeId) ?? []) {
                    if (!visited.has(next)) {
                        visited.add(next);
                        stack.push(next);
                    }
                }
            }
        }
        components.push(component);
    }
    return components;
}
function minimumBoundaryElementId(records) {
    return Math.min(...records.map((record) => record.elementId));
}
function uniqueInpSetName(name, cellSets, nodeSets) {
    if (!cellSets.has(name) && !nodeSets.has(name)) {
        return name;
    }
    let index = 2;
    while (cellSets.has(`${name}_${index}`) || nodeSets.has(`${name}_${index}`)) {
        index += 1;
    }
    return `${name}_${index}`;
}
function boundaryKeyFromNodeIds(nodeIds) {
    return [...nodeIds].sort((a, b) => a - b).join(":");
}
function edgeNormal2(a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    return normalize3([dy, -dx, 0]);
}
function faceNormal3(a, b, c) {
    return normalize3(cross3(subtract3(b, a), subtract3(c, a)));
}
function subtract3(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross3(a, b) {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ];
}
function dot3(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function normalize3(vector) {
    const length = Math.hypot(vector[0], vector[1], vector[2]);
    if (length <= 1e-14) {
        return [0, 0, 1];
    }
    return [vector[0] / length, vector[1] / length, vector[2] / length];
}
function groupBy(values, keyOf) {
    const groups = new Map();
    for (const value of values) {
        const key = keyOf(value);
        const group = groups.get(key) ?? [];
        group.push(value);
        groups.set(key, group);
    }
    return groups;
}
function appendInpSets(lines, keyword, sets) {
    for (const [name, ids] of sets) {
        lines.push(`*${keyword}, ${keyword.toLowerCase()}=${sanitizeSetName(name)}`);
        for (const chunk of chunkIds(ids, 16)) {
            lines.push(chunk.join(", "));
        }
    }
}
function* iterateInpSets(keyword, sets) {
    for (const [name, ids] of sets) {
        yield `*${keyword}, ${keyword.toLowerCase()}=${sanitizeSetName(name)}`;
        for (const chunk of chunkIds(ids, 16)) {
            yield chunk.join(", ");
        }
    }
}
function chunkIds(ids, chunkSize) {
    const sorted = [...ids].sort((a, b) => a - b);
    const chunks = [];
    for (let start = 0; start < sorted.length; start += chunkSize) {
        chunks.push(sorted.slice(start, start + chunkSize));
    }
    return chunks;
}
function clonePoints(points) {
    return points.map((point) => [...point]);
}
function cloneNumberMap(map) {
    return new Map([...map].map(([name, ids]) => [name, [...ids]]));
}
function cloneGenericMap(map) {
    return new Map([...map].map(([name, ids]) => [name, [...ids]]));
}
function sequence(length) {
    return Array.from({ length }, (_, index) => index + 1);
}
function uniqueSortedNumbers(values) {
    return [...new Set(values)].sort((a, b) => a - b);
}
function remapNativeSessionSets(activeCellIds, nodeIdBySessionNodeId, sets) {
    const elementIdByCellId = new Map();
    activeCellIds.forEach((cellId, index) => elementIdByCellId.set(cellId, index + 1));
    const cellSets = new Map();
    const nodeSets = new Map();
    const missingCellIdsBySet = new Map();
    const missingNodeIdsBySet = new Map();
    for (const [name, cellIds] of namedSetEntries(sets.cellSets)) {
        const elementIds = [];
        const missingCellIds = [];
        for (const cellId of uniquePreserveOrder(cellIds)) {
            const elementId = elementIdByCellId.get(cellId);
            if (elementId === undefined) {
                missingCellIds.push(cellId);
            }
            else {
                elementIds.push(elementId);
            }
        }
        cellSets.set(name, uniqueSortedNumbers(elementIds));
        if (missingCellIds.length > 0) {
            missingCellIdsBySet.set(name, missingCellIds);
        }
    }
    for (const [name, sessionNodeIds] of namedSetEntries(sets.nodeSets)) {
        const nodeIds = [];
        const missingNodeIds = [];
        for (const sessionNodeId of uniquePreserveOrder(sessionNodeIds)) {
            const nodeId = nodeIdBySessionNodeId.get(sessionNodeId);
            if (nodeId === undefined) {
                missingNodeIds.push(sessionNodeId);
            }
            else {
                nodeIds.push(nodeId);
            }
        }
        nodeSets.set(name, uniqueSortedNumbers(nodeIds));
        if (missingNodeIds.length > 0) {
            missingNodeIdsBySet.set(name, missingNodeIds);
        }
    }
    return {
        cellSets,
        nodeSets,
        missingCellIdsBySet,
        missingNodeIdsBySet
    };
}
function nativeSessionMappedElement(plan, cellId, expectedNodeCount) {
    const cell = plan.session.cells.get(cellId);
    if (!cell) {
        throw new Error(`missing active cell ${cellId}`);
    }
    if (cell.element.length !== expectedNodeCount) {
        throw new Error(`native session export expected ${expectedNodeCount}-node elements for ${plan.kind}, got ${cell.element.length}`);
    }
    return cell.element.map((sessionNodeId) => {
        const nodeId = plan.nodeIdBySessionNodeId.get(sessionNodeId);
        if (nodeId === undefined) {
            throw new Error(`active cell ${cellId} references unmapped node ${sessionNodeId}`);
        }
        return nodeId;
    });
}
function nativeSessionVtkSpec(kind) {
    return kind === "Q4"
        ? { vtkCellType: 9, expectedNodeCount: 4 }
        : { vtkCellType: 12, expectedNodeCount: 8 };
}
function findNativeExportNodeId(point, nodes, buckets, tolerance, toleranceSquared) {
    for (const key of nativeExportCandidateKeys(point, tolerance)) {
        for (const nodeId of buckets.get(key) ?? []) {
            const candidate = nodes[nodeId - 1];
            if (!candidate) {
                continue;
            }
            const dx = (candidate[0] ?? 0) - (point[0] ?? 0);
            const dy = (candidate[1] ?? 0) - (point[1] ?? 0);
            const dz = (candidate[2] ?? 0) - (point[2] ?? 0);
            if (dx * dx + dy * dy + dz * dz <= toleranceSquared) {
                return nodeId;
            }
        }
    }
    return undefined;
}
function addNativeExportBucket(point, nodeId, buckets, tolerance) {
    const key = nativeExportBucketKey(point, tolerance);
    const bucket = buckets.get(key) ?? [];
    bucket.push(nodeId);
    buckets.set(key, bucket);
}
function nativeExportCandidateKeys(point, tolerance) {
    const [i, j, k] = nativeExportBucketCoords(point, tolerance);
    const keys = [];
    for (let dk = -1; dk <= 1; dk += 1) {
        for (let dj = -1; dj <= 1; dj += 1) {
            for (let di = -1; di <= 1; di += 1) {
                keys.push(`${i + di}:${j + dj}:${k + dk}`);
            }
        }
    }
    return keys;
}
function nativeExportBucketKey(point, tolerance) {
    return nativeExportBucketCoords(point, tolerance).join(":");
}
function nativeExportBucketCoords(point, tolerance) {
    return [
        Math.floor((point[0] ?? 0) / tolerance),
        Math.floor((point[1] ?? 0) / tolerance),
        Math.floor((point[2] ?? 0) / tolerance)
    ];
}
function exactPointKey(point) {
    return point.length <= 2
        ? `${point[0] ?? 0}:${point[1] ?? 0}`
        : `${point[0] ?? 0}:${point[1] ?? 0}:${point[2] ?? 0}`;
}
function namedSetEntries(sets) {
    if (!sets) {
        return [];
    }
    return sets instanceof Map ? [...sets.entries()] : Object.entries(sets);
}
function uniquePreserveOrder(values) {
    return [...new Set(values)];
}
function formatPoint3(point) {
    if (point.length !== 2 && point.length !== 3) {
        throw new Error(`VTK export supports 2D or 3D points, got dimension ${point.length}`);
    }
    return [
        formatNumber(point[0] ?? 0),
        formatNumber(point[1] ?? 0),
        formatNumber(point[2] ?? 0)
    ].join(" ");
}
function formatNumber(value) {
    return Number.isInteger(value) ? String(value) : value.toPrecision(15).replace(/0+$/, "").replace(/\.$/, "");
}
function formatInpNumber(value) {
    return Number.isInteger(value) ? String(value) : Number(value).toPrecision(12).replace(/0+$/, "").replace(/\.$/, "");
}
function normalizeMaterialEntries(materials) {
    if (!materials) {
        return new Map();
    }
    return materials instanceof Map ? new Map(materials) : new Map(materials);
}
function sanitizeName(name) {
    return name.replace(/[^A-Za-z0-9_]/g, "_") || "scalar";
}
function sanitizeSetName(name) {
    const clean = String(name || "SET").trim().replace(/[^A-Za-z0-9_+-]/g, "_");
    return clean || "SET";
}
function sanitizeTitle(title) {
    return title.replace(/[\r\n]/g, " ").slice(0, 240);
}
function toPoint3(point) {
    return [point[0] ?? 0, point[1] ?? 0, point[2] ?? 0];
}
