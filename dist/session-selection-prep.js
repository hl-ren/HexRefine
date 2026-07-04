import { activeBuildCellIdByElementId, activeBuildElementIdByCellId } from "./refinement-session.js";
import { previewRefinementByElementIds } from "./refinement-ops.js";
import { regularizeHexSessionSelection } from "./session-regularization.js";
const topologyNeighborsCache = new WeakMap();
const edgeOwnersCache = new WeakMap();
const nodeOwnersCache = new WeakMap();
const elementCenterCache = new WeakMap();
export function prepareSessionRefineSelection(session, active, selectedElementIds, options = {}) {
    const rawElementIds = uniqueSorted(selectedElementIds);
    const baseResult = {
        elementIds: rawElementIds,
        cellIds: mapCellIdsFromElementIds(active, rawElementIds),
        warnings: []
    };
    const shouldRegularize = session.kind === "H1" && (options.regularizeHexSelection ?? true) && rawElementIds.length > 0;
    if (!shouldRegularize) {
        return baseResult;
    }
    const filtered = filterElementIdsToOneRefinableSessionLevel(session, active, rawElementIds);
    if (filtered.elementIds.length === 0) {
        return {
            elementIds: [],
            cellIds: [],
            sourceElementCount: rawElementIds.length,
            expandedCandidateCount: 0,
            boundedCoreCount: 0,
            warnings: [
                ...filtered.warnings,
                filtered.warnings[0] ?? "Selection has no active non-transition Hex at a single refinement level."
            ]
        };
    }
    const filteredCellIds = mapCellIdsFromElementIds(active, filtered.elementIds);
    const components = connectedElementComponents(active.mesh, filtered.elementIds);
    const regularizedComponents = components.map((component) => {
        const componentDomainElementIds = componentConnectedDomainElementIds(active.mesh, component, filtered.domainElementIdSet);
        const componentDomain = filtered.level === undefined
            ? undefined
            : buildActiveRegularizationDomain(session, active, filtered.level, componentDomainElementIds);
        return prepareRegularizedComponent(session, active, component, componentDomainElementIds, options, componentDomain);
    });
    const successfulComponents = regularizedComponents.filter((component) => component.ok);
    const warnings = [
        ...filtered.warnings,
        ...regularizedComponents.flatMap((component) => component.warnings)
    ];
    if (successfulComponents.length === 0) {
        return {
            elementIds: filtered.elementIds,
            cellIds: filteredCellIds,
            sourceElementCount: rawElementIds.length,
            expandedCandidateCount: regularizedComponents.reduce((total, component) => total + component.expandedCandidateCount, 0),
            warnings,
            notice: regularizedComponents.length > 1
                ? "Regularization could not find complete uvw Hex blocks for the disconnected regions; falling back to direct same-level refinement."
                : "Regularization could not find a complete uvw Hex block; falling back to direct same-level refinement."
        };
    }
    const boundedElementIds = uniqueSorted(successfulComponents.flatMap((component) => component.boundedElementIds));
    const outerElementIds = uniqueSorted(successfulComponents.flatMap((component) => component.regularization.selectedElementIds));
    const regularization = combineRegularizedComponents(successfulComponents.map((component) => component.regularization));
    const containmentPreview = previewRefinementByElementIds(active.mesh, boundedElementIds, {
        ...options,
        regularizeHexSelection: false
    });
    const escaped = countTransitionEscapes(containmentPreview.plan, outerElementIds);
    const expandedCandidateCount = regularizedComponents.reduce((total, component) => total + component.expandedCandidateCount, 0);
    const grewAnyComponent = successfulComponents.some((component) => component.grewTopologyLayer);
    return {
        elementIds: boundedElementIds,
        cellIds: mapCellIdsFromElementIds(active, boundedElementIds),
        regularization,
        outerElementIds,
        outerCellIds: mapCellIdsFromElementIds(active, outerElementIds),
        sourceElementCount: rawElementIds.length,
        expandedCandidateCount,
        boundedCoreCount: boundedElementIds.length,
        ...(escaped > 0 ? { transitionEscapeCount: escaped } : {}),
        warnings,
        notice: escaped > 0
            ? `Regularized block overflowed by ${escaped} transition parent${escaped === 1 ? "" : "s"}; refinement will extend into neighboring cells outside the block.`
            : successfulComponents.length > 1
                ? `Split the selection into ${successfulComponents.length} disconnected uvw blocks, regularized each block, then refined their cores.`
                : grewAnyComponent
                    ? "Expanded the user selection by one uvw layer, found a regular block, then refined its core."
                    : "Found a regular uvw shell from the selection, then refined its core."
    };
}
function prepareRegularizedComponent(session, active, componentElementIds, domainElementIds, options, domain) {
    const componentCellIds = mapCellIdsFromElementIds(active, componentElementIds);
    const initialAttempt = prepareRegularizedComponentAttempt(session, active, componentCellIds, componentElementIds, domainElementIds, options, domain, 0);
    if (initialAttempt.ok) {
        return initialAttempt;
    }
    const grownAttempt = prepareRegularizedComponentAttempt(session, active, componentCellIds, componentElementIds, domainElementIds, options, domain, 1);
    return grownAttempt.ok ? grownAttempt : (initialAttempt.ok ? initialAttempt : grownAttempt);
}
function prepareRegularizedComponentAttempt(session, active, componentCellIds, componentElementIds, domainElementIds, options, domain, growTopologyLayers) {
    const sessionRegularization = regularizeHexSessionSelection(session, componentCellIds, {
        growTopologyLayers,
        boundaryShellOnly: options.regularizeHexBoundaryShell ?? true,
        ...(domain ? { domain } : {}),
        ...(options.regularizationTolerance !== undefined ? { tolerance: options.regularizationTolerance } : {})
    });
    const regularization = structuredRegularizationFromSessionResult(session, active, domainElementIds, sessionRegularization);
    const warnings = sessionRegularization.warnings.filter((warning) => !warning.startsWith("grew selection by topology layer from "));
    let supportFallback;
    const getSupportFallback = () => {
        supportFallback ??= topologicalSupportRegularization(active.mesh, componentElementIds, domainElementIds, growTopologyLayers);
        return supportFallback;
    };
    if (regularization.selectedElementIds.length === 0) {
        const fallback = getSupportFallback();
        if (fallback) {
            return {
                ok: true,
                regularization: fallback.regularization,
                boundedElementIds: fallback.boundedElementIds,
                expandedCandidateCount: fallback.regularization.selectedElementIds.length,
                grewTopologyLayer: growTopologyLayers > 0,
                warnings: successfulRegularizationWarnings([...warnings, ...fallback.regularization.warnings])
            };
        }
        return {
            ok: false,
            regularization,
            boundedElementIds: [],
            expandedCandidateCount: sessionRegularization.expandedCellIds.length,
            grewTopologyLayer: growTopologyLayers > 0,
            warnings
        };
    }
    const blockCheck = validateRegularizedBlock(active.mesh, regularization);
    if (!blockCheck.ok) {
        const fallback = getSupportFallback();
        if (fallback) {
            return {
                ok: true,
                regularization: fallback.regularization,
                boundedElementIds: fallback.boundedElementIds,
                expandedCandidateCount: fallback.regularization.selectedElementIds.length,
                grewTopologyLayer: growTopologyLayers > 0,
                warnings: successfulRegularizationWarnings([...warnings, ...fallback.regularization.warnings])
            };
        }
        return {
            ok: false,
            regularization,
            boundedElementIds: [],
            expandedCandidateCount: sessionRegularization.expandedCellIds.length,
            grewTopologyLayer: growTopologyLayers > 0,
            warnings: [...warnings, blockCheck.warning]
        };
    }
    const bounded = boundedTransitionCoreElementIds(active.mesh, regularization);
    if (bounded.elementIds.length === 0) {
        const fallback = getSupportFallback();
        if (fallback) {
            return {
                ok: true,
                regularization: fallback.regularization,
                boundedElementIds: fallback.boundedElementIds,
                expandedCandidateCount: fallback.regularization.selectedElementIds.length,
                grewTopologyLayer: growTopologyLayers > 0,
                warnings: successfulRegularizationWarnings([...warnings, ...fallback.regularization.warnings])
            };
        }
        return {
            ok: false,
            regularization,
            boundedElementIds: [],
            expandedCandidateCount: sessionRegularization.expandedCellIds.length,
            grewTopologyLayer: growTopologyLayers > 0,
            warnings: [...warnings, "Regularized block has no valid inner core."]
        };
    }
    return {
        ok: true,
        regularization,
        boundedElementIds: bounded.elementIds,
        expandedCandidateCount: sessionRegularization.expandedCellIds.length,
        grewTopologyLayer: growTopologyLayers > 0,
        warnings: successfulRegularizationWarnings(warnings)
    };
}
function componentConnectedDomainElementIds(mesh, componentElementIds, allowedElementIds) {
    const seedIds = uniqueSorted(componentElementIds.filter((elementId) => allowedElementIds.has(elementId)));
    if (seedIds.length === 0) {
        return [];
    }
    const neighbors = topologyNeighborsByElementId(mesh);
    const visited = new Set();
    const stack = [...seedIds];
    for (const seed of seedIds) {
        visited.add(seed);
    }
    while (stack.length > 0) {
        const elementId = stack.pop();
        for (const neighborElementId of neighbors.get(elementId) ?? []) {
            if (!allowedElementIds.has(neighborElementId) || visited.has(neighborElementId)) {
                continue;
            }
            visited.add(neighborElementId);
            stack.push(neighborElementId);
        }
    }
    return uniqueSorted([...visited]);
}
function buildActiveRegularizationDomain(session, active, level, activeElementIds) {
    const oldToNewNodeId = new Map();
    const nodes = [];
    const elements = [];
    const cellIds = [];
    const cellIdByElementId = new Map();
    const elementIdByCellId = new Map();
    for (const activeElementId of uniqueSorted(activeElementIds)) {
        const activeElement = active.mesh.elements[activeElementId - 1];
        const cellId = activeBuildCellIdByElementId(active, activeElementId);
        const cell = cellId ? session.cells.get(cellId) : undefined;
        if (!activeElement || !cellId || !cell || cell.kind !== "H1" || cell.level !== level) {
            continue;
        }
        const domainElementId = elements.length + 1;
        const mappedElement = activeElement.map((nodeId) => {
            let mapped = oldToNewNodeId.get(nodeId);
            if (mapped === undefined) {
                const node = active.mesh.nodes[nodeId - 1];
                if (!node) {
                    throw new Error(`active element ${activeElementId} references missing node ${nodeId}`);
                }
                mapped = nodes.length + 1;
                oldToNewNodeId.set(nodeId, mapped);
                nodes.push(node);
            }
            return mapped;
        });
        elements.push(mappedElement);
        cellIds.push(cellId);
        cellIdByElementId.set(domainElementId, cellId);
        elementIdByCellId.set(cellId, domainElementId);
    }
    return {
        level,
        cellIds,
        mesh: { kind: "H1", nodes, elements },
        cellIdByElementId,
        elementIdByCellId
    };
}
function successfulRegularizationWarnings(warnings) {
    return uniqueSortedStrings(warnings.filter((warning) => warning.startsWith("Selection spans multiple refinement levels") ||
        warning.startsWith("Ignored ") ||
        warning.startsWith("ignored cells outside active same-level refinable domain")));
}
function topologicalSupportRegularization(mesh, componentElementIds, domainElementIds, growTopologyLayers) {
    if ((mesh.kind ?? "H1") !== "H1") {
        return null;
    }
    const domainSet = new Set(domainElementIds);
    const sourceIds = uniqueSorted(componentElementIds.filter((elementId) => domainSet.has(elementId)));
    if (sourceIds.length === 0) {
        return null;
    }
    let supportIds = sourceIds;
    for (let layer = 0; layer < growTopologyLayers; layer += 1) {
        supportIds = expandElementIdsByOneTopologicalLayer(mesh, supportIds)
            .filter((elementId) => domainSet.has(elementId));
    }
    supportIds = uniqueSorted(supportIds);
    const boundedElementIds = completeTopologicalSupportCoreElementIds(mesh, supportIds, domainSet);
    if (boundedElementIds.length === 0) {
        return null;
    }
    const supportSet = new Set(supportIds);
    const sourceSet = new Set(sourceIds);
    const regularization = {
        originalElementIds: sourceIds,
        selectedElementIds: supportIds,
        addedElementIds: supportIds.filter((elementId) => !sourceSet.has(elementId)),
        removedElementIds: sourceIds.filter((elementId) => !supportSet.has(elementId)),
        warnings: [
            growTopologyLayers > 0
                ? "used topology-neighborhood uvw support fallback after growing one layer"
                : "used topology-neighborhood uvw support fallback from the original selection"
        ]
    };
    return { regularization, boundedElementIds };
}
function completeTopologicalSupportCoreElementIds(mesh, supportElementIds, domainElementIds) {
    const supportSet = new Set(supportElementIds);
    const ownersByNode = nodeOwnersByNodeId(mesh);
    const core = [];
    for (const elementId of supportElementIds) {
        const element = mesh.elements[elementId - 1];
        if (!element) {
            continue;
        }
        let hasCompleteSupport = true;
        for (const nodeId of element) {
            for (const neighborElementId of ownersByNode.get(nodeId) ?? []) {
                if (domainElementIds.has(neighborElementId) && !supportSet.has(neighborElementId)) {
                    hasCompleteSupport = false;
                    break;
                }
            }
            if (!hasCompleteSupport) {
                break;
            }
        }
        if (hasCompleteSupport) {
            core.push(elementId);
        }
    }
    return uniqueSorted(core);
}
function combineRegularizedComponents(components) {
    const combined = {
        originalElementIds: uniqueSorted(components.flatMap((component) => component.originalElementIds)),
        selectedElementIds: uniqueSorted(components.flatMap((component) => component.selectedElementIds)),
        addedElementIds: uniqueSorted(components.flatMap((component) => component.addedElementIds)),
        removedElementIds: uniqueSorted(components.flatMap((component) => component.removedElementIds)),
        warnings: components.flatMap((component) => component.warnings),
        components: components.map((component) => ({
            originalElementIds: [...component.originalElementIds],
            selectedElementIds: [...component.selectedElementIds],
            addedElementIds: [...component.addedElementIds],
            removedElementIds: [...component.removedElementIds],
            ...(component.gridDimensions ? { gridDimensions: [...component.gridDimensions] } : {}),
            ...(component.indexRange ? { indexRange: { ...component.indexRange, min: [...component.indexRange.min], max: [...component.indexRange.max], dimensions: [...component.indexRange.dimensions] } } : {}),
            warnings: [...component.warnings]
        }))
    };
    if (components.length === 1) {
        const component = components[0];
        if (component.gridDimensions) {
            combined.gridDimensions = component.gridDimensions;
        }
        if (component.indexRange) {
            combined.indexRange = component.indexRange;
        }
        if (component.rankIndex) {
            combined.rankIndex = component.rankIndex;
        }
    }
    return combined;
}
function mapCellIdsFromElementIds(active, elementIds) {
    return uniqueSorted(elementIds)
        .map((elementId) => activeBuildCellIdByElementId(active, elementId))
        .filter((cellId) => cellId !== undefined);
}
function mapElementIdsFromCellIds(session, active, cellIds) {
    return uniqueSorted(cellIds
        .map((cellId) => activeBuildElementIdByCellId(session, active, cellId))
        .filter((elementId) => elementId !== undefined));
}
function structuredRegularizationFromSessionResult(session, active, domainElementIds, result) {
    const selectedElementIds = mapElementIdsFromCellIds(session, active, result.selectedCellIds);
    return {
        ...result.regularization,
        originalElementIds: mapElementIdsFromCellIds(session, active, result.originalCellIds),
        selectedElementIds,
        addedElementIds: mapElementIdsFromCellIds(session, active, result.addedCellIds),
        removedElementIds: mapElementIdsFromCellIds(session, active, result.removedCellIds),
        ...(result.regularization.indexRange || result.regularization.gridDimensions
            ? { rankIndex: centerRankIndexForElementIds(active.mesh, domainElementIds) }
            : {})
    };
}
function filterElementIdsToOneRefinableSessionLevel(session, active, elementIds) {
    const groups = new Map();
    const ignoredElementIds = [];
    let transitionCount = 0;
    let inactiveCount = 0;
    for (const elementId of elementIds) {
        const cellId = activeBuildCellIdByElementId(active, elementId);
        const cell = cellId ? session.cells.get(cellId) : undefined;
        if (!cellId || !cell || cell.kind !== "H1" || !cell.active || cell.hidden || !session.activeLeafIds.has(cellId)) {
            ignoredElementIds.push(elementId);
            inactiveCount += 1;
            continue;
        }
        if (isTransitionSessionRole(cell.role)) {
            ignoredElementIds.push(elementId);
            transitionCount += 1;
            continue;
        }
        const ids = groups.get(cell.level) ?? [];
        ids.push(elementId);
        groups.set(cell.level, ids);
    }
    let selectedLevel;
    let selectedCount = -1;
    for (const [level, ids] of groups) {
        if (ids.length > selectedCount || (ids.length === selectedCount && (selectedLevel === undefined || level > selectedLevel))) {
            selectedLevel = level;
            selectedCount = ids.length;
        }
    }
    const selectedLevelIds = selectedLevel === undefined ? [] : groups.get(selectedLevel) ?? [];
    for (const [level, ids] of groups) {
        if (level !== selectedLevel) {
            ignoredElementIds.push(...ids);
        }
    }
    const domainElementIdSet = new Set();
    if (selectedLevel !== undefined) {
        for (const cellId of session.activeLeafIds) {
            const cell = session.cells.get(cellId);
            const elementId = activeBuildElementIdByCellId(session, active, cellId);
            if (elementId !== undefined &&
                cell &&
                cell.kind === "H1" &&
                cell.level === selectedLevel &&
                cell.active &&
                !cell.hidden &&
                !isTransitionSessionRole(cell.role)) {
                domainElementIdSet.add(elementId);
            }
        }
    }
    const warnings = [];
    if (groups.size > 1) {
        warnings.push(`Selection spans multiple refinement levels; using level ${selectedLevel}.`);
    }
    if (transitionCount > 0) {
        warnings.push(`Ignored ${transitionCount} transition-layer Hex cells.`);
    }
    if (inactiveCount > 0) {
        warnings.push(`Ignored ${inactiveCount} inactive or invalid Hex cells.`);
    }
    const otherLevelCount = ignoredElementIds.length - transitionCount - inactiveCount;
    if (otherLevelCount > 0) {
        warnings.push(`Ignored ${otherLevelCount} Hex cells outside level ${selectedLevel}.`);
    }
    return {
        elementIds: uniqueSorted(selectedLevelIds),
        level: selectedLevel,
        domainElementIds: uniqueSorted([...domainElementIdSet]),
        domainElementIdSet,
        ignoredElementIds: uniqueSorted(ignoredElementIds),
        warnings
    };
}
function isTransitionSessionRole(role) {
    return role === "face-transition" || role === "edge-transition" || role === "corner-transition";
}
function expandElementIdsByOneUvwLayer(mesh, elementIds, allowedElementIds = null) {
    const topologicalCandidates = expandElementIdsByOneTopologicalLayer(mesh, elementIds)
        .filter((elementId) => !allowedElementIds || allowedElementIds.has(elementId));
    const index = centerRankIndexForElementIds(mesh, topologicalCandidates);
    const sourceIds = elementIds.filter((elementId) => index.ranksByElementId.has(elementId));
    if (sourceIds.length > 0) {
        const sourceRange = boundingRankRange(sourceIds, index);
        const boundarySides = rangeBoundarySides(mesh, sourceRange, index.coordinates.map((values) => values.length), index);
        const outerRange = expandCoreRangeByRequiredLayer(sourceRange, boundarySides);
        const grown = exactElementIdsInIndexRange(outerRange, index);
        if (grown.ids.length > 0 && grown.missingCount === 0) {
            return filterGrownLayerByTopology(mesh, grown.ids, new Set(sourceIds), sourceRange, boundarySides, index);
        }
    }
    return topologicalCandidates;
}
function expandElementIdsByOneTopologicalLayer(mesh, elementIds) {
    const neighbors = topologyNeighborsByElementId(mesh);
    const expanded = new Set(elementIds);
    for (const elementId of elementIds) {
        for (const neighborId of neighbors.get(elementId) ?? []) {
            expanded.add(neighborId);
        }
        for (const neighborId of edgeNeighborElementIds(mesh, elementId)) {
            expanded.add(neighborId);
        }
        for (const neighborId of nodeNeighborElementIds(mesh, elementId)) {
            expanded.add(neighborId);
        }
    }
    return uniqueSorted([...expanded]);
}
function edgeNeighborElementIds(mesh, elementId) {
    const element = mesh.elements[elementId - 1];
    if (!element) {
        return [];
    }
    const ownersByKey = edgeOwnersByNodeKey(mesh);
    const ids = new Set();
    for (const [a, b] of H1_EDGE_NODE_PAIRS) {
        const key = edgeKey(element[a], element[b]);
        for (const owner of ownersByKey.get(key) ?? []) {
            ids.add(owner.elementId);
        }
    }
    return [...ids];
}
function nodeNeighborElementIds(mesh, elementId) {
    const element = mesh.elements[elementId - 1];
    if (!element) {
        return [];
    }
    const ownersByNode = nodeOwnersByNodeId(mesh);
    const ids = new Set();
    for (const nodeId of element) {
        for (const ownerElementId of ownersByNode.get(nodeId) ?? []) {
            ids.add(ownerElementId);
        }
    }
    return [...ids];
}
function filterGrownLayerByTopology(mesh, candidateIds, sourceSet, sourceRange, boundarySides, index) {
    const faceNeighbors = topologyNeighborsByElementId(mesh);
    return candidateIds.filter((elementId) => {
        if (sourceSet.has(elementId)) {
            return true;
        }
        const offset = layerOffsetFromSourceRange(elementId, sourceRange, boundarySides, index);
        if (!offset) {
            return false;
        }
        const shellAxes = offset.filter((value) => value !== 0).length;
        if (shellAxes === 1) {
            return (faceNeighbors.get(elementId) ?? []).some((neighborId) => sourceSet.has(neighborId));
        }
        if (shellAxes === 2) {
            return elementSharesEdgeWithSource(mesh, elementId, sourceSet);
        }
        if (shellAxes === 3) {
            return elementSharesNodeWithSource(mesh, elementId, sourceSet);
        }
        return false;
    }).sort((a, b) => a - b);
}
function layerOffsetFromSourceRange(elementId, sourceRange, boundarySides, index) {
    const ranks = index.ranksByElementId.get(elementId);
    if (!ranks) {
        return null;
    }
    const offset = [0, 0, 0];
    for (let axis = 0; axis < 3; axis += 1) {
        if (ranks[axis] < sourceRange.min[axis]) {
            if (ranks[axis] !== sourceRange.min[axis] - 1 || boundarySides.lower[axis]) {
                return null;
            }
            offset[axis] = -1;
        }
        else if (ranks[axis] > sourceRange.max[axis]) {
            if (ranks[axis] !== sourceRange.max[axis] + 1 || boundarySides.upper[axis]) {
                return null;
            }
            offset[axis] = 1;
        }
    }
    return offset;
}
function elementSharesEdgeWithSource(mesh, elementId, sourceSet) {
    const element = mesh.elements[elementId - 1];
    if (!element) {
        return false;
    }
    const ownersByKey = edgeOwnersByNodeKey(mesh);
    return H1_EDGE_NODE_PAIRS.some(([a, b]) => {
        const key = edgeKey(element[a], element[b]);
        return (ownersByKey.get(key) ?? []).some((owner) => sourceSet.has(owner.elementId));
    });
}
function elementSharesNodeWithSource(mesh, elementId, sourceSet) {
    const element = mesh.elements[elementId - 1];
    if (!element) {
        return false;
    }
    const ownersByNode = nodeOwnersByNodeId(mesh);
    return element.some((nodeId) => (ownersByNode.get(nodeId) ?? []).some((ownerElementId) => sourceSet.has(ownerElementId)));
}
function regularizeCandidateIdsToLargestBlock(mesh, candidateElementIds, sourceElementIds, domainElementIds = candidateElementIds, tolerance) {
    const index = centerRankIndexForElementIds(mesh, domainElementIds);
    const candidateIds = candidateElementIds.filter((elementId) => index.ranksByElementId.has(elementId));
    const sourceSet = new Set(sourceElementIds);
    if (candidateIds.length === 0) {
        return {
            originalElementIds: [],
            selectedElementIds: [],
            addedElementIds: [],
            removedElementIds: [],
            gridDimensions: [0, 0, 0],
            warnings: ["expanded candidate selection is empty"]
        };
    }
    const sourceIds = sourceElementIds.filter((elementId) => index.ranksByElementId.has(elementId));
    if (sourceIds.length === 0) {
        return {
            originalElementIds: candidateIds,
            selectedElementIds: [],
            addedElementIds: [],
            removedElementIds: candidateIds,
            gridDimensions: index.coordinates.map((values) => values.length),
            rankIndex: index,
            warnings: ["user selection has no element inside the inferred uvw candidate lattice"]
        };
    }
    let coreRange = boundingRankRange(sourceIds, index);
    let coreCheck = exactElementIdsInIndexRange(coreRange, index);
    let missingCoreIds = coreCheck.ids.filter((elementId) => !sourceSet.has(elementId));
    const warnings = [];
    if (coreCheck.missingCount > 0 || missingCoreIds.length > 0) {
        const cropped = cropRangeToCompleteSelectedBlock(coreRange, sourceSet, index);
        if (!cropped) {
            return {
                originalElementIds: candidateIds,
                selectedElementIds: [],
                addedElementIds: [],
                removedElementIds: candidateIds,
                gridDimensions: index.coordinates.map((values) => values.length),
                rankIndex: index,
                indexRange: makeIndexRange(coreRange.min, coreRange.max),
                warnings: [
                    "user selection is not a complete uvw Hex block",
                    ...(coreCheck.missingCount > 0 ? [`missing ${coreCheck.missingCount} core rank positions`] : []),
                    ...(missingCoreIds.length > 0 ? [`${missingCoreIds.length} core block elements were not selected`] : [])
                ]
            };
        }
        warnings.push("cropped the user selection to a complete uvw core block");
        coreRange = cropped.range;
        coreCheck = cropped.check;
        missingCoreIds = [];
    }
    const boundarySides = rangeBoundarySides(mesh, coreRange, index.coordinates.map((values) => values.length), index);
    const outerRange = expandCoreRangeByRequiredLayer(coreRange, boundarySides);
    const outerCheck = exactElementIdsInIndexRange(outerRange, index);
    if (outerCheck.missingCount > 0) {
        return {
            originalElementIds: candidateIds,
            selectedElementIds: [],
            addedElementIds: [],
            removedElementIds: candidateIds,
            gridDimensions: index.coordinates.map((values) => values.length),
            rankIndex: index,
            indexRange: makeIndexRange(outerRange.min, outerRange.max),
            warnings: [
                "expanded selection does not contain the required one-layer transition shell",
                `missing ${outerCheck.missingCount} uvw rank positions`
            ]
        };
    }
    return buildRegularizationFromBestBlock(candidateIds, sourceSet, index, {
        volume: outerCheck.ids.length,
        sourceOverlap: sourceIds.length,
        range: outerRange,
        ids: outerCheck.ids
    }, warnings);
}
function expandCoreRangeByRequiredLayer(range, boundarySides) {
    const expanded = {
        min: [...range.min],
        max: [...range.max]
    };
    for (let axis = 0; axis < 3; axis += 1) {
        if (!boundarySides.lower[axis]) {
            expanded.min[axis] -= 1;
        }
        if (!boundarySides.upper[axis]) {
            expanded.max[axis] += 1;
        }
    }
    return expanded;
}
function exactElementIdsInIndexRange(range, index) {
    const ids = [];
    let missingCount = 0;
    for (let i = range.min[0]; i <= range.max[0]; i += 1) {
        for (let j = range.min[1]; j <= range.max[1]; j += 1) {
            for (let k = range.min[2]; k <= range.max[2]; k += 1) {
                const elementId = index.elementIdByRank.get(`${i}:${j}:${k}`);
                if (elementId === undefined) {
                    missingCount += 1;
                }
                else {
                    ids.push(elementId);
                }
            }
        }
    }
    return { ids: ids.sort((a, b) => a - b), missingCount };
}
function cropRangeToCompleteSelectedBlock(range, sourceSet, index) {
    let current = { min: [...range.min], max: [...range.max] };
    let guard = rangeDimension(current, 0) + rangeDimension(current, 1) + rangeDimension(current, 2) + 3;
    while (guard > 0 && rangeVolume(current) > 0) {
        const currentCheck = selectedRangeCompleteness(current, sourceSet, index);
        if (currentCheck.complete) {
            return { range: current, check: currentCheck.check };
        }
        const next = shrinkLocalRangeCandidates(current)
            .map((candidate) => ({
            range: candidate,
            volume: rangeVolume(candidate),
            completeness: selectedRangeCompleteness(candidate, sourceSet, index)
        }))
            .filter((candidate) => candidate.volume > 0)
            .sort((a, b) => a.completeness.missingTotal - b.completeness.missingTotal ||
            b.completeness.selectedCount - a.completeness.selectedCount ||
            b.volume - a.volume)[0]?.range;
        if (!next) {
            return null;
        }
        current = next;
        guard -= 1;
    }
    return null;
}
function selectedRangeCompleteness(range, sourceSet, index) {
    const check = exactElementIdsInIndexRange(range, index);
    const missingSelected = check.ids.filter((elementId) => !sourceSet.has(elementId)).length;
    const selectedCount = check.ids.length - missingSelected;
    const missingTotal = check.missingCount + missingSelected;
    return {
        check,
        selectedCount,
        missingTotal,
        complete: missingTotal === 0 && check.ids.length > 0
    };
}
function buildRegularizationFromBestBlock(candidateIds, sourceSet, index, best, warnings) {
    const selectedSet = new Set(best.ids);
    return {
        originalElementIds: [...candidateIds],
        selectedElementIds: [...best.ids],
        addedElementIds: best.ids.filter((elementId) => !sourceSet.has(elementId)),
        removedElementIds: candidateIds.filter((elementId) => !selectedSet.has(elementId)),
        gridDimensions: index.coordinates.map((values) => values.length),
        rankIndex: index,
        indexRange: makeIndexRange(best.range.min, best.range.max),
        warnings: [...warnings]
    };
}
function shrinkLocalRangeCandidates(range) {
    const candidates = [];
    for (let axis = 0; axis < 3; axis += 1) {
        if (range.min[axis] < range.max[axis]) {
            const lower = { min: [...range.min], max: [...range.max] };
            lower.min[axis] += 1;
            candidates.push(lower);
            const upper = { min: [...range.min], max: [...range.max] };
            upper.max[axis] -= 1;
            candidates.push(upper);
        }
    }
    return candidates;
}
function boundingRankRange(elementIds, index) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const elementId of elementIds) {
        const ranks = index.ranksByElementId.get(elementId);
        if (!ranks) {
            continue;
        }
        for (let axis = 0; axis < 3; axis += 1) {
            min[axis] = Math.min(min[axis], ranks[axis]);
            max[axis] = Math.max(max[axis], ranks[axis]);
        }
    }
    return { min, max };
}
function validateRegularizedBlock(mesh, regularization) {
    if (!regularization.indexRange || !regularization.gridDimensions) {
        return { ok: false, warning: "Regularization did not return a uvw index range." };
    }
    const expected = regularization.indexRange.dimensions.reduce((total, value) => total * value, 1);
    if (regularization.selectedElementIds.length !== expected) {
        return { ok: false, warning: "Regularized selection is not a complete Hex array block." };
    }
    const index = regularization.rankIndex ?? centerRankIndexForElementIds(mesh, mesh.elements.map((_, elementIndex) => elementIndex + 1));
    const ids = elementIdsInGlobalIndexRange(regularization.indexRange, regularization.gridDimensions, index);
    if (ids.length !== regularization.selectedElementIds.length) {
        return { ok: false, warning: "Regularized block could not be mapped to a complete uvw Hex array." };
    }
    const expectedSet = new Set(regularization.selectedElementIds);
    if (!ids.every((elementId) => expectedSet.has(elementId))) {
        return { ok: false, warning: "Regularized block ids do not match the inferred uvw Hex array." };
    }
    return { ok: true };
}
function rangeDimension(range, axis) {
    return range.max[axis] - range.min[axis] + 1;
}
function rangeBoundarySides(mesh, range, gridDimensions, index) {
    const neighbors = topologyNeighborsByElementId(mesh);
    const ids = elementIdsInGlobalIndexRange(makeIndexRange(range.min, range.max), gridDimensions, index);
    const sides = {
        lower: [false, false, false],
        upper: [false, false, false]
    };
    for (let axis = 0; axis < 3; axis += 1) {
        const lowerIds = ids.filter((elementId) => index.ranksByElementId.get(elementId)?.[axis] === range.min[axis]);
        const upperIds = ids.filter((elementId) => index.ranksByElementId.get(elementId)?.[axis] === range.max[axis]);
        sides.lower[axis] = lowerIds.length > 0 && lowerIds.every((elementId) => !hasNeighborAcrossRankSide(mesh, elementId, axis, -1, index, neighbors));
        sides.upper[axis] = upperIds.length > 0 && upperIds.every((elementId) => !hasNeighborAcrossRankSide(mesh, elementId, axis, 1, index, neighbors));
    }
    return sides;
}
function topologyNeighborsByElementId(mesh) {
    const cached = topologyNeighborsCache.get(mesh);
    if (cached) {
        return cached;
    }
    const ownerMap = new Map();
    for (let elementIndex = 0; elementIndex < mesh.elements.length; elementIndex += 1) {
        const element = mesh.elements[elementIndex] ?? [];
        for (const face of H1_FACE_NODE_INDICES) {
            const key = [...face.map((localIndex) => element[localIndex])].sort((a, b) => a - b).join(":");
            const owners = ownerMap.get(key) ?? [];
            owners.push(elementIndex + 1);
            ownerMap.set(key, owners);
        }
    }
    const neighbors = new Map();
    for (const owners of ownerMap.values()) {
        if (owners.length !== 2) {
            continue;
        }
        addTopologyNeighborId(neighbors, owners[0], owners[1]);
        addTopologyNeighborId(neighbors, owners[1], owners[0]);
    }
    topologyNeighborsCache.set(mesh, neighbors);
    return neighbors;
}
function connectedElementComponents(mesh, elementIds) {
    const selected = new Set(uniqueSorted(elementIds));
    const neighbors = topologyNeighborsByElementId(mesh);
    const components = [];
    while (selected.size > 0) {
        const seed = selected.values().next().value;
        if (seed === undefined) {
            break;
        }
        const component = [];
        const stack = [seed];
        selected.delete(seed);
        while (stack.length > 0) {
            const elementId = stack.pop();
            component.push(elementId);
            for (const neighborElementId of neighbors.get(elementId) ?? []) {
                if (!selected.delete(neighborElementId)) {
                    continue;
                }
                stack.push(neighborElementId);
            }
        }
        components.push(component.sort((a, b) => a - b));
    }
    return components.sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
}
function edgeOwnersByNodeKey(mesh) {
    const cached = edgeOwnersCache.get(mesh);
    if (cached) {
        return cached;
    }
    const owners = new Map();
    mesh.elements.forEach((element, elementIndex) => {
        for (const [a, b] of H1_EDGE_NODE_PAIRS) {
            const key = edgeKey(element[a], element[b]);
            const list = owners.get(key) ?? [];
            list.push({ elementId: elementIndex + 1 });
            owners.set(key, list);
        }
    });
    edgeOwnersCache.set(mesh, owners);
    return owners;
}
function nodeOwnersByNodeId(mesh) {
    const cached = nodeOwnersCache.get(mesh);
    if (cached) {
        return cached;
    }
    const owners = new Map();
    mesh.elements.forEach((element, elementIndex) => {
        for (const nodeId of element) {
            const list = owners.get(nodeId) ?? [];
            list.push(elementIndex + 1);
            owners.set(nodeId, list);
        }
    });
    nodeOwnersCache.set(mesh, owners);
    return owners;
}
function addTopologyNeighborId(neighbors, elementId, neighborElementId) {
    const list = neighbors.get(elementId) ?? [];
    list.push(neighborElementId);
    neighbors.set(elementId, list);
}
function hasNeighborAcrossRankSide(mesh, elementId, axis, direction, index, neighbors) {
    const ranks = index.ranksByElementId.get(elementId);
    if (!ranks) {
        return false;
    }
    const center = elementCenterById(mesh, elementId);
    return (neighbors.get(elementId) ?? []).some((neighborElementId) => {
        const neighborRanks = index.ranksByElementId.get(neighborElementId);
        if (neighborRanks) {
            const movesInAxis = direction < 0 ? neighborRanks[axis] < ranks[axis] : neighborRanks[axis] > ranks[axis];
            return movesInAxis && [0, 1, 2].every((otherAxis) => otherAxis === axis || neighborRanks[otherAxis] === ranks[otherAxis]);
        }
        const neighborCenter = elementCenterById(mesh, neighborElementId);
        const delta = [
            neighborCenter[0] - center[0],
            neighborCenter[1] - center[1],
            neighborCenter[2] - center[2]
        ];
        const signed = delta[axis] * direction;
        return signed > index.tolerance && Math.abs(delta[axis]) >= Math.max(Math.abs(delta[(axis + 1) % 3]), Math.abs(delta[(axis + 2) % 3]));
    });
}
function elementIdsInGlobalIndexRange(range, gridDimensions, index) {
    const ids = [];
    const max = [
        Math.min(range.max[0], gridDimensions[0] - 1),
        Math.min(range.max[1], gridDimensions[1] - 1),
        Math.min(range.max[2], gridDimensions[2] - 1)
    ];
    const min = [
        Math.max(range.min[0], 0),
        Math.max(range.min[1], 0),
        Math.max(range.min[2], 0)
    ];
    for (let i = min[0]; i <= max[0]; i += 1) {
        for (let j = min[1]; j <= max[1]; j += 1) {
            for (let k = min[2]; k <= max[2]; k += 1) {
                const elementId = index.elementIdByRank.get(`${i}:${j}:${k}`);
                if (elementId !== undefined) {
                    ids.push(elementId);
                }
            }
        }
    }
    return ids.sort((a, b) => a - b);
}
function boundedTransitionCoreElementIds(mesh, regularization) {
    const ids = regularization.selectedElementIds;
    if (!regularization.indexRange || !regularization.gridDimensions || ids.length === 0) {
        return { elementIds: ids };
    }
    const index = regularization.rankIndex ?? centerRankIndexForElementIds(mesh, mesh.elements.map((_, elementIndex) => elementIndex + 1));
    const range = regularization.indexRange;
    const boundarySides = rangeBoundarySides(mesh, range, regularization.gridDimensions, index);
    const core = ids
        .map((elementId) => ({ elementId, ranks: index.ranksByElementId.get(elementId) }))
        .filter((item) => item.ranks && item.ranks.every((rank, axis) => {
        const needsLowerTransition = !boundarySides.lower[axis];
        const needsUpperTransition = !boundarySides.upper[axis];
        return (!needsLowerTransition || rank > range.min[axis]) &&
            (!needsUpperTransition || rank < range.max[axis]);
    }))
        .map((item) => item.elementId)
        .sort((a, b) => a - b);
    return { elementIds: core };
}
function centerRankIndexForElementIds(mesh, elementIds) {
    const tolerance = Math.max(minElementSize(mesh, elementIds) * 1e-6, 1e-9);
    const centers = elementIds
        .map((elementId) => ({
        elementId,
        center: elementCenterById(mesh, elementId)
    }))
        .filter((item) => item.center.every(Number.isFinite));
    const coordinates = [0, 1, 2].map((axis) => uniqueSortedCoordinates(centers.map((item) => item.center[axis]), tolerance));
    const elementIdByRank = new Map();
    const ranksByElementId = new Map();
    for (const item of centers) {
        const ranks = [0, 1, 2].map((axis) => coordinateRank(coordinates[axis], item.center[axis], tolerance));
        elementIdByRank.set(`${ranks[0]}:${ranks[1]}:${ranks[2]}`, item.elementId);
        ranksByElementId.set(item.elementId, ranks);
    }
    return { coordinates, elementIdByRank, ranksByElementId, tolerance };
}
function countTransitionEscapes(plan, outerElementIds) {
    if (!outerElementIds) {
        return 0;
    }
    const outer = new Set(outerElementIds);
    return plan.filter((item) => item.role !== "unchanged" && !outer.has(item.parentElementId)).length;
}
function elementCenterById(mesh, elementId) {
    let centers = elementCenterCache.get(mesh);
    if (!centers) {
        centers = new Map();
        elementCenterCache.set(mesh, centers);
    }
    const cached = centers.get(elementId);
    if (cached) {
        return cached;
    }
    const element = mesh.elements[elementId - 1];
    if (!element) {
        return [0, 0, 0];
    }
    const center = computeElementCenter3(mesh, element);
    centers.set(elementId, center);
    return center;
}
function computeElementCenter3(mesh, element) {
    const total = [0, 0, 0];
    for (const nodeId of element) {
        const point = toPoint3(mesh.nodes[nodeId - 1]);
        total[0] += point[0];
        total[1] += point[1];
        total[2] += point[2];
    }
    return [total[0] / element.length, total[1] / element.length, total[2] / element.length];
}
function minElementSize(mesh, elementIds) {
    let size = Infinity;
    for (const elementId of elementIds) {
        const element = mesh.elements[elementId - 1];
        if (!element) {
            continue;
        }
        const points = element.map((nodeId) => toPoint3(mesh.nodes[nodeId - 1]));
        for (let i = 0; i < points.length; i += 1) {
            for (let j = i + 1; j < points.length; j += 1) {
                const distance = Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1], points[i][2] - points[j][2]);
                if (distance > 1e-12) {
                    size = Math.min(size, distance);
                }
            }
        }
    }
    return Number.isFinite(size) ? size : 1;
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
function coordinateRank(values, value, tolerance) {
    let best = 0;
    let bestDistance = Infinity;
    values.forEach((candidate, index) => {
        const distance = Math.abs(candidate - value);
        if (distance < bestDistance) {
            best = index;
            bestDistance = distance;
        }
    });
    return bestDistance <= tolerance ? best : best;
}
function rangeVolume(range) {
    return Math.max(0, rangeDimension(range, 0)) *
        Math.max(0, rangeDimension(range, 1)) *
        Math.max(0, rangeDimension(range, 2));
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
function uniqueSorted(values) {
    return [...new Set(values)].sort((a, b) => a - b);
}
function uniqueSortedStrings(values) {
    return [...new Set(values)].sort();
}
function edgeKey(a, b) {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
}
function toPoint3(point) {
    return [
        point?.[0] ?? 0,
        point?.[1] ?? 0,
        point?.[2] ?? 0
    ];
}
const H1_FACE_NODE_INDICES = [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7]
];
const H1_EDGE_NODE_PAIRS = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7]
];
