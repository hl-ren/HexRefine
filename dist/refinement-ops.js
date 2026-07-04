import { inferMeshKind, minElementEdgeLength, replaceElements, selectElementsByPredicate } from "./mesh.js";
import { buildDefaultRefinementReplacements } from "./refinement-planner.js";
import { regularizeHexSelection as regularizeHexSelectionCore } from "./regularization.js";
import { pointInBox as pointInBoxCore, selectElementsByDistanceFunction as selectElementsByDistanceFunctionCore } from "./mesh-selection.js";
export function refineByElementIds(mesh, selectedElementIds, options = {}) {
    return refineByElementIdsWithReport(mesh, selectedElementIds, options).mesh;
}
export function buildRefinementReplacements(mesh, selectedElementIds, options = {}) {
    return buildDefaultRefinementReplacements(mesh, selectedElementIds, options);
}
export function refineByElementIdsWithReport(mesh, selectedElementIds, options = {}) {
    const selected = uniqueSorted(selectedElementIds);
    if (selected.length === 0) {
        return buildRefinementResult(mesh, mesh, [], selected.length);
    }
    const mergeTolerance = options.mergeTolerance ?? minElementEdgeLength(mesh) * 0.0005;
    const replacements = buildDefaultRefinementReplacements(mesh, selected, {
        ...options,
        mergeTolerance
    });
    const refinedMesh = replaceElements(mesh, replacements, mergeTolerance);
    return buildRefinementResult(mesh, refinedMesh, replacements, selected.length);
}
export function refineByBox(mesh, box, options = {}) {
    return refineByBoxWithReport(mesh, box, options).mesh;
}
export function refineByBoxWithReport(mesh, box, options = {}) {
    const candidateIds = selectElementsByPredicate(mesh, (center) => pointInBox(center, box));
    const shouldRegularize = inferMeshKind(mesh) === "H1" && (options.regularizeHexSelection ?? true);
    if (!shouldRegularize) {
        return refineByElementIdsWithReport(mesh, candidateIds, options);
    }
    const regularizationOptions = options.regularizationTolerance === undefined
        ? {}
        : { tolerance: options.regularizationTolerance };
    const regularization = regularizeHexSelection(mesh, candidateIds, regularizationOptions);
    const result = refineByElementIdsWithReport(mesh, regularization.selectedElementIds, {
        ...options,
        regularizeHexSelection: false
    });
    return {
        ...result,
        regularization
    };
}
export function refineByDistanceFunction(mesh, distanceFunction, distValue = 0, options = {}) {
    return refineByDistanceFunctionWithReport(mesh, distanceFunction, distValue, options).mesh;
}
export function refineByDistanceFunctionWithReport(mesh, distanceFunction, distValue = 0, options = {}) {
    const selection = selectElementsByDistanceFunction(mesh, distanceFunction, distValue);
    const candidateIds = selection.inside;
    const shouldRegularize = inferMeshKind(mesh) === "H1" && (options.regularizeHexSelection ?? true);
    if (!shouldRegularize) {
        return refineByElementIdsWithReport(mesh, candidateIds, options);
    }
    const regularizationOptions = options.regularizationTolerance === undefined
        ? {}
        : { tolerance: options.regularizationTolerance };
    const regularization = regularizeHexSelection(mesh, candidateIds, regularizationOptions);
    const result = refineByElementIdsWithReport(mesh, regularization.selectedElementIds, {
        ...options,
        regularizeHexSelection: false
    });
    return {
        ...result,
        regularization
    };
}
export function previewRefinementByElementIds(mesh, selectedElementIds, options = {}) {
    const kind = inferMeshKind(mesh);
    const selected = uniqueSorted(selectedElementIds);
    const replacements = buildDefaultRefinementReplacements(mesh, selected, options);
    return buildRefinementPreview(mesh, kind, replacements);
}
export function previewRefinementByBox(mesh, box, options = {}) {
    const kind = inferMeshKind(mesh);
    const candidateIds = selectElementsByPredicate(mesh, (center) => pointInBox(center, box));
    const shouldRegularize = kind === "H1" && (options.regularizeHexSelection ?? true);
    if (!shouldRegularize) {
        return previewRefinementByElementIds(mesh, candidateIds, options);
    }
    const regularizationOptions = options.regularizationTolerance === undefined
        ? {}
        : { tolerance: options.regularizationTolerance };
    const regularization = regularizeHexSelection(mesh, candidateIds, regularizationOptions);
    const preview = previewRefinementByElementIds(mesh, regularization.selectedElementIds, {
        ...options,
        regularizeHexSelection: false
    });
    return {
        ...preview,
        regularization
    };
}
export function previewRefinementByDistanceFunction(mesh, distanceFunction, distValue = 0, options = {}) {
    const selection = selectElementsByDistanceFunction(mesh, distanceFunction, distValue);
    const candidateIds = selection.inside;
    const kind = inferMeshKind(mesh);
    const shouldRegularize = kind === "H1" && (options.regularizeHexSelection ?? true);
    if (!shouldRegularize) {
        return previewRefinementByElementIds(mesh, candidateIds, options);
    }
    const regularizationOptions = options.regularizationTolerance === undefined
        ? {}
        : { tolerance: options.regularizationTolerance };
    const regularization = regularizeHexSelection(mesh, candidateIds, regularizationOptions);
    const preview = previewRefinementByElementIds(mesh, regularization.selectedElementIds, {
        ...options,
        regularizeHexSelection: false
    });
    return {
        ...preview,
        regularization
    };
}
export function selectElementsByDistanceFunction(mesh, distanceFunction, distValue = 0) {
    return selectElementsByDistanceFunctionCore(mesh, distanceFunction, distValue);
}
export function regularizeHexSelection(mesh, candidateElementIds, options = {}) {
    return regularizeHexSelectionCore(mesh, candidateElementIds, options);
}
export function pointInBox(point, box) {
    return pointInBoxCore(point, box);
}
function buildRefinementResult(inputMesh, mesh, replacements, selectedElementCount) {
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
function buildRefinementPreview(mesh, kind, replacements) {
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
        kind,
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
function uniqueSorted(values) {
    return [...new Set(values)].sort((a, b) => a - b);
}
