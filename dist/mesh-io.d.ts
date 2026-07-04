import type { Mesh } from "./types.js";
export declare function parseMeshJSON(text: string): Mesh;
export declare function parseMeshText(text: string, fileName?: string): Mesh;
export declare function parseLegacyVtkMesh(text: string): Mesh;
export declare function parseVtuMesh(text: string): Mesh;
export declare function parseAbaqusInpMesh(text: string): Mesh;
export declare function parseLsdynaKeywordMesh(text: string): Mesh;
export declare function meshFromSerializable(value: unknown): Mesh;
