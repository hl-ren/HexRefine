import type { Mesh } from "./types.js";
export interface Q1BoundaryLayerGrowOptions {
    height: number;
    increments: number;
    growthRatio?: number;
    nodeArrangement?: number;
    scaleMode?: "none" | "fit-bounds" | "preserve-area";
}
export interface Q1BoundaryLayerGrowResult {
    mesh: Mesh;
    boundaryEdgeCount: number;
    generatedElementIds: number[];
    layerElementIds: number[][];
    scaleMode: "none" | "fit-bounds" | "preserve-area";
    originalArea: number;
    finalArea: number;
}
export interface Q1RectangleCircleTemplateOptions {
    innerSquareRatio?: number;
    innerCircleRadius?: number;
    innerCircleRatio?: number;
    outerCircleRadius?: number;
    outerCircleRatio?: number;
    squareToCircleLayers?: number;
    annulusLayers?: number;
    circleToSquareLayers?: number;
    omitCore?: boolean;
    irregularBoundaryBias?: number;
    mergeTolerance?: number;
}
export interface Q1TemplateReplacementResult {
    mesh: Mesh;
    replacedElementIds: number[];
    generatedElementIds: number[];
    regionElementIds: {
        core: number[];
        squareToCircle: number[];
        annulus: number[];
        circleToSquare: number[];
    };
    blockDimensions: [number, number];
}
export declare function growQ1BoundaryLayer(mesh: Mesh, selectedElementIds: readonly number[], options: Q1BoundaryLayerGrowOptions): Q1BoundaryLayerGrowResult;
export declare function replaceQ1BlockWithRectangleCircleTemplate(mesh: Mesh, selectedElementIds: readonly number[], options?: Q1RectangleCircleTemplateOptions): Q1TemplateReplacementResult;
