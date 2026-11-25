import * as T from 'three';
import { FORE, REACH, UPPER, reachOnLine, solveArm, splitArm } from './arm-ik';

describe('arm-ik', () => {
  function makeArm() {
    const torso = new T.Group();
    const arm = new T.Group();
    arm.position.set(5, 7, 0);
    torso.add(arm);
    arm.add(new T.Mesh(new T.CylinderGeometry(1.45, 1.13, 8, 6)));
    const hand = new T.Mesh(new T.SphereGeometry(1.3));
    hand.position.set(0, -(UPPER + FORE), 0);
    arm.add(hand);
    return { torso, arm, hand, limb: splitArm(arm, 1) };
  }

  it('puts the hand exactly on a reachable target', () => {
    const { torso, arm, hand, limb } = makeArm();
    const out = { shoulder: new T.Quaternion(), elbow: 0, reached: new T.Vector3() };
    for (const t of [[1.5, 9, 4], [5, 0, 0], [3, 12, -3]] as const) {
      const target = new T.Vector3(...t);
      solveArm(arm.position, target, new T.Vector3(0.7, -1, -0.6), out);
      arm.quaternion.copy(out.shoulder);
      limb.elbow.rotation.x = out.elbow;
      torso.updateMatrixWorld(true);
      expect(hand.getWorldPosition(new T.Vector3()).distanceTo(target)).toBeLessThan(1e-3);
      expect(out.elbow).toBeLessThanOrEqual(0); // le coude plie vers l'avant
    }
  });

  it('slides the grip along the shaft to the nearest reachable point', () => {
    const shoulder = new T.Vector3(0, 0, 0);
    const origin = new T.Vector3(3, 0, -20);
    const dir = new T.Vector3(0, 0, 1);
    const u = reachOnLine(origin, dir, shoulder, 0, -30, 30);
    const p = origin.clone().addScaledVector(dir, u);
    expect(p.distanceTo(shoulder)).toBeLessThanOrEqual(REACH + 1e-6);
    expect(u).toBeGreaterThan(10); // la main a remonté le fût
  });
});
