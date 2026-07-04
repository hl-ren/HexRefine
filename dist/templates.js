import { mergeCoincidentNodes } from "./mesh.js";
import { add, lerp, mix, scale, sub } from "./vector.js";
export function refineQ1To3x3(vertices) {
    const [x1, x2, x3, x4] = quad(vertices);
    const x5 = lerp(x1, x2, 1 / 3);
    const x6 = lerp(x1, x2, 2 / 3);
    const x7 = lerp(x1, x4, 1 / 3);
    const x11 = lerp(x1, x4, 2 / 3);
    const x10 = lerp(x2, x3, 1 / 3);
    const x14 = lerp(x2, x3, 2 / 3);
    const x15 = lerp(x4, x3, 1 / 3);
    const x16 = lerp(x4, x3, 2 / 3);
    const x8 = lerp(x7, x10, 1 / 3);
    const x9 = lerp(x7, x10, 2 / 3);
    const x12 = lerp(x11, x14, 1 / 3);
    const x13 = lerp(x11, x14, 2 / 3);
    return {
        kind: "Q1",
        source: "RefineQ1To3x3Q1",
        nodes: [x1, x2, x3, x4, x5, x6, x7, x8, x9, x10, x11, x12, x13, x14, x15, x16],
        elements: [
            [1, 5, 8, 7],
            [5, 6, 9, 8],
            [6, 2, 10, 9],
            [7, 8, 12, 11],
            [8, 9, 13, 12],
            [9, 10, 14, 13],
            [4, 11, 12, 15],
            [12, 13, 16, 15],
            [3, 16, 13, 14]
        ]
    };
}
export function refineQ1To4Q1(vertices) {
    const [x1, x2, x3, x4] = quad(vertices);
    const x5 = lerp(x1, x2, 1 / 3);
    const x6 = lerp(x1, x2, 2 / 3);
    const x14 = mix([x1, x4], [0.5, 0.5]);
    const x23 = mix([x2, x3], [0.5, 0.5]);
    const x7 = lerp(x14, x23, 1 / 3);
    const x8 = lerp(x14, x23, 2 / 3);
    return {
        kind: "Q1",
        source: "RefineQ1ToFourQ1",
        nodes: [x1, x2, x3, x4, x5, x6, x7, x8],
        elements: [
            [1, 5, 7, 4],
            [5, 6, 8, 7],
            [2, 3, 8, 6],
            [3, 4, 7, 8]
        ]
    };
}
export function refineQ1To5Q1(vertices) {
    const [x1, x2, x3, x4] = quad(vertices);
    const x5 = lerp(x1, x2, 1 / 3);
    const x6 = lerp(x1, x2, 2 / 3);
    const x7 = lerp(x2, x3, 1 / 3);
    const x8 = lerp(x2, x3, 2 / 3);
    const x9 = lerp(x2, x4, 1 / 3);
    const x10 = lerp(x2, x4, 2 / 3);
    return {
        kind: "Q1",
        source: "RefineQ1To5Q1",
        nodes: [x1, x2, x3, x4, x5, x6, x7, x8, x9, x10],
        elements: [
            [1, 5, 10, 4],
            [5, 6, 9, 10],
            [6, 2, 7, 9],
            [7, 8, 10, 9],
            [3, 4, 10, 8]
        ]
    };
}
export function refineHexTo27Hex(vertices) {
    return subdivideHex(vertices, 3, "RefineH1To27H1");
}
export function refineHexTo5Hex(vertices) {
    const [x1, x2, x3, x4, x5, x6, x7, x8] = hex(vertices);
    const y12 = sub(x2, x1);
    const y14 = sub(x4, x1);
    const y56 = sub(x6, x5);
    const y58 = sub(x8, x5);
    const y23 = sub(x3, x2);
    const y67 = sub(x7, x6);
    const x9 = lerp(x1, x5, 1 / 3);
    const x10 = lerp(x1, x5, 2 / 3);
    const x11 = add(x10, scale(y56, 0.5));
    const x12 = add(x9, scale(y12, 0.5));
    const x13 = add(x9, scale(y14, 0.5));
    const x14 = add(x10, scale(y58, 0.5));
    const x15 = add(x11, scale(y67, 0.5));
    const x16 = add(x12, scale(y23, 0.5));
    return {
        kind: "H1",
        source: "RefineH1To5H1",
        nodes: [x1, x2, x3, x4, x5, x6, x7, x8, x9, x10, x11, x12, x13, x14, x15, x16],
        elements: [
            [1, 2, 3, 4, 9, 12, 16, 13],
            [11, 12, 16, 15, 6, 2, 3, 7],
            [10, 11, 15, 14, 5, 6, 7, 8],
            [13, 14, 15, 16, 4, 8, 7, 3],
            [9, 10, 11, 12, 13, 14, 15, 16]
        ]
    };
}
export function refineHexTo4Hex(vertices) {
    const [x1, x2, x3, x4, x5, x6, x7, x8] = hex(vertices);
    const y15 = sub(x5, x1);
    const y48 = sub(x8, x4);
    const y26 = sub(x6, x2);
    const y37 = sub(x7, x3);
    const x9 = lerp(x1, x4, 1 / 3);
    const x10 = lerp(x2, x3, 1 / 3);
    const x11 = lerp(x2, x3, 2 / 3);
    const x12 = lerp(x1, x4, 2 / 3);
    const x13 = add(x9, scale(y15, 0.5));
    const x16 = add(x12, scale(y48, 0.5));
    const x14 = add(x10, scale(y26, 0.5));
    const x15 = add(x11, scale(y37, 0.5));
    return {
        kind: "H1",
        source: "RefineH1To4H1",
        nodes: [x1, x2, x3, x4, x5, x6, x7, x8, x9, x10, x11, x12, x13, x14, x15, x16],
        elements: [
            [2, 10, 9, 1, 6, 14, 13, 5],
            [10, 11, 12, 9, 14, 15, 16, 13],
            [11, 3, 4, 12, 15, 7, 8, 16],
            [13, 14, 15, 16, 5, 6, 7, 8]
        ]
    };
}
export function refineHexTo13Hex(vertices, mergeTolerance) {
    const first = refineHexTo4Hex(vertices);
    const nodes = [...first.nodes];
    const elements = [first.elements[3]];
    for (const element of first.elements.slice(0, 3)) {
        const subVertices = element.map((nodeId) => first.nodes[nodeId - 1]);
        const refined = refineHexTo4Hex(subVertices);
        const offset = nodes.length;
        nodes.push(...refined.nodes);
        elements.push(...refined.elements.map((subElement) => subElement.map((nodeId) => nodeId + offset)));
    }
    const tolerance = mergeTolerance ?? estimateHexTolerance(vertices);
    const merged = mergeCoincidentNodes({ nodes, elements, kind: "H1" }, tolerance);
    return {
        kind: "H1",
        source: "RefineH1To13H1",
        nodes: merged.nodes,
        elements: merged.elements
    };
}
export function subdivideHex(vertices, divisions, source = `Hex${divisions}x${divisions}x${divisions}`) {
    const corners = hex(vertices);
    if (!Number.isInteger(divisions) || divisions < 1) {
        throw new Error("hex divisions must be a positive integer");
    }
    const index = (i, j, k) => i * (divisions + 1) * (divisions + 1) + j * (divisions + 1) + k + 1;
    const nodes = [];
    for (let i = 0; i <= divisions; i += 1) {
        for (let j = 0; j <= divisions; j += 1) {
            for (let k = 0; k <= divisions; k += 1) {
                const u = i / divisions;
                const v = j / divisions;
                const w = k / divisions;
                nodes.push(trilinear(corners, u, v, w));
            }
        }
    }
    const elements = [];
    for (let i = 0; i < divisions; i += 1) {
        for (let j = 0; j < divisions; j += 1) {
            for (let k = 0; k < divisions; k += 1) {
                elements.push([
                    index(i, j, k),
                    index(i + 1, j, k),
                    index(i + 1, j + 1, k),
                    index(i, j + 1, k),
                    index(i, j, k + 1),
                    index(i + 1, j, k + 1),
                    index(i + 1, j + 1, k + 1),
                    index(i, j + 1, k + 1)
                ]);
            }
        }
    }
    return { kind: "H1", source, nodes, elements };
}
function trilinear(corners, u, v, w) {
    const weights = [
        (1 - u) * (1 - v) * (1 - w),
        u * (1 - v) * (1 - w),
        u * v * (1 - w),
        (1 - u) * v * (1 - w),
        (1 - u) * (1 - v) * w,
        u * (1 - v) * w,
        u * v * w,
        (1 - u) * v * w
    ];
    return mix(corners, weights);
}
function estimateHexTolerance(vertices) {
    const [x1, x2, x3, x4, x5, x6, x7, x8] = hex(vertices);
    const edges = [
        [x1, x2],
        [x2, x3],
        [x3, x4],
        [x4, x1],
        [x5, x6],
        [x6, x7],
        [x7, x8],
        [x8, x5],
        [x1, x5],
        [x2, x6],
        [x3, x7],
        [x4, x8]
    ];
    const minEdge = Math.min(...edges.map(([a, b]) => distanceBetween(a, b)));
    return minEdge * 0.0001;
}
function distanceBetween(a, b) {
    const delta = lerp(a, b, 1).map((value, index) => value - a[index]);
    return Math.sqrt(delta.reduce((total, value) => total + value * value, 0));
}
function hex(vertices) {
    if (vertices.length !== 8) {
        throw new Error(`H1/Hex refinement requires 8 vertices, got ${vertices.length}`);
    }
    return [
        vertices[0],
        vertices[1],
        vertices[2],
        vertices[3],
        vertices[4],
        vertices[5],
        vertices[6],
        vertices[7]
    ];
}
function quad(vertices) {
    if (vertices.length !== 4) {
        throw new Error(`Q1 refinement requires 4 vertices, got ${vertices.length}`);
    }
    return [vertices[0], vertices[1], vertices[2], vertices[3]];
}
