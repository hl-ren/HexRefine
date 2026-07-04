import { elementCenter, inferMeshKind, minElementEdgeLength } from "./mesh.js";
import { H1_FACES, boundaryKey } from "./topology.js";
const H1_FACE_DELTAS = [
    [0, 0, -1],
    [0, 0, 1],
    [0, -1, 0],
    [0, 1, 0],
    [1, 0, 0],
    [-1, 0, 0]
];
const topologyLatticeCache = new WeakMap();
export function regularizeHexSelection(mesh, candidateElementIds, options = {}) {
    if (inferMeshKind(mesh) !== "H1") {
        throw new Error("regularizeHexSelection requires an H1/Hex mesh");
    }
    const tolerance = options.tolerance ?? minElementEdgeLength(mesh) * 0.000001;
    const originalElementIds = uniqueSorted(candidateElementIds.filter((elementId) => Number.isInteger(elementId) && elementId >= 1 && elementId <= mesh.elements.length));
    if (originalElementIds.length === 0) {
        return {
            originalElementIds: [],
            selectedElementIds: [],
            addedElementIds: [],
            removedElementIds: [],
            warnings: []
        };
    }
    const lattice = inferHexElementLattice(mesh, tolerance);
    const candidateSet = new Set(originalElementIds);
    const candidateIndices = originalElementIds.map((elementId) => lattice.indicesByElementId.get(elementId));
    if (candidateIndices.some((indices) => indices === undefined)) {
        return {
            originalElementIds,
            selectedElementIds: [],
            addedElementIds: [],
            removedElementIds: originalElementIds,
            gridDimensions: lattice.dimensions,
            warnings: [...lattice.warnings, "some selected elements are outside the inferred regular Hex center lattice"]
        };
    }
    const initialRange = boundingIndexRange(candidateIndices);
    const range = options.boundaryShellOnly
        ? cropToCompleteBoundaryShell(initialRange, candidateSet, lattice)
        : cropToCompleteCandidateBlock(initialRange, candidateSet, lattice);
    if (!range) {
        return {
            originalElementIds,
            selectedElementIds: [],
            addedElementIds: [],
            removedElementIds: originalElementIds,
            gridDimensions: lattice.dimensions,
            warnings: [
                ...lattice.warnings,
                options.boundaryShellOnly
                    ? "unable to crop the candidate selection to a complete regular Hex boundary shell"
                    : "unable to crop the candidate selection to a complete regular Hex block"
            ]
        };
    }
    const selectedElementIds = idsInRange(range, lattice);
    const selectedSet = new Set(selectedElementIds);
    return {
        originalElementIds,
        selectedElementIds,
        addedElementIds: selectedElementIds.filter((elementId) => !candidateSet.has(elementId)),
        removedElementIds: originalElementIds.filter((elementId) => !selectedSet.has(elementId)),
        gridDimensions: lattice.dimensions,
        indexRange: range,
        warnings: lattice.warnings
    };
}
function inferHexElementLattice(mesh, tolerance) {
    const topologyLattice = inferHexTopologyLattice(mesh);
    if (topologyLattice) {
        return topologyLattice;
    }
    const centerLattice = inferHexCenterLattice(mesh, tolerance);
    return {
        ...centerLattice,
        warnings: [
            ...centerLattice.warnings,
            "falling back to coordinate-center lattice because topology lattice inference failed"
        ]
    };
}
function inferHexTopologyLattice(mesh) {
    if (topologyLatticeCache.has(mesh)) {
        return topologyLatticeCache.get(mesh) ?? undefined;
    }
    const neighbors = buildHexTopologyNeighbors(mesh);
    const seedElementId = findTopologyCornerSeed(neighbors);
    if (seedElementId === undefined) {
        topologyLatticeCache.set(mesh, null);
        return undefined;
    }
    const rawIndices = new Map();
    const queue = [seedElementId];
    const warnings = [];
    rawIndices.set(seedElementId, [0, 0, 0]);
    while (queue.length > 0) {
        const elementId = queue.shift();
        const current = rawIndices.get(elementId);
        for (const neighbor of neighbors.get(elementId) ?? []) {
            const next = addIndex(current, neighbor.delta);
            const existing = rawIndices.get(neighbor.elementId);
            if (existing) {
                if (!sameIndex(existing, next)) {
                    warnings.push(`conflicting topology indices for element ${neighbor.elementId}`);
                }
                continue;
            }
            rawIndices.set(neighbor.elementId, next);
            queue.push(neighbor.elementId);
        }
    }
    if (rawIndices.size !== mesh.elements.length) {
        warnings.push("topology lattice did not reach every Hex element");
    }
    if (warnings.length > 0) {
        topologyLatticeCache.set(mesh, null);
        return undefined;
    }
    const normalized = normalizeTopologyIndices(rawIndices);
    const fatalWarnings = normalized.warnings.filter((warning) => warning !== "topology indices do not fill a complete Hex lattice");
    const lattice = fatalWarnings.length === 0 ? normalized : undefined;
    topologyLatticeCache.set(mesh, lattice ?? null);
    return lattice;
}
function buildHexTopologyNeighbors(mesh) {
    const faceOwners = new Map();
    mesh.elements.forEach((element, index) => {
        const elementId = index + 1;
        H1_FACES.forEach((face, faceIndex) => {
            const key = boundaryKey(face.map((localId) => element[localId - 1]));
            const owners = faceOwners.get(key) ?? [];
            owners.push({ elementId, faceIndex });
            faceOwners.set(key, owners);
        });
    });
    const neighbors = new Map();
    for (const owners of faceOwners.values()) {
        if (owners.length !== 2) {
            continue;
        }
        const [a, b] = owners;
        if (!a || !b) {
            continue;
        }
        addTopologyNeighbor(neighbors, a.elementId, b.elementId, H1_FACE_DELTAS[a.faceIndex]);
        addTopologyNeighbor(neighbors, b.elementId, a.elementId, H1_FACE_DELTAS[b.faceIndex]);
    }
    return neighbors;
}
function addTopologyNeighbor(neighbors, elementId, neighborElementId, delta) {
    const list = neighbors.get(elementId) ?? [];
    list.push({ elementId: neighborElementId, delta });
    neighbors.set(elementId, list);
}
function findTopologyCornerSeed(neighbors) {
    const required = new Set(["1,0,0", "0,1,0", "0,0,1"]);
    for (const elementId of neighbors.keys()) {
        const deltas = new Set((neighbors.get(elementId) ?? []).map((neighbor) => neighbor.delta.join(",")));
        if ([...required].every((delta) => deltas.has(delta))) {
            return elementId;
        }
    }
    return 1;
}
function normalizeTopologyIndices(rawIndices) {
    const mins = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    const maxes = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const index of rawIndices.values()) {
        for (let axis = 0; axis < 3; axis += 1) {
            mins[axis] = Math.min(mins[axis], index[axis]);
            maxes[axis] = Math.max(maxes[axis], index[axis]);
        }
    }
    const elementIdByKey = new Map();
    const indicesByElementId = new Map();
    const warnings = [];
    for (const [elementId, rawIndex] of rawIndices) {
        const index = [
            rawIndex[0] - mins[0],
            rawIndex[1] - mins[1],
            rawIndex[2] - mins[2]
        ];
        const key = indexKey(index);
        if (elementIdByKey.has(key)) {
            warnings.push(`multiple elements map to Hex topology index ${key}`);
            continue;
        }
        elementIdByKey.set(key, elementId);
        indicesByElementId.set(elementId, index);
    }
    const dimensions = [
        maxes[0] - mins[0] + 1,
        maxes[1] - mins[1] + 1,
        maxes[2] - mins[2] + 1
    ];
    if (dimensions[0] * dimensions[1] * dimensions[2] !== rawIndices.size) {
        warnings.push("topology indices do not fill a complete Hex lattice");
    }
    return {
        elementIdByKey,
        indicesByElementId,
        dimensions,
        warnings: uniqueStrings(warnings)
    };
}
function addIndex(a, b) {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function sameIndex(a, b) {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}
function inferHexCenterLattice(mesh, tolerance) {
    const centers = mesh.elements.map((element) => elementCenter(mesh, element));
    const axisValues = [0, 1, 2].map((axis) => uniqueCoordinateValues(centers.map((center) => center[axis] ?? 0), tolerance));
    const dimensions = axisValues.map((values) => values.length);
    const warnings = [];
    if (dimensions[0] * dimensions[1] * dimensions[2] !== mesh.elements.length) {
        warnings.push("element centers do not fill a complete rectilinear Hex lattice");
    }
    for (let axis = 0; axis < 3; axis += 1) {
        if (!isUniform(axisValues[axis], tolerance)) {
            warnings.push(`axis ${axis} center spacing is not uniform within tolerance`);
        }
    }
    const elementIdByKey = new Map();
    const indicesByElementId = new Map();
    centers.forEach((center, index) => {
        const indices = [0, 1, 2].map((axis) => nearestCoordinateIndex(axisValues[axis], center[axis] ?? 0, tolerance));
        if (indices.some((value) => value < 0)) {
            return;
        }
        const key = indexKey(indices);
        if (elementIdByKey.has(key)) {
            warnings.push(`multiple elements map to Hex lattice index ${key}`);
            return;
        }
        const elementId = index + 1;
        elementIdByKey.set(key, elementId);
        indicesByElementId.set(elementId, indices);
    });
    return {
        elementIdByKey,
        indicesByElementId,
        dimensions,
        warnings: uniqueStrings(warnings)
    };
}
function uniqueCoordinateValues(values, tolerance) {
    const sorted = [...values].sort((a, b) => a - b);
    const unique = [];
    for (const value of sorted) {
        const last = unique[unique.length - 1];
        if (last === undefined || Math.abs(value - last) > tolerance) {
            unique.push(value);
        }
    }
    return unique;
}
function nearestCoordinateIndex(values, value, tolerance) {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    values.forEach((candidate, index) => {
        const distance = Math.abs(candidate - value);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = index;
        }
    });
    return bestDistance <= tolerance ? bestIndex : -1;
}
function isUniform(values, tolerance) {
    if (values.length <= 2) {
        return true;
    }
    const expected = values[1] - values[0];
    for (let i = 2; i < values.length; i += 1) {
        if (Math.abs((values[i] - values[i - 1]) - expected) > tolerance) {
            return false;
        }
    }
    return true;
}
function boundingIndexRange(indices) {
    const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const index of indices) {
        for (let axis = 0; axis < 3; axis += 1) {
            min[axis] = Math.min(min[axis], index[axis]);
            max[axis] = Math.max(max[axis], index[axis]);
        }
    }
    return makeIndexRange(min, max);
}
function cropToCompleteCandidateBlock(initialRange, candidateSet, lattice) {
    let range = initialRange;
    let guard = rangeVolume(initialRange) + 1;
    while (range && guard > 0) {
        const stats = rangeStats(range, candidateSet, lattice);
        if (stats.missing === 0) {
            return rangeVolume(range) > 0 ? range : undefined;
        }
        const candidates = shrinkCandidates(range)
            .map((candidate) => ({ range: candidate, stats: rangeStats(candidate, candidateSet, lattice) }))
            .filter((candidate) => rangeVolume(candidate.range) > 0)
            .sort((a, b) => a.stats.missing - b.stats.missing ||
            b.stats.present - a.stats.present ||
            b.stats.volume - a.stats.volume);
        range = candidates[0]?.range;
        guard -= 1;
    }
    return undefined;
}
function cropToCompleteBoundaryShell(initialRange, candidateSet, lattice) {
    let range = initialRange;
    let guard = rangeVolume(initialRange) + 1;
    while (range && guard > 0) {
        const stats = boundaryShellStats(range, candidateSet, lattice);
        if (stats.missingDomain === 0 && stats.missingShell === 0) {
            return rangeVolume(range) > 0 ? range : undefined;
        }
        const candidates = shrinkCandidates(range)
            .map((candidate) => ({ range: candidate, stats: boundaryShellStats(candidate, candidateSet, lattice) }))
            .filter((candidate) => rangeVolume(candidate.range) > 0)
            .sort((a, b) => (a.stats.missingDomain + a.stats.missingShell) - (b.stats.missingDomain + b.stats.missingShell) ||
            b.stats.presentShell - a.stats.presentShell ||
            b.stats.volume - a.stats.volume);
        range = candidates[0]?.range;
        guard -= 1;
    }
    return undefined;
}
function rangeStats(range, candidateSet, lattice) {
    let present = 0;
    let missing = 0;
    forEachIndexInRange(range, (indices) => {
        const elementId = lattice.elementIdByKey.get(indexKey(indices));
        if (elementId !== undefined && candidateSet.has(elementId)) {
            present += 1;
        }
        else {
            missing += 1;
        }
    });
    return {
        volume: rangeVolume(range),
        present,
        missing
    };
}
function boundaryShellStats(range, candidateSet, lattice) {
    let presentShell = 0;
    let missingShell = 0;
    let missingDomain = 0;
    forEachIndexInRange(range, (indices) => {
        const elementId = lattice.elementIdByKey.get(indexKey(indices));
        if (elementId === undefined) {
            missingDomain += 1;
            return;
        }
        if (!isRequiredTransitionShellIndex(indices, range, lattice.dimensions)) {
            return;
        }
        if (candidateSet.has(elementId)) {
            presentShell += 1;
        }
        else {
            missingShell += 1;
        }
    });
    return {
        volume: rangeVolume(range),
        presentShell,
        missingShell,
        missingDomain
    };
}
function isRequiredTransitionShellIndex(indices, range, gridDimensions) {
    return ((indices[0] === range.min[0] && range.min[0] > 0) ||
        (indices[0] === range.max[0] && range.max[0] < gridDimensions[0] - 1) ||
        (indices[1] === range.min[1] && range.min[1] > 0) ||
        (indices[1] === range.max[1] && range.max[1] < gridDimensions[1] - 1) ||
        (indices[2] === range.min[2] && range.min[2] > 0) ||
        (indices[2] === range.max[2] && range.max[2] < gridDimensions[2] - 1));
}
function shrinkCandidates(range) {
    const candidates = [];
    for (let axis = 0; axis < 3; axis += 1) {
        if (range.min[axis] < range.max[axis]) {
            const minShrinkMin = [...range.min];
            minShrinkMin[axis] = minShrinkMin[axis] + 1;
            candidates.push(makeIndexRange(minShrinkMin, range.max));
            const maxShrinkMax = [...range.max];
            maxShrinkMax[axis] = maxShrinkMax[axis] - 1;
            candidates.push(makeIndexRange(range.min, maxShrinkMax));
        }
    }
    return candidates;
}
function idsInRange(range, lattice) {
    const ids = [];
    forEachIndexInRange(range, (indices) => {
        const elementId = lattice.elementIdByKey.get(indexKey(indices));
        if (elementId !== undefined) {
            ids.push(elementId);
        }
    });
    return uniqueSorted(ids);
}
function forEachIndexInRange(range, callback) {
    for (let i = range.min[0]; i <= range.max[0]; i += 1) {
        for (let j = range.min[1]; j <= range.max[1]; j += 1) {
            for (let k = range.min[2]; k <= range.max[2]; k += 1) {
                callback([i, j, k]);
            }
        }
    }
}
function makeIndexRange(min, max) {
    return {
        min: [min[0], min[1], min[2]],
        max: [max[0], max[1], max[2]],
        dimensions: [
            max[0] - min[0] + 1,
            max[1] - min[1] + 1,
            max[2] - min[2] + 1
        ]
    };
}
function rangeVolume(range) {
    return range.dimensions[0] * range.dimensions[1] * range.dimensions[2];
}
function indexKey(indices) {
    return `${indices[0]}:${indices[1]}:${indices[2]}`;
}
function uniqueSorted(values) {
    return [...new Set(values)].sort((a, b) => a - b);
}
function uniqueStrings(values) {
    return [...new Set(values)];
}
