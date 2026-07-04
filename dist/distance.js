export function Or0(...values) {
    assertNonEmpty(values, "Or0");
    return Math.max(...values);
}
export function And0(...values) {
    assertNonEmpty(values, "And0");
    return Math.min(...values);
}
export function Not0(value) {
    return -value;
}
export function findPointsByDistanceFunction(points, distanceFunction, distValue) {
    const inside = [];
    const inDistanceBand = [];
    const values = [];
    points.forEach((point, index) => {
        const value = distanceFunction(...point);
        values.push(value);
        if (value < distValue) {
            return;
        }
        if (value >= 0) {
            inside.push(index + 1);
        }
        else {
            inDistanceBand.push(index + 1);
        }
    });
    return { inside, inDistanceBand, values };
}
export function boxDistance(min, max) {
    if (min.length !== max.length) {
        throw new Error("boxDistance requires min and max with the same dimension");
    }
    return (...coords) => {
        if (coords.length !== min.length) {
            throw new Error(`boxDistance expected ${min.length} coordinates, got ${coords.length}`);
        }
        const constraints = [];
        for (let i = 0; i < coords.length; i += 1) {
            constraints.push(coords[i] - min[i]);
            constraints.push(max[i] - coords[i]);
        }
        return And0(...constraints);
    };
}
export function sphereDistance(center, radius) {
    if (radius < 0) {
        throw new Error("sphereDistance radius must be non-negative");
    }
    return (...coords) => {
        if (coords.length !== center.length) {
            throw new Error(`sphereDistance expected ${center.length} coordinates, got ${coords.length}`);
        }
        return radius - distance(coords, center);
    };
}
export function circleDistance(center, radius) {
    if (center.length !== 2) {
        throw new Error("circleDistance requires a 2D center");
    }
    return sphereDistance(center, radius);
}
export function halfSpaceDistance(normal, offset) {
    const normalLength = distance(normal, Array.from({ length: normal.length }, () => 0));
    if (normalLength === 0) {
        throw new Error("halfSpaceDistance normal must be non-zero");
    }
    return (...coords) => {
        if (coords.length !== normal.length) {
            throw new Error(`halfSpaceDistance expected ${normal.length} coordinates, got ${coords.length}`);
        }
        return (dot(normal, coords) - offset) / normalLength;
    };
}
export function bandDistance(distanceFunction, innerOffset, outerOffset) {
    if (innerOffset > outerOffset) {
        throw new Error("bandDistance innerOffset must be <= outerOffset");
    }
    return (...coords) => {
        const value = distanceFunction(...coords);
        return And0(value - innerOffset, outerOffset - value);
    };
}
function assertNonEmpty(values, name) {
    if (values.length === 0) {
        throw new Error(`${name} requires at least one value`);
    }
}
function dot(a, b) {
    let total = 0;
    for (let i = 0; i < a.length; i += 1) {
        total += a[i] * b[i];
    }
    return total;
}
function distance(a, b) {
    let total = 0;
    for (let i = 0; i < a.length; i += 1) {
        const delta = a[i] - b[i];
        total += delta * delta;
    }
    return Math.sqrt(total);
}
