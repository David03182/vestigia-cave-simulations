import {
  Box3, BufferGeometry, DoubleSide, Float32BufferAttribute, Line3, Matrix3,
  Ray, Vector3
} from 'three';
import { MeshBVH } from 'three-mesh-bvh';

export const LAMP_RADIUS = 0.18;
const SKIN = 0.002;
const CLEARANCE = LAMP_RADIUS + SKIN;

// BVH queries use local coordinates. A sphere remains a sphere under uniform
// scale. Bake unusual transforms or quantised positions for the collision copy.
function collisionMesh(mesh) {
  const original = mesh.geometry;
  const position = original.attributes.position;
  const matrix = mesh.matrixWorld.clone();
  const axes = [0, 1, 2].map(axis => new Vector3().setFromMatrixColumn(matrix, axis));
  const scale = axes[0].length();
  const uniform = scale > 0 && axes.every(axis => Math.abs(axis.length() - scale) < scale * 1e-6)
    && Math.abs(axes[0].dot(axes[1])) < scale * scale * 1e-6
    && Math.abs(axes[0].dot(axes[2])) < scale * scale * 1e-6
    && Math.abs(axes[1].dot(axes[2])) < scale * scale * 1e-6;
  let geometry = original;
  const bake = !uniform || position.normalized;
  if (bake) {
    geometry = new BufferGeometry();
    const positions = new Float32Array(position.count * 3);
    const vertex = new Vector3();
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(matrix).toArray(positions, i * 3);
    }
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setIndex(original.index);
    geometry.setDrawRange(original.drawRange.start, original.drawRange.count);
    geometry.groups = original.groups.map(group => ({ ...group }));
  }
  const originalInverse = matrix.clone().invert();
  const originalNormal = new Matrix3().getNormalMatrix(matrix);
  const bakedNormalToOriginal = new Matrix3().getNormalMatrix(originalInverse);
  if (bake) matrix.identity();

  return {
    mesh, geometry, matrix, inverse: matrix.clone().invert(),
    scale: bake ? 1 : scale, originalNormal, bakedNormalToOriginal, bake,
    tree: new MeshBVH(geometry, { indirect: true, verbose: false })
  };
}

export function createCaveCollision(object) {
  object.updateWorldMatrix(true, true);
  const colliders = [];
  const bounds = new Box3();
  object.traverse(mesh => {
    if (!mesh.isMesh || !mesh.geometry?.attributes.position?.count) return;
    const collider = collisionMesh(mesh);
    bounds.union(collider.geometry.boundingBox.clone().applyMatrix4(collider.matrix));
    colliders.push(collider);
  });
  if (!colliders.length) throw new Error('No cave geometry is available for collision checks.');

  const segment = new Line3();
  const sweepBox = new Box3();
  const onSurface = new Vector3();
  const onSegment = new Vector3();
  const localNormal = new Vector3();
  const direction = new Vector3();
  const initial = new Vector3();
  const goal = new Vector3();
  const segmentStart = new Vector3();
  const segmentEnd = new Vector3();
  const contact = new Vector3();
  const accepted = new Vector3();
  const normal = new Vector3();
  const remaining = new Vector3();
  const localRay = new Ray();
  const worldNormal = new Matrix3();

  function intersectsSweep(from, to, contactNormal) {
    for (const collider of colliders) {
      segment.start.copy(from).applyMatrix4(collider.inverse);
      segment.end.copy(to).applyMatrix4(collider.inverse);
      direction.subVectors(segment.end, segment.start);
      const stationary = direction.lengthSq() < 1e-20;
      const radius = CLEARANCE / collider.scale;
      sweepBox.min.copy(segment.start).min(segment.end).addScalar(-radius);
      sweepBox.max.copy(segment.start).max(segment.end).addScalar(radius);
      const hit = collider.tree.shapecast({
        intersectsBounds: box => sweepBox.intersectsBox(box),
        intersectsTriangle: triangle => {
          let distance;
          if (stationary) {
            onSegment.copy(segment.start);
            triangle.closestPointToPoint(onSegment, onSurface);
            distance = onSegment.distanceTo(onSurface);
          } else {
            distance = triangle.closestPointToSegment(segment, onSurface, onSegment);
          }
          if (distance > radius) return false;
          if (contactNormal) {
            localNormal.subVectors(onSegment, onSurface);
            if (localNormal.lengthSq() < 1e-16) {
              triangle.getNormal(localNormal);
              if (localNormal.dot(direction) > 0) localNormal.negate();
            }
            contactNormal.copy(localNormal)
              .applyMatrix3(worldNormal.getNormalMatrix(collider.matrix)).normalize();
          }
          return true;
        }
      });
      if (hit) return true;
    }
    return false;
  }

  function isClear(position) {
    return !intersectsSweep(position, position);
  }

  function move(from, destination, target, slide = 'free') {
    initial.copy(from);
    goal.copy(destination);
    accepted.copy(initial);
    segmentStart.copy(initial);
    segmentEnd.copy(goal);
    if (!isClear(initial)) {
      target.copy(initial);
      return true;
    }
    let blocked = false;
    // Recheck the path after projecting the remaining movement along a wall.
    // Two extra passes let a drag meet two walls without passing a corner.
    for (let pass = 0; pass < 3; pass++) {
      if (!intersectsSweep(segmentStart, segmentEnd)) {
        accepted.copy(segmentEnd);
        break;
      }
      blocked = true;
      const length = segmentStart.distanceTo(segmentEnd);
      if (length < 1e-6) break;
      let low = 0;
      let high = 1;
      // The question is whether ANY earlier part of the path collides, which
      // stays true beyond the first contact even when the endpoint is clear.
      for (let i = 0; i < 14; i++) {
        const fraction = (low + high) / 2;
        contact.lerpVectors(segmentStart, segmentEnd, fraction);
        if (intersectsSweep(segmentStart, contact)) high = fraction;
        else low = fraction;
      }
      contact.lerpVectors(segmentStart, segmentEnd, high);
      if (!intersectsSweep(segmentStart, contact, normal)) break;
      accepted.lerpVectors(segmentStart, segmentEnd, Math.max(0, low - SKIN / length));
      if (slide === 'none') break;
      if (slide === 'horizontal') {
        normal.y = 0;
        normal.normalize();
      }
      remaining.subVectors(segmentEnd, accepted);
      const intoWall = remaining.dot(normal);
      if (intoWall >= -1e-7 || normal.lengthSq() < 0.5) break;
      remaining.addScaledVector(normal, -intoWall);
      if (remaining.lengthSq() < 1e-10) break;
      segmentStart.copy(accepted);
      segmentEnd.copy(accepted).add(remaining);
    }
    target.copy(accepted);
    return blocked;
  }

  function raycast(ray, maxDistance = Infinity) {
    let nearest = null;
    let limit = maxDistance;
    for (const collider of colliders) {
      localRay.copy(ray).applyMatrix4(collider.inverse);
      const hit = collider.tree.raycastFirst(localRay, DoubleSide, 0, limit / collider.scale);
      if (!hit) continue;
      const point = hit.point.applyMatrix4(collider.matrix);
      const distance = point.distanceTo(ray.origin);
      if (distance > limit) continue;
      const face = hit.face;
      const normal = face.normal.clone();
      if (collider.bake) face.normal.applyMatrix3(collider.bakedNormalToOriginal).normalize();
      else normal.applyMatrix3(collider.originalNormal).normalize();
      nearest = { ...hit, point, distance, object: collider.mesh, face, normal };
      limit = distance;
    }
    return nearest;
  }

  return { move, isClear, bounds, raycast };
}
