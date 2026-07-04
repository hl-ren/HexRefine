import { elementVertices, findBoundaryPairs, instantiateOnElement, minElementEdgeLength } from "./mesh.js";
import { alignHexEdgeToVertical, alignHexFaceToBottom, sharedNodes } from "./topology.js";
import { refineHexTo13Hex, refineHexTo27Hex, refineHexTo5Hex } from "./templates.js";
export function buildHexClassifiedReplacements(mesh, selected, options = {}) {
    const includeTransitions = options.includeTransitions ?? true;
    const mergeTolerance = options.mergeTolerance ?? minElementEdgeLength(mesh) * 0.0005;
    const replacements = [];
    for (const elementId of selected) {
        replacements.push(classifyHexReplacement(instantiateOnElement(mesh, elementId, refineHexTo27Hex), "selected", 27));
    }
    if (includeTransitions) {
        const boundaryPairs = findBoundaryPairs(mesh, selected);
        replacements.push(...hexFaceTransitionReplacements(mesh, boundaryPairs, mergeTolerance));
        replacements.push(...hexEdgeTransitionReplacements(mesh, boundaryPairs));
        replacements.push(...hexForcedSupportTransitionReplacements(mesh, selected, options.transitionSupportElementIds ?? [], replacements, mergeTolerance));
    }
    return replacements;
}
export function hexFaceTransitionReplacements(mesh, boundaryPairs, mergeTolerance) {
    const byNeighbor = groupBy(boundaryPairs, (pair) => pair.neighborElementId);
    const replacements = [];
    for (const [neighborIdText, pairs] of byNeighbor) {
        const neighborElementId = Number(neighborIdText);
        const neighborElement = mesh.elements[neighborElementId - 1];
        if (!neighborElement) {
            throw new Error(`neighbor element id ${neighborElementId} is out of range`);
        }
        const pair = pairs[0];
        if (!pair) {
            continue;
        }
        const alignedElement = alignHexFaceToBottom(neighborElement, pair.neighborBoundary);
        replacements.push({
            elementId: neighborElementId,
            refinement: refineHexTo13Hex(elementVertices(mesh, alignedElement), mergeTolerance),
            role: "face-transition",
            templateCode: 13
        });
    }
    return replacements;
}
export function hexEdgeTransitionReplacements(mesh, boundaryPairs) {
    const bySelected = groupBy(boundaryPairs, (pair) => pair.selectedElementId);
    const faceNeighborIds = new Set(boundaryPairs.map((pair) => pair.neighborElementId));
    const replacementsByElement = new Map();
    const elementIdsByNodeId = buildElementIdsByNodeId(mesh);
    for (const pairs of bySelected.values()) {
        for (let i = 0; i < pairs.length; i += 1) {
            for (let j = i + 1; j < pairs.length; j += 1) {
                const edge = sharedNodes(pairs[i].selectedBoundary, pairs[j].selectedBoundary);
                if (edge.length !== 2) {
                    continue;
                }
                const edgeNeighbor = findElementSharingNodes(mesh, edge, elementIdsByNodeId, (elementId) => elementId !== pairs[i].selectedElementId &&
                    elementId !== pairs[i].neighborElementId &&
                    elementId !== pairs[j].neighborElementId &&
                    !faceNeighborIds.has(elementId));
                if (!edgeNeighbor || replacementsByElement.has(edgeNeighbor)) {
                    continue;
                }
                const element = mesh.elements[edgeNeighbor - 1];
                const alignedElement = alignHexEdgeToVertical(element, edge);
                replacementsByElement.set(edgeNeighbor, {
                    elementId: edgeNeighbor,
                    refinement: refineHexTo5Hex(elementVertices(mesh, alignedElement)),
                    role: "edge-transition",
                    templateCode: 5
                });
            }
        }
    }
    return [...replacementsByElement.values()];
}
function hexForcedSupportTransitionReplacements(mesh, selected, supportElementIds, existing, mergeTolerance) {
    if (supportElementIds.length === 0) {
        return [];
    }
    const selectedSet = new Set(selected);
    const existingSet = new Set(existing.map((replacement) => replacement.elementId));
    const selectedElements = selected
        .map((elementId) => ({ elementId, element: mesh.elements[elementId - 1] }))
        .filter((item) => item.element !== undefined);
    const replacements = [];
    for (const supportElementId of uniqueSorted(supportElementIds)) {
        if (selectedSet.has(supportElementId) || existingSet.has(supportElementId)) {
            continue;
        }
        const supportElement = mesh.elements[supportElementId - 1];
        if (!supportElement) {
            continue;
        }
        const shared = bestSharedNodesWithSelected(supportElement, selectedElements);
        if (shared.length >= 4) {
            const faceNodes = shared.slice(0, 4);
            replacements.push({
                elementId: supportElementId,
                refinement: refineHexTo13Hex(elementVertices(mesh, alignHexFaceToBottom(supportElement, faceNodes)), mergeTolerance),
                role: "face-transition",
                templateCode: 13
            });
            existingSet.add(supportElementId);
            continue;
        }
        if (shared.length >= 2) {
            const edgeNodes = shared.slice(0, 2);
            replacements.push({
                elementId: supportElementId,
                refinement: refineHexTo5Hex(elementVertices(mesh, alignHexEdgeToVertical(supportElement, edgeNodes))),
                role: "edge-transition",
                templateCode: 5
            });
            existingSet.add(supportElementId);
            continue;
        }
        if (shared.length === 1) {
            replacements.push({
                elementId: supportElementId,
                refinement: refineHexTo5Hex(elementVertices(mesh, supportElement)),
                role: "corner-transition",
                templateCode: 5
            });
            existingSet.add(supportElementId);
        }
    }
    return replacements;
}
function bestSharedNodesWithSelected(supportElement, selectedElements) {
    const supportNodes = new Set(supportElement);
    let best = [];
    for (const selected of selectedElements) {
        const shared = selected.element.filter((nodeId) => supportNodes.has(nodeId));
        if (shared.length > best.length) {
            best = shared;
        }
    }
    return best;
}
function classifyHexReplacement(replacement, role, templateCode) {
    return {
        ...replacement,
        role,
        templateCode
    };
}
function buildElementIdsByNodeId(mesh) {
    const owners = new Map();
    mesh.elements.forEach((element, index) => {
        const elementId = index + 1;
        for (const nodeId of element) {
            const list = owners.get(nodeId) ?? [];
            list.push(elementId);
            owners.set(nodeId, list);
        }
    });
    return owners;
}
function findElementSharingNodes(mesh, nodeIds, elementIdsByNodeId, predicate) {
    const ownerLists = nodeIds
        .map((nodeId) => elementIdsByNodeId.get(nodeId) ?? [])
        .sort((a, b) => a.length - b.length);
    const candidates = ownerLists[0] ?? [];
    for (const elementId of candidates) {
        const element = mesh.elements[elementId - 1];
        if (element && predicate(elementId) && nodeIds.every((nodeId) => element.includes(nodeId))) {
            return elementId;
        }
    }
    return undefined;
}
function groupBy(values, key) {
    const result = new Map();
    for (const value of values) {
        const text = String(key(value));
        const group = result.get(text) ?? [];
        group.push(value);
        result.set(text, group);
    }
    return result;
}
function uniqueSorted(values) {
    return [...new Set(values)].sort((a, b) => a - b);
}
