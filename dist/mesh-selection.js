import { elementCenter } from "./mesh.js";
import { findPointsByDistanceFunction } from "./distance.js";
export function pointInBox(point, box) {
    if (point.length !== box.min.length || point.length !== box.max.length) {
        throw new Error("point and box dimensions must match");
    }
    return point.every((value, index) => value >= box.min[index] && value <= box.max[index]);
}
export function selectElementsByDistanceFunction(mesh, distanceFunction, distValue = 0) {
    const centers = mesh.elements.map((element) => elementCenter(mesh, element));
    return findPointsByDistanceFunction(centers, distanceFunction, distValue);
}
