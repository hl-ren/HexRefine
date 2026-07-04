import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHexUnitCubeMesh, createQ1UnitSquareMesh } from "../grid.js";
import { elementCenter, selectElementsByPredicate } from "../mesh.js";
import { refineByBoxWithReport, refineByElementIdsWithReport } from "../refinement-ops.js";
import { meshToLegacyVtk } from "../export.js";
import { checkNoHangingNodes } from "../conformance.js";
const outputDir = fileURLToPath(new URL("../../examples/output/", import.meta.url));
async function main() {
    await mkdir(outputDir, { recursive: true });
    const case1 = runQ1CircleTwoStage();
    await writeVtk("case1_q1_20x20_two_circles.vtk", case1, "Q1 20x20 two-stage circular refinement");
    const case2 = runHexOneEighth();
    await writeVtk("case2_hex_10x10x10_one_eighth.vtk", case2, "Hex 10x10x10 one-eighth refinement");
    const case3 = runHexMiddleCube();
    await writeVtk("case3_hex_10x10x10_middle_cube.vtk", case3, "Hex 10x10x10 middle cube refinement");
}
function runQ1CircleTwoStage() {
    const center = [0.5, 0.5];
    const base = createQ1UnitSquareMesh(20, 20);
    const stage1Ids = selectElementsByPredicate(base, (elementCenterPoint) => distance(elementCenterPoint, center) <= 0.23);
    const stage1 = refineByElementIdsWithReport(base, stage1Ids);
    const stage2Ids = selectElementsByPredicate(stage1.mesh, (elementCenterPoint) => distance(elementCenterPoint, center) <= 0.105);
    return refineByElementIdsWithReport(stage1.mesh, stage2Ids);
}
function runHexOneEighth() {
    const base = createHexUnitCubeMesh(10, 10, 10);
    return refineByBoxWithReport(base, {
        min: [0, 0, 0],
        max: [0.5, 0.5, 0.5]
    });
}
function runHexMiddleCube() {
    const base = createHexUnitCubeMesh(10, 10, 10);
    return refineByBoxWithReport(base, {
        min: [0.3, 0.3, 0.3],
        max: [0.7, 0.7, 0.7]
    });
}
async function writeVtk(fileName, result, title) {
    const { mesh } = result;
    const report = checkNoHangingNodes(mesh, 1e-8);
    const elementIds = mesh.elements.map((_, index) => index + 1);
    const centerX = mesh.elements.map((element) => elementCenter(mesh, element)[0] ?? 0);
    const centerY = mesh.elements.map((element) => elementCenter(mesh, element)[1] ?? 0);
    const centerZ = mesh.elements.map((element) => elementCenter(mesh, element)[2] ?? 0);
    const text = meshToLegacyVtk(mesh, {
        title,
        cellScalars: {
            element_id: elementIds,
            center_x: centerX,
            center_y: centerY,
            center_z: centerZ,
            parent_element_id: result.cellData.map((cell) => cell.parentElementId),
            template_code: result.cellData.map((cell) => cell.templateCode),
            transition_role: result.cellData.map((cell) => roleCode(cell.role))
        }
    });
    const filePath = path.join(outputDir, fileName);
    await writeFile(filePath, text, "utf8");
    console.log(`${filePath}: ${mesh.nodes.length} nodes, ${mesh.elements.length} elements, hanging=${report.hanging.length}, templates=${JSON.stringify(result.summary)}`);
    if (!report.ok) {
        for (const issue of report.hanging.slice(0, 5)) {
            console.warn(`  ${issue.message}`);
        }
    }
}
function distance(a, b) {
    let total = 0;
    for (let i = 0; i < a.length; i += 1) {
        const delta = (a[i] ?? 0) - (b[i] ?? 0);
        total += delta * delta;
    }
    return Math.sqrt(total);
}
function roleCode(role) {
    switch (role) {
        case "selected":
            return 1;
        case "face-transition":
            return 2;
        case "edge-transition":
            return 3;
        case "corner-transition":
            return 4;
        case "unchanged":
            return 0;
    }
}
await main();
