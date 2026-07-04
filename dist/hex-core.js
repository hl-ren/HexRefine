import { inferMeshKind, minElementEdgeLength, replaceElements, selectElementsByPredicate } from "./mesh.js";
import { buildHexClassifiedReplacements as buildSharedHexClassifiedReplacements } from "./transitions.js";
import { regularizeHexSelection as regularizeHexSelectionCore } from "./regularization.js";
import { pointInBox as pointInBoxCore, selectElementsByDistanceFunction as selectElementsByDistanceFunctionCore } from "./mesh-selection.js";
export { regularizeHexSessionSelection } from "./session-regularization.js";
export function refineHexByElementIds(mesh, selectedElementIds, options = {}) {
    return refineHexByElementIdsWithReport(mesh, selectedElementIds, options).mesh;
}
export function refineHexByElementIdsWithReport(mesh, selectedElementIds, options = {}) {
    assertHexMesh(mesh);
    const selected = uniqueSorted(selectedElementIds);
    if (selected.length === 0) {
        return buildHexRefinementResult(mesh, mesh, [], 0);
    }
    const mergeTolerance = options.mergeTolerance ?? minElementEdgeLength(mesh) * 0.0005;
    const replacements = buildHexClassifiedReplacements(mesh, selected, {
        ...options,
        mergeTolerance
    });
    const refinedMesh = replaceElements(mesh, replacements, mergeTolerance);
    return buildHexRefinementResult(mesh, refinedMesh, replacements, selected.length);
}
export function refineHexByBox(mesh, box, options = {}) {
    return refineHexByBoxWithReport(mesh, box, options).mesh;
}
export function refineHexByBoxWithReport(mesh, box, options = {}) {
    assertHexMesh(mesh);
    const candidateIds = selectElementsByPredicate(mesh, (center) => pointInBox(center, box));
    return refineHexCandidateIdsWithReport(mesh, candidateIds, options);
}
export function refineHexByDistanceFunction(mesh, distanceFunction, distValue = 0, options = {}) {
    return refineHexByDistanceFunctionWithReport(mesh, distanceFunction, distValue, options).mesh;
}
export function refineHexByDistanceFunctionWithReport(mesh, distanceFunction, distValue = 0, options = {}) {
    assertHexMesh(mesh);
    const selection = selectHexElementsByDistanceFunction(mesh, distanceFunction, distValue);
    return refineHexCandidateIdsWithReport(mesh, selection.inside, options);
}
export function previewHexRefinementByElementIds(mesh, selectedElementIds, options = {}) {
    assertHexMesh(mesh);
    const selected = uniqueSorted(selectedElementIds);
    return buildHexRefinementPreview(mesh, buildHexClassifiedReplacements(mesh, selected, options));
}
export function previewHexRefinementByBox(mesh, box, options = {}) {
    assertHexMesh(mesh);
    const candidateIds = selectElementsByPredicate(mesh, (center) => pointInBox(center, box));
    return previewHexCandidateIds(mesh, candidateIds, options);
}
export function previewHexRefinementByDistanceFunction(mesh, distanceFunction, distValue = 0, options = {}) {
    assertHexMesh(mesh);
    const selection = selectHexElementsByDistanceFunction(mesh, distanceFunction, distValue);
    return previewHexCandidateIds(mesh, selection.inside, options);
}
export function selectHexElementsByDistanceFunction(mesh, distanceFunction, distValue = 0) {
    assertHexMesh(mesh);
    return selectElementsByDistanceFunctionCore(mesh, distanceFunction, distValue);
}
export function regularizeHexSelection(mesh, candidateElementIds, options = {}) {
    assertHexMesh(mesh);
    return regularizeHexSelectionCore(mesh, candidateElementIds, options);
}
export function refineHexCandidateIdsWithReport(mesh, candidateIds, options) {
    const shouldRegularize = options.regularizeHexSelection ?? true;
    if (!shouldRegularize) {
        return refineHexByElementIdsWithReport(mesh, candidateIds, options);
    }
    const regularizationOptions = options.regularizationTolerance === undefined
        ? {}
        : { tolerance: options.regularizationTolerance };
    const regularization = regularizeHexSelection(mesh, candidateIds, regularizationOptions);
    const result = refineHexByElementIdsWithReport(mesh, regularization.selectedElementIds, {
        ...options,
        regularizeHexSelection: false
    });
    return {
        ...result,
        regularization
    };
}
export function previewHexCandidateIds(mesh, candidateIds, options) {
    const shouldRegularize = options.regularizeHexSelection ?? true;
    if (!shouldRegularize) {
        return previewHexRefinementByElementIds(mesh, candidateIds, options);
    }
    const regularizationOptions = options.regularizationTolerance === undefined
        ? {}
        : { tolerance: options.regularizationTolerance };
    const regularization = regularizeHexSelection(mesh, candidateIds, regularizationOptions);
    const preview = previewHexRefinementByElementIds(mesh, regularization.selectedElementIds, {
        ...options,
        regularizeHexSelection: false
    });
    return {
        ...preview,
        regularization
    };
}
export function buildHexClassifiedReplacements(mesh, selected, options) {
    return buildSharedHexClassifiedReplacements(mesh, selected, options);
}
export function assertHexMesh(mesh) {
    if (inferMeshKind(mesh) !== "H1") {
        throw new Error("hex-refinement requires an H1/Hex mesh");
    }
}
function buildHexRefinementResult(inputMesh, mesh, replacements, selectedElementCount) {
    const replacedIds = new Set(replacements.map((replacement) => replacement.elementId));
    const cellData = [];
    for (let index = 0; index < inputMesh.elements.length; index += 1) {
        const elementId = index + 1;
        if (!replacedIds.has(elementId)) {
            cellData.push({
                parentElementId: elementId,
                role: "unchanged",
                templateCode: 0
            });
        }
    }
    for (const replacement of replacements) {
        for (let i = 0; i < replacement.refinement.elements.length; i += 1) {
            cellData.push({
                parentElementId: replacement.elementId,
                role: replacement.role,
                templateCode: replacement.templateCode
            });
        }
    }
    const countRole = (role) => replacements.filter((replacement) => replacement.role === role).length;
    return {
        mesh,
        cellData,
        summary: {
            selectedElementCount,
            faceTransitionElementCount: countRole("face-transition"),
            edgeTransitionElementCount: countRole("edge-transition"),
            cornerTransitionElementCount: countRole("corner-transition"),
            unchangedElementCount: cellData.filter((cell) => cell.role === "unchanged").length,
            outputNodeCount: mesh.nodes.length,
            outputElementCount: mesh.elements.length
        }
    };
}
function buildHexRefinementPreview(mesh, replacements) {
    const replacedIds = new Set(replacements.map((replacement) => replacement.elementId));
    const plan = replacements
        .map((replacement) => ({
        parentElementId: replacement.elementId,
        role: replacement.role,
        templateCode: replacement.templateCode,
        outputElementCount: replacement.refinement.elements.length
    }))
        .sort((a, b) => a.parentElementId - b.parentElementId || a.templateCode - b.templateCode);
    const countRole = (role) => plan.filter((item) => item.role === role).length;
    const unchangedElementCount = mesh.elements.length - replacedIds.size;
    return {
        kind: "H1",
        plan,
        summary: {
            selectedElementCount: countRole("selected"),
            faceTransitionElementCount: countRole("face-transition"),
            edgeTransitionElementCount: countRole("edge-transition"),
            cornerTransitionElementCount: countRole("corner-transition"),
            unchangedElementCount,
            estimatedOutputElementCount: unchangedElementCount + plan.reduce((total, item) => total + item.outputElementCount, 0)
        }
    };
}
function pointInBox(point, box) {
    return pointInBoxCore(point, box);
}
function uniqueSorted(values) {
    return [...new Set(values)].sort((a, b) => a - b);
}
