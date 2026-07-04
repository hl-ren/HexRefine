import { isRefinableSessionCell, validateRefinementSessionSelection } from "./refinement-session.js";
import { regularizeHexSelection } from "./regularization.js";
export function regularizeHexSessionSelection(session, candidateCellIds, options = {}) {
    if (session.kind !== "H1") {
        throw new Error("regularizeHexSessionSelection requires an H1/Hex refinement session");
    }
    const uniqueCandidateCellIds = [...new Set(candidateCellIds)];
    const seedCellIdsByLevel = new Map();
    const ignoredCellIds = [];
    for (const cellId of uniqueCandidateCellIds) {
        const cell = session.cells.get(cellId);
        if (!cell || cell.kind !== "H1" || !isRefinableSessionCell(cell)) {
            ignoredCellIds.push(cellId);
            continue;
        }
        const ids = seedCellIdsByLevel.get(cell.level) ?? [];
        ids.push(cellId);
        seedCellIdsByLevel.set(cell.level, ids);
    }
    const level = chooseRefinementLevel(seedCellIdsByLevel);
    const seedCellIds = level === undefined ? [] : seedCellIdsByLevel.get(level) ?? [];
    for (const [candidateLevel, ids] of seedCellIdsByLevel) {
        if (candidateLevel !== level) {
            ignoredCellIds.push(...ids);
        }
    }
    if (seedCellIds.length === 0 || level === undefined) {
        const validation = validateRefinementSessionSelection(session, []);
        const warnings = [
            ...validation.errors,
            ...(ignoredCellIds.length > 0
                ? [`ignored cells outside active same-level refinable domain: ${ignoredCellIds.join(", ")}`]
                : [])
        ];
        return {
            ok: false,
            level,
            sourceCellIds: [],
            expandedCellIds: [],
            originalCellIds: [],
            selectedCellIds: [],
            addedCellIds: [],
            removedCellIds: [],
            ignoredCellIds,
            regularization: emptyRegularizedHexSelection(warnings),
            validation,
            warnings
        };
    }
    const domain = options.domain?.level === level
        ? options.domain
        : buildHexSessionRegularizationDomain(session, level);
    const candidateElementIds = seedCellIds
        .map((cellId) => domain.elementIdByCellId.get(cellId))
        .filter((elementId) => elementId !== undefined);
    const grownCandidateElementIds = expandHexElementIdsByTopologyLayers(domain.mesh, candidateElementIds, options.growTopologyLayers ?? 0);
    const regularizationOptions = {
        ...(options.tolerance === undefined ? {} : { tolerance: options.tolerance }),
        ...(options.boundaryShellOnly === undefined ? {} : { boundaryShellOnly: options.boundaryShellOnly })
    };
    const regularization = regularizeHexSelection(domain.mesh, grownCandidateElementIds, regularizationOptions);
    const cellIdsFromElementIds = (elementIds) => elementIds
        .map((elementId) => domain.cellIdByElementId.get(elementId))
        .filter((cellId) => cellId !== undefined);
    const sourceCellIds = cellIdsFromElementIds(candidateElementIds);
    const expandedCellIds = cellIdsFromElementIds(grownCandidateElementIds);
    const originalCellIds = cellIdsFromElementIds(regularization.originalElementIds);
    const selectedCellIds = cellIdsFromElementIds(regularization.selectedElementIds);
    const validation = validateRefinementSessionSelection(session, selectedCellIds);
    const warnings = [...regularization.warnings];
    if (seedCellIdsByLevel.size > 1) {
        warnings.push(`selection spans multiple refinement levels; using level ${level} and ignoring other levels`);
    }
    if (grownCandidateElementIds.length > candidateElementIds.length) {
        warnings.push(`grew selection by topology layer from ${candidateElementIds.length} to ${grownCandidateElementIds.length} cells`);
    }
    if (ignoredCellIds.length > 0) {
        warnings.push(`ignored cells outside active same-level refinable domain: ${ignoredCellIds.join(", ")}`);
    }
    if (!validation.ok) {
        warnings.push(...validation.errors);
    }
    return {
        ok: validation.ok && selectedCellIds.length > 0,
        level,
        sourceCellIds,
        expandedCellIds,
        originalCellIds,
        selectedCellIds,
        addedCellIds: cellIdsFromElementIds(regularization.addedElementIds),
        removedCellIds: cellIdsFromElementIds(regularization.removedElementIds),
        ignoredCellIds,
        regularization,
        validation,
        warnings
    };
}
function chooseRefinementLevel(seedCellIdsByLevel) {
    let bestLevel;
    let bestCount = -1;
    for (const [level, ids] of seedCellIdsByLevel) {
        if (ids.length > bestCount || (ids.length === bestCount && (bestLevel === undefined || level > bestLevel))) {
            bestLevel = level;
            bestCount = ids.length;
        }
    }
    return bestLevel;
}
function emptyRegularizedHexSelection(warnings) {
    return {
        originalElementIds: [],
        selectedElementIds: [],
        addedElementIds: [],
        removedElementIds: [],
        warnings
    };
}
function expandHexElementIdsByTopologyLayers(mesh, seedElementIds, layerCount) {
    const normalizedLayerCount = Math.max(0, Math.floor(layerCount));
    let expanded = new Set(seedElementIds);
    if (normalizedLayerCount === 0 || expanded.size === 0) {
        return uniqueSorted([...expanded]);
    }
    const ownersByNodeId = new Map();
    mesh.elements.forEach((element, index) => {
        const elementId = index + 1;
        for (const nodeId of element) {
            const owners = ownersByNodeId.get(nodeId) ?? [];
            owners.push(elementId);
            ownersByNodeId.set(nodeId, owners);
        }
    });
    for (let layer = 0; layer < normalizedLayerCount; layer += 1) {
        const next = new Set(expanded);
        for (const elementId of expanded) {
            const element = mesh.elements[elementId - 1];
            if (!element) {
                continue;
            }
            for (const nodeId of element) {
                for (const neighborElementId of ownersByNodeId.get(nodeId) ?? []) {
                    next.add(neighborElementId);
                }
            }
        }
        expanded = next;
    }
    return uniqueSorted([...expanded]);
}
export function buildHexSessionRegularizationDomain(session, level) {
    const domainCellIds = [...session.activeLeafIds]
        .filter((cellId) => {
        const cell = session.cells.get(cellId);
        return Boolean(cell && cell.kind === "H1" && cell.level === level && isRefinableSessionCell(cell));
    })
        .sort();
    return buildSessionCellSubmesh(session, level, domainCellIds);
}
function buildSessionCellSubmesh(session, level, cellIds) {
    const cells = cellIds
        .map((cellId) => session.cells.get(cellId))
        .filter((cell) => cell !== undefined);
    const usedNodeIds = new Set();
    for (const cell of cells) {
        for (const nodeId of cell.element) {
            usedNodeIds.add(nodeId);
        }
    }
    const oldToNewNodeId = new Map();
    const nodes = uniqueSorted([...usedNodeIds]).map((nodeId, index) => {
        oldToNewNodeId.set(nodeId, index + 1);
        return session.nodes[nodeId - 1];
    });
    const cellIdByElementId = new Map();
    const elementIdByCellId = new Map();
    const elements = cells.map((cell, index) => {
        const elementId = index + 1;
        cellIdByElementId.set(elementId, cell.id);
        elementIdByCellId.set(cell.id, elementId);
        return cell.element.map((nodeId) => {
            const mapped = oldToNewNodeId.get(nodeId);
            if (mapped === undefined) {
                throw new Error(`session cell ${cell.id} references missing node ${nodeId}`);
            }
            return mapped;
        });
    });
    return {
        level,
        cellIds: cells.map((cell) => cell.id),
        mesh: { kind: "H1", nodes, elements },
        cellIdByElementId,
        elementIdByCellId
    };
}
function uniqueSorted(values) {
    return [...new Set(values)].sort((a, b) => a - b);
}
