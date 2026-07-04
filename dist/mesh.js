import { boundaryKey, boundariesOf, elementKindFromNodeCount } from "./topology.js";
import { centroid, pointEquals } from "./vector.js";
export function inferMeshKind(mesh) {
    if (mesh.kind) {
        return mesh.kind;
    }
    const first = mesh.elements[0];
    if (!first) {
        throw new Error("cannot infer element kind from an empty mesh");
    }
    return elementKindFromNodeCount(first.length);
}
export function elementVertices(mesh, element) {
    return element.map((nodeId) => {
        const node = mesh.nodes[nodeId - 1];
        if (!node) {
            throw new Error(`element references missing node id ${nodeId}`);
        }
        return node;
    });
}
export function elementCenter(mesh, element) {
    return centroid(elementVertices(mesh, element));
}
export function elementCenters(mesh) {
    return mesh.elements.map((element) => elementCenter(mesh, element));
}
export function selectElementsByPredicate(mesh, predicate) {
    return mesh.elements
        .map((element, index) => ({ element, elementId: index + 1, center: elementCenter(mesh, element) }))
        .filter(({ center, element, elementId }) => predicate(center, element, elementId))
        .map(({ elementId }) => elementId);
}
export function findBoundaryPairs(mesh, selectedElementIds) {
    const selected = new Set(selectedElementIds);
    const kind = inferMeshKind(mesh);
    const selectedBoundaryOwner = new Map();
    const selectedBoundaryNodeIds = new Set();
    for (const elementId of selected) {
        const element = mesh.elements[elementId - 1];
        if (!element) {
            continue;
        }
        for (const boundary of boundariesOf(element, kind)) {
            const key = boundaryKey(boundary);
            const owners = selectedBoundaryOwner.get(key) ?? [];
            owners.push({ elementId, boundary });
            selectedBoundaryOwner.set(key, owners);
            for (const nodeId of boundary) {
                selectedBoundaryNodeIds.add(nodeId);
            }
        }
    }
    const pairs = [];
    if (selectedBoundaryOwner.size === 0) {
        return pairs;
    }
    mesh.elements.forEach((element, index) => {
        const neighborElementId = index + 1;
        if (selected.has(neighborElementId)) {
            return;
        }
        if (!element.some((nodeId) => selectedBoundaryNodeIds.has(nodeId))) {
            return;
        }
        for (const neighborBoundary of boundariesOf(element, kind)) {
            const owners = selectedBoundaryOwner.get(boundaryKey(neighborBoundary));
            if (!owners) {
                continue;
            }
            for (const owner of owners) {
                pairs.push({
                    selectedElementId: owner.elementId,
                    neighborElementId,
                    selectedBoundary: owner.boundary,
                    neighborBoundary
                });
            }
        }
    });
    return pairs;
}
export function replaceElements(mesh, replacements, mergeTolerance) {
    const replacedIds = new Set(replacements.map((replacement) => replacement.elementId));
    const nodes = [...mesh.nodes];
    const elements = mesh.elements.filter((_, index) => !replacedIds.has(index + 1)).map((element) => [...element]);
    for (const { refinement } of replacements) {
        const offset = nodes.length;
        nodes.push(...refinement.nodes);
        elements.push(...refinement.elements.map((element) => element.map((nodeId) => nodeId + offset)));
    }
    return mergeCoincidentNodes(mesh.kind ? { nodes, elements, kind: mesh.kind } : { nodes, elements }, mergeTolerance);
}
export function mergeCoincidentNodes(mesh, tolerance) {
    return mergeCoincidentNodesWithMap(mesh, tolerance).mesh;
}
export function mergeCoincidentNodesWithMap(mesh, tolerance) {
    if (tolerance < 0) {
        throw new Error("merge tolerance must be non-negative");
    }
    const nodes = [];
    const oldToNewArray = new Array(mesh.nodes.length + 1);
    const inputNodeIdsByNodeIdArray = [];
    const buckets = new Map();
    const exactNodeIndexByKey = new Map();
    mesh.nodes.forEach((node, oldIndex) => {
        const inputNodeId = oldIndex + 1;
        const exactKey = exactMergeKey(node);
        const exactIndex = exactNodeIndexByKey.get(exactKey);
        const existingIndex = exactIndex ?? findCoincidentNodeIndex(node, nodes, buckets, tolerance);
        const newNodeId = existingIndex === undefined ? nodes.length + 1 : existingIndex + 1;
        if (existingIndex === undefined) {
            nodes.push(node);
            exactNodeIndexByKey.set(exactKey, nodes.length - 1);
            addNodeToMergeBucket(node, nodes.length - 1, buckets, tolerance);
        }
        oldToNewArray[inputNodeId] = newNodeId;
        const inputNodeIds = inputNodeIdsByNodeIdArray[newNodeId] ?? [];
        inputNodeIds.push(inputNodeId);
        inputNodeIdsByNodeIdArray[newNodeId] = inputNodeIds;
    });
    const elements = mesh.elements.map((element) => element.map((nodeId) => {
        const mapped = oldToNewArray[nodeId];
        if (!mapped) {
            throw new Error(`element references missing node id ${nodeId}`);
        }
        return mapped;
    }));
    const oldToNew = new Map();
    for (let inputNodeId = 1; inputNodeId < oldToNewArray.length; inputNodeId += 1) {
        const nodeId = oldToNewArray[inputNodeId];
        if (nodeId !== undefined) {
            oldToNew.set(inputNodeId, nodeId);
        }
    }
    const inputNodeIdsByNodeId = new Map();
    for (let nodeId = 1; nodeId < inputNodeIdsByNodeIdArray.length; nodeId += 1) {
        const inputNodeIds = inputNodeIdsByNodeIdArray[nodeId];
        if (inputNodeIds) {
            inputNodeIdsByNodeId.set(nodeId, inputNodeIds);
        }
    }
    return {
        mesh: mesh.kind ? { nodes, elements, kind: mesh.kind } : { nodes, elements },
        nodeIdByInputNodeId: oldToNew,
        inputNodeIdsByNodeId,
        nodeIdByInputNodeIdArray: oldToNewArray,
        inputNodeIdsByNodeIdArray
    };
}
function findCoincidentNodeIndex(node, nodes, buckets, tolerance) {
    let bestIndex;
    forEachCandidateMergeBucketKey(node, tolerance, (key) => {
        for (const candidateIndex of buckets.get(key) ?? []) {
            if ((bestIndex === undefined || candidateIndex < bestIndex) &&
                pointEquals(nodes[candidateIndex], node, tolerance)) {
                bestIndex = candidateIndex;
            }
        }
    });
    return bestIndex;
}
function addNodeToMergeBucket(node, nodeIndex, buckets, tolerance) {
    const key = mergeBucketKeyForNode(node, tolerance);
    const bucket = buckets.get(key) ?? [];
    bucket.push(nodeIndex);
    buckets.set(key, bucket);
}
function forEachCandidateMergeBucketKey(node, tolerance, visit) {
    if (tolerance === 0) {
        visit(node.join(":"));
        return;
    }
    const i = Math.floor((node[0] ?? 0) / tolerance);
    const j = Math.floor((node[1] ?? 0) / tolerance);
    const k = Math.floor((node[2] ?? 0) / tolerance);
    if (node.length <= 2) {
        for (let di = -1; di <= 1; di += 1) {
            for (let dj = -1; dj <= 1; dj += 1) {
                visit(`${i + di}:${j + dj}`);
            }
        }
        return;
    }
    for (let di = -1; di <= 1; di += 1) {
        for (let dj = -1; dj <= 1; dj += 1) {
            for (let dk = -1; dk <= 1; dk += 1) {
                visit(`${i + di}:${j + dj}:${k + dk}`);
            }
        }
    }
}
function mergeBucketKeyForNode(node, tolerance) {
    if (tolerance === 0) {
        return node.join(":");
    }
    const i = Math.floor((node[0] ?? 0) / tolerance);
    const j = Math.floor((node[1] ?? 0) / tolerance);
    if (node.length <= 2) {
        return `${i}:${j}`;
    }
    return `${i}:${j}:${Math.floor((node[2] ?? 0) / tolerance)}`;
}
function exactMergeKey(node) {
    return node.length <= 2
        ? `${node[0] ?? 0}:${node[1] ?? 0}`
        : `${node[0] ?? 0}:${node[1] ?? 0}:${node[2] ?? 0}`;
}
export function minElementEdgeLength(mesh) {
    const kind = inferMeshKind(mesh);
    const localEdges = kind === "Q1"
        ? [
            [0, 1],
            [1, 2],
            [2, 3],
            [3, 0]
        ]
        : [
            [0, 1],
            [1, 2],
            [2, 3],
            [3, 0],
            [4, 5],
            [5, 6],
            [6, 7],
            [7, 4],
            [0, 4],
            [1, 5],
            [2, 6],
            [3, 7]
        ];
    let minimum = Infinity;
    for (const element of mesh.elements) {
        const vertices = elementVertices(mesh, element);
        for (const [a, b] of localEdges) {
            if (a === undefined || b === undefined) {
                throw new Error("invalid local edge definition");
            }
            const pa = vertices[a];
            const pb = vertices[b];
            let total = 0;
            for (let d = 0; d < pa.length; d += 1) {
                const delta = pa[d] - pb[d];
                total += delta * delta;
            }
            minimum = Math.min(minimum, Math.sqrt(total));
        }
    }
    return minimum;
}
export function instantiateOnElement(mesh, elementId, factory) {
    const element = mesh.elements[elementId - 1];
    if (!element) {
        throw new Error(`element id ${elementId} is out of range`);
    }
    return {
        elementId,
        refinement: factory(elementVertices(mesh, element))
    };
}
