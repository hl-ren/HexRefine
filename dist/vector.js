export function add(a, b) {
    assertSameDimension(a, b);
    return a.map((value, index) => value + mustGet(b, index));
}
export function sub(a, b) {
    assertSameDimension(a, b);
    return a.map((value, index) => value - mustGet(b, index));
}
export function scale(a, factor) {
    return a.map((value) => value * factor);
}
export function mix(points, weights) {
    if (points.length === 0) {
        throw new Error("mix requires at least one point");
    }
    if (points.length !== weights.length) {
        throw new Error("mix requires the same number of points and weights");
    }
    const dimension = points[0]?.length ?? 0;
    const result = Array.from({ length: dimension }, () => 0);
    for (let i = 0; i < points.length; i += 1) {
        const point = mustGet(points, i);
        const weight = mustGet(weights, i);
        if (point.length !== dimension) {
            throw new Error("all points in mix must have the same dimension");
        }
        for (let d = 0; d < dimension; d += 1) {
            result[d] = (result[d] ?? 0) + mustGet(point, d) * weight;
        }
    }
    return result;
}
export function lerp(a, b, t) {
    assertSameDimension(a, b);
    return a.map((value, index) => value * (1 - t) + mustGet(b, index) * t);
}
export function norm(a) {
    return Math.sqrt(a.reduce((total, value) => total + value * value, 0));
}
export function distance(a, b) {
    return norm(sub(a, b));
}
export function centroid(points) {
    if (points.length === 0) {
        throw new Error("centroid requires at least one point");
    }
    const weight = 1 / points.length;
    return mix(points, points.map(() => weight));
}
export function pointEquals(a, b, tolerance) {
    if (a.length !== b.length) {
        return false;
    }
    return distance(a, b) <= tolerance;
}
export function assertSameDimension(a, b) {
    if (a.length !== b.length) {
        throw new Error(`point dimension mismatch: ${a.length} vs ${b.length}`);
    }
}
export function mustGet(values, index) {
    const value = values[index];
    if (value === undefined) {
        throw new Error(`index ${index} is out of range`);
    }
    return value;
}
