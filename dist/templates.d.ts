import type { LocalRefinement, Point } from "./types.js";
export declare function refineQ1To3x3(vertices: readonly Point[]): LocalRefinement;
export declare function refineQ1To4Q1(vertices: readonly Point[]): LocalRefinement;
export declare function refineQ1To5Q1(vertices: readonly Point[]): LocalRefinement;
export declare function refineHexTo27Hex(vertices: readonly Point[]): LocalRefinement;
export declare function refineHexTo5Hex(vertices: readonly Point[]): LocalRefinement;
export declare function refineHexTo4Hex(vertices: readonly Point[]): LocalRefinement;
export declare function refineHexTo13Hex(vertices: readonly Point[], mergeTolerance?: number): LocalRefinement;
export declare function subdivideHex(vertices: readonly Point[], divisions: number, source?: string): LocalRefinement;
