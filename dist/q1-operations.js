import { inferMeshKind, mergeCoincidentNodes } from "./mesh.js";
const q1LocalEdges = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0]
];
export function growQ1BoundaryLayer(mesh, selectedElementIds, options) {
    assertQ1Mesh(mesh);
    const increments = positiveInteger(options.increments, "boundary layer increments");
    const height = finitePositiveNumber(options.height, "boundary layer height");
    const growthRatio = options.growthRatio === undefined ? 1 : finitePositiveNumber(options.growthRatio, "boundary layer growth ratio");
    const nodeArrangement = options.nodeArrangement === undefined ? 1 : finitePositiveNumber(options.nodeArrangement, "boundary layer node arrangement");
    const scaleMode = options.scaleMode ?? "none";
    if (scaleMode !== "none" && scaleMode !== "fit-bounds" && scaleMode !== "preserve-area") {
        throw new Error(`unsupported boundary layer scale mode: ${scaleMode}`);
    }
    const originalBounds = meshBounds2(mesh.nodes);
    const originalArea = q1MeshArea(mesh);
    const selected = new Set(selectedElementIds.filter((elementId) => Number.isInteger(elementId) && elementId > 0));
    if (selected.size === 0) {
        throw new Error("boundary layer grow needs at least one selected Q1 boundary cell");
    }
    const boundaryEdges = selectedBoundaryEdges(mesh, selected);
    if (boundaryEdges.length === 0) {
        throw new Error("selection does not touch any exterior Q1 boundary edge");
    }
    const layerDistances = cumulativeLayerDistances(height, increments, growthRatio);
    const nodes = mesh.nodes.map((point) => [...point]);
    const elements = mesh.elements.map((element) => [...element]);
    const generatedElementIds = [];
    const layerElementIds = Array.from({ length: increments }, () => []);
    const offsetNodeIdByKey = new Map();
    const incidentEdgesByNodeId = new Map();
    for (const edge of boundaryEdges) {
        for (const nodeId of edge.nodeIds) {
            const incident = incidentEdgesByNodeId.get(nodeId) ?? [];
            incident.push(edge);
            incidentEdgesByNodeId.set(nodeId, incident);
        }
    }
    const offsetNodeId = (nodeId, layer) => {
        if (layer === 0) {
            return nodeId;
        }
        const key = `${nodeId}:${layer}`;
        const existing = offsetNodeIdByKey.get(key);
        if (existing !== undefined) {
            return existing;
        }
        const point = offsetBoundaryPoint(mesh, nodeId, incidentEdgesByNodeId.get(nodeId) ?? [], layerDistances[layer - 1]);
        nodes.push(point);
        const nextNodeId = nodes.length;
        offsetNodeIdByKey.set(key, nextNodeId);
        return nextNodeId;
    };
    for (let layer = 0; layer < increments; layer += 1) {
        for (const edge of boundaryEdges) {
            const [a, b] = edge.nodeIds;
            const element = [
                offsetNodeId(a, layer),
                offsetNodeId(b, layer),
                offsetNodeId(b, layer + 1),
                offsetNodeId(a, layer + 1)
            ];
            elements.push(element);
            const elementId = elements.length;
            generatedElementIds.push(elementId);
            layerElementIds[layer].push(elementId);
        }
    }
    arrangeBoundaryLayerNodes(mesh, nodes, boundaryEdges, offsetNodeIdByKey, increments, nodeArrangement);
    const grownMesh = scaleBoundaryLayerMesh({ kind: "Q1", nodes, elements }, scaleMode, originalBounds, originalArea);
    return {
        mesh: grownMesh,
        boundaryEdgeCount: boundaryEdges.length,
        generatedElementIds,
        layerElementIds,
        scaleMode,
        originalArea,
        finalArea: q1MeshArea(grownMesh)
    };
}
function arrangeBoundaryLayerNodes(sourceMesh, grownNodes, boundaryEdges, offsetNodeIdByKey, increments, arrangement) {
    for (const chain of boundaryEdgeChains(sourceMesh, boundaryEdges)) {
        if (chain.length <= 2) {
            continue;
        }
        for (let layer = 1; layer <= increments; layer += 1) {
            const firstId = offsetNodeIdByKey.get(`${chain[0]}:${layer}`);
            const lastId = offsetNodeIdByKey.get(`${chain[chain.length - 1]}:${layer}`);
            if (firstId === undefined || lastId === undefined) {
                continue;
            }
            const first = grownNodes[firstId - 1];
            const last = grownNodes[lastId - 1];
            for (let index = 1; index < chain.length - 1; index += 1) {
                const nodeId = offsetNodeIdByKey.get(`${chain[index]}:${layer}`);
                if (nodeId === undefined) {
                    continue;
                }
                grownNodes[nodeId - 1] = interpolatePoint(first, last, arrangedBoundaryParameter(index / (chain.length - 1), arrangement));
            }
        }
    }
}
function boundaryEdgeChains(mesh, boundaryEdges) {
    const adjacency = new Map();
    boundaryEdges.forEach((edge, index) => {
        for (const nodeId of edge.nodeIds) {
            const incident = adjacency.get(nodeId) ?? [];
            incident.push(index);
            adjacency.set(nodeId, incident);
        }
    });
    const breakNodes = new Set();
    for (const [nodeId, edgeIndices] of adjacency) {
        if (edgeIndices.length !== 2 || !incidentEdgesAreStraight(mesh, nodeId, edgeIndices.map((index) => boundaryEdges[index]))) {
            breakNodes.add(nodeId);
        }
    }
    const visited = new Set();
    const chains = [];
    for (const startNode of breakNodes) {
        for (const edgeIndex of adjacency.get(startNode) ?? []) {
            if (visited.has(edgeIndex)) {
                continue;
            }
            const chain = walkBoundaryChain(startNode, edgeIndex, boundaryEdges, adjacency, breakNodes, visited);
            if (chain.length > 1) {
                chains.push(chain);
            }
        }
    }
    return chains;
}
function walkBoundaryChain(startNode, startEdgeIndex, boundaryEdges, adjacency, breakNodes, visited) {
    const chain = [startNode];
    let currentNode = startNode;
    let edgeIndex = startEdgeIndex;
    while (!visited.has(edgeIndex)) {
        visited.add(edgeIndex);
        const edge = boundaryEdges[edgeIndex];
        const nextNode = edge.nodeIds[0] === currentNode ? edge.nodeIds[1] : edge.nodeIds[0];
        chain.push(nextNode);
        if (breakNodes.has(nextNode)) {
            break;
        }
        const nextEdgeIndex = (adjacency.get(nextNode) ?? []).find((index) => index !== edgeIndex && !visited.has(index));
        if (nextEdgeIndex === undefined) {
            break;
        }
        currentNode = nextNode;
        edgeIndex = nextEdgeIndex;
    }
    return chain;
}
function incidentEdgesAreStraight(mesh, nodeId, edges) {
    if (edges.length !== 2) {
        return false;
    }
    const first = directionFromNode(mesh, nodeId, edges[0]);
    const second = directionFromNode(mesh, nodeId, edges[1]);
    return dot2(first, second) < -0.999;
}
function directionFromNode(mesh, nodeId, edge) {
    const otherNodeId = edge.nodeIds[0] === nodeId ? edge.nodeIds[1] : edge.nodeIds[0];
    const point = mesh.nodes[nodeId - 1];
    const other = mesh.nodes[otherNodeId - 1];
    return normalize2([(other[0] ?? 0) - (point[0] ?? 0), (other[1] ?? 0) - (point[1] ?? 0)]);
}
function arrangedBoundaryParameter(t, arrangement) {
    const exponent = 1 / arrangement;
    if (t <= 0.5) {
        return 0.5 * (2 * t) ** exponent;
    }
    return 1 - 0.5 * (2 * (1 - t)) ** exponent;
}
function interpolatePoint(a, b, t) {
    const dimension = Math.max(a.length, b.length);
    return Array.from({ length: dimension }, (_, index) => (a[index] ?? 0) * (1 - t) + (b[index] ?? 0) * t);
}
export function replaceQ1BlockWithRectangleCircleTemplate(mesh, selectedElementIds, options = {}) {
    assertQ1Mesh(mesh);
    const irregularBoundaryBias = finiteNumber(options.irregularBoundaryBias ?? 1, "irregular boundary bias");
    const block = resolveQ1SelectedBlock(mesh, selectedElementIds, irregularBoundaryBias);
    if (block.radiusScale <= 1e-12) {
        throw new Error("selected Q1 block has zero radius scale");
    }
    const templateOptions = { ...options };
    if (options.innerCircleRadius !== undefined) {
        templateOptions.innerCircleRatio = options.innerCircleRadius / block.radiusScale;
    }
    if (options.outerCircleRadius !== undefined) {
        templateOptions.outerCircleRatio = options.outerCircleRadius / block.radiusScale;
    }
    templateOptions.irregularBoundaryBias = irregularBoundaryBias;
    const template = createRectangleCircleTemplate(block.dimensions, templateOptions);
    const compact = compactMeshWithoutElements(mesh, new Set(block.elementIds));
    const offset = compact.nodes.length;
    const transformedTemplateNodes = template.nodes.map((point) => transformTemplatePoint(point, block.mapping, templateOptions.outerCircleRatio ?? 0.55));
    const merged = mergeCoincidentNodes({
        kind: "Q1",
        nodes: [...compact.nodes, ...transformedTemplateNodes],
        elements: [
            ...compact.elements,
            ...template.elements.map((element) => element.map((nodeId) => nodeId + offset))
        ]
    }, options.mergeTolerance ?? block.mergeTolerance);
    const keptElementCount = compact.elements.length;
    const generatedElementIds = sequence(template.elements.length).map((id) => keptElementCount + id);
    const mapRegion = (ids) => ids.map((id) => keptElementCount + id);
    return {
        mesh: merged,
        replacedElementIds: block.elementIds,
        generatedElementIds,
        regionElementIds: {
            core: mapRegion(template.regionLocalElementIds.core),
            squareToCircle: mapRegion(template.regionLocalElementIds.squareToCircle),
            annulus: mapRegion(template.regionLocalElementIds.annulus),
            circleToSquare: mapRegion(template.regionLocalElementIds.circleToSquare)
        },
        blockDimensions: block.dimensions
    };
}
function assertQ1Mesh(mesh) {
    if (inferMeshKind(mesh) !== "Q1") {
        throw new Error("operation is only available for 2D Q1 quad meshes");
    }
}
function selectedBoundaryEdges(mesh, selected) {
    const ownersByKey = new Map();
    mesh.elements.forEach((element, index) => {
        const elementId = index + 1;
        for (const [a, b] of q1LocalEdges) {
            const nodeA = element[a];
            const nodeB = element[b];
            if (nodeA === undefined || nodeB === undefined) {
                throw new Error(`Q1 element ${elementId} has invalid connectivity`);
            }
            const key = edgeKey(nodeA, nodeB);
            const owners = ownersByKey.get(key) ?? [];
            owners.push({ elementId, nodeIds: [nodeA, nodeB] });
            ownersByKey.set(key, owners);
        }
    });
    const edges = [];
    for (const owners of ownersByKey.values()) {
        if (owners.length !== 1) {
            continue;
        }
        const owner = owners[0];
        if (!selected.has(owner.elementId)) {
            continue;
        }
        const normal = outwardEdgeNormal(mesh, owner);
        edges.push({ ...owner, normal });
    }
    return edges.sort((a, b) => a.elementId - b.elementId || a.nodeIds[0] - b.nodeIds[0] || a.nodeIds[1] - b.nodeIds[1]);
}
function outwardEdgeNormal(mesh, edge) {
    const a = mesh.nodes[edge.nodeIds[0] - 1];
    const b = mesh.nodes[edge.nodeIds[1] - 1];
    const tangent = [(b[0] ?? 0) - (a[0] ?? 0), (b[1] ?? 0) - (a[1] ?? 0)];
    const length = Math.hypot(tangent[0], tangent[1]);
    if (length <= 1e-12) {
        throw new Error("boundary edge has zero length");
    }
    let normal = [tangent[1] / length, -tangent[0] / length];
    const midpoint = [((a[0] ?? 0) + (b[0] ?? 0)) * 0.5, ((a[1] ?? 0) + (b[1] ?? 0)) * 0.5];
    const center = elementCenter2(mesh, edge.elementId);
    const away = [midpoint[0] - center[0], midpoint[1] - center[1]];
    if (dot2(normal, away) < 0) {
        normal = [-normal[0], -normal[1]];
    }
    return normal;
}
function offsetBoundaryPoint(mesh, nodeId, incidentEdges, distance) {
    const point = mesh.nodes[nodeId - 1];
    const usableEdges = incidentEdges.filter((edge) => edge.nodeIds.includes(nodeId));
    if (usableEdges.length === 0) {
        return shiftedPoint(point, [0, 0], distance);
    }
    if (usableEdges.length === 1) {
        return shiftedPoint(point, usableEdges[0].normal, distance);
    }
    const intersections = [];
    for (let i = 0; i < usableEdges.length; i += 1) {
        for (let j = i + 1; j < usableEdges.length; j += 1) {
            const intersection = intersectOffsetLines(mesh, usableEdges[i], usableEdges[j], distance);
            if (intersection) {
                intersections.push(withOriginalTail(point, intersection));
            }
        }
    }
    if (intersections.length > 0) {
        return averagePoints(intersections);
    }
    const averageNormal = normalize2([
        usableEdges.reduce((total, edge) => total + edge.normal[0], 0),
        usableEdges.reduce((total, edge) => total + edge.normal[1], 0)
    ]);
    return shiftedPoint(point, averageNormal, distance);
}
function intersectOffsetLines(mesh, first, second, distance) {
    const a0 = shiftedPoint(mesh.nodes[first.nodeIds[0] - 1], first.normal, distance);
    const a1 = shiftedPoint(mesh.nodes[first.nodeIds[1] - 1], first.normal, distance);
    const b0 = shiftedPoint(mesh.nodes[second.nodeIds[0] - 1], second.normal, distance);
    const b1 = shiftedPoint(mesh.nodes[second.nodeIds[1] - 1], second.normal, distance);
    const r = [(a1[0] ?? 0) - (a0[0] ?? 0), (a1[1] ?? 0) - (a0[1] ?? 0)];
    const s = [(b1[0] ?? 0) - (b0[0] ?? 0), (b1[1] ?? 0) - (b0[1] ?? 0)];
    const denominator = cross2(r, s);
    if (Math.abs(denominator) <= 1e-12) {
        return null;
    }
    const delta = [(b0[0] ?? 0) - (a0[0] ?? 0), (b0[1] ?? 0) - (a0[1] ?? 0)];
    const t = cross2(delta, s) / denominator;
    return [(a0[0] ?? 0) + r[0] * t, (a0[1] ?? 0) + r[1] * t];
}
function cumulativeLayerDistances(totalHeight, increments, growthRatio) {
    if (Math.abs(growthRatio - 1) <= 1e-12) {
        return sequence(increments).map((index) => totalHeight * index / increments);
    }
    const first = totalHeight * (1 - growthRatio) / (1 - growthRatio ** increments);
    let sum = 0;
    const distances = [];
    for (let index = 0; index < increments; index += 1) {
        sum += first * growthRatio ** index;
        distances.push(sum);
    }
    return distances;
}
function resolveQ1SelectedBlock(mesh, selectedElementIds, irregularBoundaryBias) {
    const selected = selectedElementIds
        .filter((elementId) => Number.isInteger(elementId) && elementId >= 1 && elementId <= mesh.elements.length)
        .sort((a, b) => a - b);
    if (selected.length === 0) {
        throw new Error("template replacement needs a selected Q1 block");
    }
    const tolerance = Math.max(minQ1EdgeLength(mesh) * 1e-7, 1e-10);
    const elementIds = [...new Set(selected)];
    const selectedSet = new Set(elementIds);
    const boundaryEdges = selectedBoundaryEdgesForElements(mesh, selectedSet);
    const boundaryLoop = orderedBoundaryLoop(boundaryEdges);
    if (boundaryLoop.length < 4) {
        throw new Error("selected cells do not form a complete topological Q1 block boundary");
    }
    const selectedNodeUseCount = selectedNodeUseCounts(mesh, elementIds);
    const cornerNodes = boundaryLoop.filter((nodeId) => selectedNodeUseCount.get(nodeId) === 1);
    if (cornerNodes.length !== 4) {
        throw new Error("selected cells must form a topological rectangular Q1 block with four corner nodes");
    }
    const orientedLoop = polygonArea2(boundaryLoop.map((nodeId) => mesh.nodes[nodeId - 1])) < 0
        ? [boundaryLoop[0], ...boundaryLoop.slice(1).reverse()]
        : boundaryLoop;
    const loopCorners = orientedLoop.filter((nodeId) => cornerNodes.includes(nodeId));
    const startIndex = orientedLoop.indexOf(loopCorners[0]);
    const rotatedLoop = [...orientedLoop.slice(startIndex), ...orientedLoop.slice(0, startIndex)];
    const chains = splitLoopAtCorners(rotatedLoop, new Set(cornerNodes));
    if (chains.length !== 4) {
        throw new Error("selected cells must form a topological rectangular Q1 block with four boundary sides");
    }
    const sideLengths = chains.map((chain) => chain.length - 1);
    if (sideLengths.some((length) => length <= 0) || sideLengths[0] !== sideLengths[2] || sideLengths[1] !== sideLengths[3]) {
        throw new Error("opposite sides of the selected topological Q1 block must have matching segment counts");
    }
    const usedNodeIds = new Set();
    for (const elementId of elementIds) {
        for (const nodeId of mesh.elements[elementId - 1] ?? []) {
            usedNodeIds.add(nodeId);
        }
    }
    const points = [...usedNodeIds].map((nodeId) => mesh.nodes[nodeId - 1]);
    const min = [
        Math.min(...points.map((point) => point[0] ?? 0)),
        Math.min(...points.map((point) => point[1] ?? 0))
    ];
    const max = [
        Math.max(...points.map((point) => point[0] ?? 0)),
        Math.max(...points.map((point) => point[1] ?? 0))
    ];
    const bottom = chains[0].map((nodeId) => mesh.nodes[nodeId - 1]);
    const right = chains[1].map((nodeId) => mesh.nodes[nodeId - 1]);
    const top = chains[2].map((nodeId) => mesh.nodes[nodeId - 1]);
    const left = chains[3].map((nodeId) => mesh.nodes[nodeId - 1]);
    const bottomLeft = bottom[0];
    const bottomRight = bottom[bottom.length - 1];
    const topRight = right[right.length - 1];
    const topLeft = top[top.length - 1];
    const axisU = scalePoint(addPoints(subtractPoints(bottomRight, bottomLeft), subtractPoints(topRight, topLeft)), 0.25);
    const axisV = scalePoint(addPoints(subtractPoints(topLeft, bottomLeft), subtractPoints(topRight, bottomRight)), 0.25);
    const center = shiftedRingCenter(averagePoints([bottomLeft, bottomRight, topRight, topLeft]), axisU, axisV, { bottom, right, top, left }, irregularBoundaryBias);
    const mapping = {
        bottom,
        right,
        top,
        left,
        center,
        axisU,
        axisV
    };
    const horizontalLength = (polylineLength(mapping.bottom) + polylineLength(mapping.top)) * 0.5;
    const verticalLength = (polylineLength(mapping.right) + polylineLength(mapping.left)) * 0.5;
    return {
        elementIds,
        dimensions: [sideLengths[0], sideLengths[1]],
        bounds: { min, max },
        mapping,
        radiusScale: Math.min(horizontalLength, verticalLength) * 0.5,
        mergeTolerance: tolerance
    };
}
function selectedBoundaryEdgesForElements(mesh, selected) {
    const ownersByKey = new Map();
    for (const elementId of selected) {
        const element = mesh.elements[elementId - 1];
        if (!element) {
            continue;
        }
        for (const [a, b] of q1LocalEdges) {
            const nodeA = element[a];
            const nodeB = element[b];
            if (nodeA === undefined || nodeB === undefined) {
                throw new Error(`Q1 element ${elementId} has invalid connectivity`);
            }
            const key = edgeKey(nodeA, nodeB);
            const owners = ownersByKey.get(key) ?? [];
            owners.push({ elementId, nodeIds: [nodeA, nodeB] });
            ownersByKey.set(key, owners);
        }
    }
    const edges = [];
    for (const owners of ownersByKey.values()) {
        if (owners.length === 1) {
            edges.push({ ...owners[0], normal: [0, 0] });
        }
    }
    return edges;
}
function orderedBoundaryLoop(boundaryEdges) {
    if (boundaryEdges.length === 0) {
        throw new Error("selected cells do not have an exterior boundary");
    }
    const adjacency = new Map();
    for (const edge of boundaryEdges) {
        for (const [a, b] of [[edge.nodeIds[0], edge.nodeIds[1]], [edge.nodeIds[1], edge.nodeIds[0]]]) {
            const neighbors = adjacency.get(a) ?? [];
            neighbors.push(b);
            adjacency.set(a, neighbors);
        }
    }
    for (const [nodeId, neighbors] of adjacency) {
        if (neighbors.length !== 2) {
            throw new Error(`selected cells do not form a single closed topological block boundary at node ${nodeId}`);
        }
    }
    const start = boundaryEdges[0].nodeIds[0];
    const loop = [start];
    let previous = -1;
    let current = start;
    for (let guard = 0; guard <= boundaryEdges.length; guard += 1) {
        const neighbors = adjacency.get(current);
        const next = neighbors[0] === previous ? neighbors[1] : neighbors[0];
        if (next === start) {
            if (loop.length !== adjacency.size) {
                throw new Error("selected cells boundary has more than one connected loop");
            }
            return loop;
        }
        if (loop.includes(next)) {
            throw new Error("selected cells boundary self-intersects topologically");
        }
        loop.push(next);
        previous = current;
        current = next;
    }
    throw new Error("selected cells boundary is not closed");
}
function selectedNodeUseCounts(mesh, elementIds) {
    const counts = new Map();
    for (const elementId of elementIds) {
        const element = mesh.elements[elementId - 1] ?? [];
        for (const nodeId of element) {
            counts.set(nodeId, (counts.get(nodeId) ?? 0) + 1);
        }
    }
    return counts;
}
function splitLoopAtCorners(loop, corners) {
    if (!corners.has(loop[0])) {
        throw new Error("boundary loop must start at a corner");
    }
    const chains = [];
    let chain = [loop[0]];
    const wrapped = [...loop.slice(1), loop[0]];
    for (const nodeId of wrapped) {
        chain.push(nodeId);
        if (corners.has(nodeId)) {
            chains.push(chain);
            chain = [nodeId];
        }
    }
    return chains;
}
function polylineLength(points) {
    let total = 0;
    for (let index = 0; index + 1 < points.length; index += 1) {
        const a = points[index];
        const b = points[index + 1];
        total += Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0));
    }
    return total;
}
function shiftedRingCenter(center, axisU, axisV, sides, biasStrength) {
    const roughLeft = 1 - boundarySideStraightness(sides.left);
    const roughRight = 1 - boundarySideStraightness(sides.right);
    const roughBottom = 1 - boundarySideStraightness(sides.bottom);
    const roughTop = 1 - boundarySideStraightness(sides.top);
    const strength = biasStrength;
    const limit = 0.28 * Math.abs(strength);
    const biasU = clampSigned((roughLeft - roughRight) * 0.45 * strength, limit);
    const biasV = clampSigned((roughBottom - roughTop) * 0.45 * strength, limit);
    return addPoints(addPoints(center, scalePoint(axisU, biasU)), scalePoint(axisV, biasV));
}
function boundarySideStraightness(points) {
    if (points.length < 2) {
        return 1;
    }
    const chord = Math.hypot((points[points.length - 1][0] ?? 0) - (points[0][0] ?? 0), (points[points.length - 1][1] ?? 0) - (points[0][1] ?? 0));
    const length = polylineLength(points);
    if (length <= 1e-12) {
        return 1;
    }
    return clampUnit(chord / length);
}
function clampSigned(value, maxAbs) {
    return Math.max(-maxAbs, Math.min(maxAbs, value));
}
function samplePolylineByIndex(points, t) {
    if (points.length === 0) {
        throw new Error("cannot sample an empty block boundary side");
    }
    if (points.length === 1) {
        return [...points[0]];
    }
    const scaled = clampUnit(t) * (points.length - 1);
    const index = Math.min(points.length - 2, Math.floor(scaled));
    const localT = scaled - index;
    return interpolatePoint(points[index], points[index + 1], localT);
}
function clampUnit(value) {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(0, Math.min(1, value));
}
function createRectangleCircleTemplate(dimensions, options) {
    const nx = positiveInteger(dimensions[0], "block nx");
    const ny = positiveInteger(dimensions[1], "block ny");
    const innerSquare = ratioInUnit(options.innerSquareRatio ?? 0.28, "inner square ratio");
    const innerCircle = ratioInUnit(options.innerCircleRatio ?? 0.45, "inner circle ratio");
    const outerCircle = ratioInUnit(options.outerCircleRatio ?? 0.55, "outer circle ratio");
    if (!(innerSquare < innerCircle && innerCircle < outerCircle && outerCircle < 1)) {
        throw new Error("template ratios must satisfy inner square < inner circle < outer circle < 1");
    }
    const n1 = positiveInteger(options.squareToCircleLayers ?? 2, "square-to-circle layers");
    const n2 = positiveInteger(options.annulusLayers ?? 3, "annulus layers");
    const n3 = positiveInteger(options.circleToSquareLayers ?? 3, "circle-to-square layers");
    const omitCore = options.omitCore === true;
    const nodes = [];
    const elements = [];
    const regionLocalElementIds = {
        core: [],
        squareToCircle: [],
        annulus: [],
        circleToSquare: []
    };
    if (!omitCore) {
        const centralNodeId = (i, j) => j * (nx + 1) + i + 1;
        for (let j = 0; j <= ny; j += 1) {
            for (let i = 0; i <= nx; i += 1) {
                nodes.push([
                    -innerSquare + 2 * innerSquare * i / nx,
                    -innerSquare + 2 * innerSquare * j / ny
                ]);
            }
        }
        for (let j = 0; j < ny; j += 1) {
            for (let i = 0; i < nx; i += 1) {
                elements.push([
                    centralNodeId(i, j),
                    centralNodeId(i + 1, j),
                    centralNodeId(i + 1, j + 1),
                    centralNodeId(i, j + 1)
                ]);
                regionLocalElementIds.core.push(elements.length);
            }
        }
    }
    const perimeter = rectangleBoundarySamples(nx, ny);
    const totalRadialLayers = n1 + n2 + n3;
    const firstRadialLayer = omitCore ? n1 : 0;
    const radialNodeIds = [];
    for (let layer = firstRadialLayer; layer <= totalRadialLayers; layer += 1) {
        const row = [];
        for (const sample of perimeter) {
            const point = radialTemplatePoint(sample, layer, { innerSquare, innerCircle, outerCircle, n1, n2, n3 });
            nodes.push(point);
            row.push(nodes.length);
        }
        radialNodeIds[layer] = row;
    }
    const sideCount = perimeter.length;
    for (let layer = firstRadialLayer; layer < totalRadialLayers; layer += 1) {
        const targetRegion = layer < n1
            ? regionLocalElementIds.squareToCircle
            : layer < n1 + n2
                ? regionLocalElementIds.annulus
                : regionLocalElementIds.circleToSquare;
        for (let sideIndex = 0; sideIndex < sideCount; sideIndex += 1) {
            const nextSideIndex = (sideIndex + 1) % sideCount;
            elements.push([
                radialNodeIds[layer][sideIndex],
                radialNodeIds[layer][nextSideIndex],
                radialNodeIds[layer + 1][nextSideIndex],
                radialNodeIds[layer + 1][sideIndex]
            ]);
            targetRegion.push(elements.length);
        }
    }
    return { nodes, elements, regionLocalElementIds };
}
function radialTemplatePoint(squarePoint, layer, spec) {
    const direction = normalize2(squarePoint);
    const p1 = [spec.innerSquare * squarePoint[0], spec.innerSquare * squarePoint[1]];
    const p2 = [spec.innerCircle * direction[0], spec.innerCircle * direction[1]];
    const p3 = [spec.outerCircle * direction[0], spec.outerCircle * direction[1]];
    const p4 = squarePoint;
    if (layer <= spec.n1) {
        return lerp2(p1, p2, layer / spec.n1);
    }
    if (layer <= spec.n1 + spec.n2) {
        return lerp2(p2, p3, (layer - spec.n1) / spec.n2);
    }
    return lerp2(p3, p4, (layer - spec.n1 - spec.n2) / spec.n3);
}
function rectangleBoundarySamples(nx, ny) {
    const points = [];
    for (let i = 0; i < nx; i += 1) {
        points.push([-1 + 2 * i / nx, -1]);
    }
    for (let j = 0; j < ny; j += 1) {
        points.push([1, -1 + 2 * j / ny]);
    }
    for (let i = 0; i < nx; i += 1) {
        points.push([1 - 2 * i / nx, 1]);
    }
    for (let j = 0; j < ny; j += 1) {
        points.push([-1, 1 - 2 * j / ny]);
    }
    return points;
}
function transformTemplatePoint(point, mapping, outerCircleRatio) {
    const x = point[0] ?? 0;
    const y = point[1] ?? 0;
    const affine = affineTemplatePoint(mapping, x, y);
    const boundary = coonsTemplatePoint(point, mapping);
    const blend = circularToBoundaryBlend(x, y, outerCircleRatio);
    return blendPoints(affine, boundary, smoothStep(blend));
}
function coonsTemplatePoint(point, mapping) {
    const u = clampUnit((point[0] ?? 0) * 0.5 + 0.5);
    const v = clampUnit((point[1] ?? 0) * 0.5 + 0.5);
    const bottom = samplePolylineByIndex(mapping.bottom, u);
    const right = samplePolylineByIndex(mapping.right, v);
    const top = samplePolylineByIndex(mapping.top, 1 - u);
    const left = samplePolylineByIndex(mapping.left, 1 - v);
    const bottomLeft = mapping.bottom[0];
    const bottomRight = mapping.bottom[mapping.bottom.length - 1];
    const topRight = mapping.right[mapping.right.length - 1];
    const topLeft = mapping.top[mapping.top.length - 1];
    const dimension = Math.max(bottom.length, right.length, top.length, left.length);
    const out = Array.from({ length: dimension }, (_, index) => {
        const sideBlend = (1 - v) * (bottom[index] ?? 0)
            + v * (top[index] ?? 0)
            + (1 - u) * (left[index] ?? 0)
            + u * (right[index] ?? 0);
        const cornerBlend = (1 - u) * (1 - v) * (bottomLeft[index] ?? 0)
            + u * (1 - v) * (bottomRight[index] ?? 0)
            + u * v * (topRight[index] ?? 0)
            + (1 - u) * v * (topLeft[index] ?? 0);
        return sideBlend - cornerBlend;
    });
    return out;
}
function affineTemplatePoint(mapping, x, y) {
    const dimension = Math.max(mapping.center.length, mapping.axisU.length, mapping.axisV.length);
    return Array.from({ length: dimension }, (_, index) => (mapping.center[index] ?? 0)
        + x * (mapping.axisU[index] ?? 0)
        + y * (mapping.axisV[index] ?? 0));
}
function circularToBoundaryBlend(x, y, outerCircleRatio) {
    const radius = Math.hypot(x, y);
    if (radius <= outerCircleRatio + 1e-12) {
        return 0;
    }
    const maxDirection = Math.max(Math.abs(x), Math.abs(y));
    if (maxDirection <= 1e-12) {
        return 0;
    }
    const boundaryRadius = radius / maxDirection;
    if (boundaryRadius <= outerCircleRatio + 1e-12) {
        return 1;
    }
    return clampUnit((radius - outerCircleRatio) / (boundaryRadius - outerCircleRatio));
}
function smoothStep(t) {
    const clamped = clampUnit(t);
    return clamped * clamped * (3 - 2 * clamped);
}
function blendPoints(a, b, t) {
    const dimension = Math.max(a.length, b.length);
    return Array.from({ length: dimension }, (_, index) => (a[index] ?? 0) * (1 - t) + (b[index] ?? 0) * t);
}
function scaleBoundaryLayerMesh(mesh, mode, originalBounds, originalArea) {
    if (mode === "none") {
        return mesh;
    }
    if (mode === "fit-bounds") {
        const grownBounds = meshBounds2(mesh.nodes);
        const spanX = grownBounds.max[0] - grownBounds.min[0];
        const spanY = grownBounds.max[1] - grownBounds.min[1];
        const targetSpanX = originalBounds.max[0] - originalBounds.min[0];
        const targetSpanY = originalBounds.max[1] - originalBounds.min[1];
        if (spanX <= 1e-12 || spanY <= 1e-12) {
            throw new Error("cannot fit boundary layer to original bounds with zero span");
        }
        return {
            ...mesh,
            nodes: mesh.nodes.map((point) => [
                originalBounds.min[0] + ((point[0] ?? 0) - grownBounds.min[0]) * targetSpanX / spanX,
                originalBounds.min[1] + ((point[1] ?? 0) - grownBounds.min[1]) * targetSpanY / spanY
            ])
        };
    }
    const grownArea = q1MeshArea(mesh);
    if (grownArea <= 1e-12 || originalArea <= 1e-12) {
        throw new Error("cannot scale boundary layer area from a zero-area mesh");
    }
    const factor = Math.sqrt(originalArea / grownArea);
    const center = boundsCenter2(originalBounds);
    return {
        ...mesh,
        nodes: mesh.nodes.map((point) => [
            center[0] + ((point[0] ?? 0) - center[0]) * factor,
            center[1] + ((point[1] ?? 0) - center[1]) * factor
        ])
    };
}
function compactMeshWithoutElements(mesh, removedElementIds) {
    const keptSourceElements = mesh.elements.filter((_, index) => !removedElementIds.has(index + 1));
    const usedNodeIds = new Set();
    for (const element of keptSourceElements) {
        for (const nodeId of element) {
            usedNodeIds.add(nodeId);
        }
    }
    const sortedNodeIds = [...usedNodeIds].sort((a, b) => a - b);
    const nodeIdMap = new Map();
    const nodes = sortedNodeIds.map((nodeId, index) => {
        nodeIdMap.set(nodeId, index + 1);
        return mesh.nodes[nodeId - 1];
    });
    const elements = keptSourceElements.map((element) => element.map((nodeId) => {
        const mapped = nodeIdMap.get(nodeId);
        if (mapped === undefined) {
            throw new Error(`kept element references missing compacted node ${nodeId}`);
        }
        return mapped;
    }));
    return { kind: "Q1", nodes, elements };
}
function q1MeshArea(mesh) {
    return mesh.elements.reduce((total, element) => {
        const points = element.map((nodeId) => mesh.nodes[nodeId - 1]);
        return total + Math.abs(polygonArea2(points));
    }, 0);
}
function polygonArea2(points) {
    let twiceArea = 0;
    for (let index = 0; index < points.length; index += 1) {
        const a = points[index];
        const b = points[(index + 1) % points.length];
        twiceArea += (a[0] ?? 0) * (b[1] ?? 0) - (b[0] ?? 0) * (a[1] ?? 0);
    }
    return twiceArea * 0.5;
}
function meshBounds2(nodes) {
    if (nodes.length === 0) {
        throw new Error("cannot compute bounds for an empty node list");
    }
    const min = [Infinity, Infinity];
    const max = [-Infinity, -Infinity];
    for (const point of nodes) {
        min[0] = Math.min(min[0], point[0] ?? 0);
        min[1] = Math.min(min[1], point[1] ?? 0);
        max[0] = Math.max(max[0], point[0] ?? 0);
        max[1] = Math.max(max[1], point[1] ?? 0);
    }
    return { min, max };
}
function boundsCenter2(bounds) {
    return [
        (bounds.min[0] + bounds.max[0]) * 0.5,
        (bounds.min[1] + bounds.max[1]) * 0.5
    ];
}
function elementCenter2(mesh, elementId) {
    const element = mesh.elements[elementId - 1];
    if (!element) {
        throw new Error(`element id ${elementId} is out of range`);
    }
    const sum = [0, 0];
    for (const nodeId of element) {
        const point = mesh.nodes[nodeId - 1];
        sum[0] += point[0] ?? 0;
        sum[1] += point[1] ?? 0;
    }
    return [sum[0] / element.length, sum[1] / element.length];
}
function minQ1EdgeLength(mesh) {
    let min = Infinity;
    for (const element of mesh.elements) {
        for (const [a, b] of q1LocalEdges) {
            const pa = mesh.nodes[element[a] - 1];
            const pb = mesh.nodes[element[b] - 1];
            const length = Math.hypot((pa[0] ?? 0) - (pb[0] ?? 0), (pa[1] ?? 0) - (pb[1] ?? 0));
            if (length > 1e-12) {
                min = Math.min(min, length);
            }
        }
    }
    return Number.isFinite(min) ? min : 1;
}
function edgeKey(a, b) {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
}
function shiftedPoint(point, normal, distance) {
    const shifted = [...point];
    shifted[0] = (point[0] ?? 0) + normal[0] * distance;
    shifted[1] = (point[1] ?? 0) + normal[1] * distance;
    return shifted;
}
function withOriginalTail(original, xy) {
    const point = [...original];
    point[0] = xy[0];
    point[1] = xy[1];
    return point;
}
function addPoints(a, b) {
    const dimension = Math.max(a.length, b.length);
    return Array.from({ length: dimension }, (_, index) => (a[index] ?? 0) + (b[index] ?? 0));
}
function subtractPoints(a, b) {
    const dimension = Math.max(a.length, b.length);
    return Array.from({ length: dimension }, (_, index) => (a[index] ?? 0) - (b[index] ?? 0));
}
function scalePoint(point, scale) {
    return point.map((value) => value * scale);
}
function averagePoints(points) {
    const dimension = Math.max(...points.map((point) => point.length));
    const out = Array.from({ length: dimension }, () => 0);
    for (const point of points) {
        for (let index = 0; index < dimension; index += 1) {
            out[index] = (out[index] ?? 0) + (point[index] ?? 0);
        }
    }
    return out.map((value) => value / points.length);
}
function normalize2(vector) {
    const length = Math.hypot(vector[0], vector[1]);
    return length <= 1e-12 ? [1, 0] : [vector[0] / length, vector[1] / length];
}
function lerp2(a, b, t) {
    return [a[0] * (1 - t) + b[0] * t, a[1] * (1 - t) + b[1] * t];
}
function dot2(a, b) {
    return a[0] * b[0] + a[1] * b[1];
}
function cross2(a, b) {
    return a[0] * b[1] - a[1] * b[0];
}
function uniqueSortedCoordinates(values, tolerance) {
    const sorted = [...values].sort((a, b) => a - b);
    const unique = [];
    for (const value of sorted) {
        if (unique.length === 0 || Math.abs(value - unique[unique.length - 1]) > tolerance) {
            unique.push(value);
        }
    }
    return unique;
}
function ratioInUnit(value, name) {
    if (!Number.isFinite(value) || value <= 0 || value >= 1) {
        throw new Error(`${name} must be greater than 0 and less than 1`);
    }
    return value;
}
function finitePositiveNumber(value, name) {
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`${name} must be a positive number`);
    }
    return value;
}
function finiteNumber(value, name) {
    if (!Number.isFinite(value)) {
        throw new Error(`${name} must be a finite number`);
    }
    return value;
}
function positiveInteger(value, name) {
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }
    return value;
}
function sequence(length) {
    return Array.from({ length }, (_, index) => index + 1);
}
