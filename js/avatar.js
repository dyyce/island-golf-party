// Little cartoon golfer that stands next to a player's ball.
// Customization: color + hat (none / cap / party cone / propeller).

import * as THREE from 'three';
import { GROUND_Y } from './course.js';

export const HATS = [
  { id: 'none', label: '🚫' },
  { id: 'cap', label: '🧢' },
  { id: 'cone', label: '🎉' },
  { id: 'prop', label: '🚁' },
];

export function makeAvatar(color, hat) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.28, 0.42, 6, 12),
    new THREE.MeshPhongMaterial({ color, shininess: 40 })
  );
  body.position.y = 0.55;
  body.castShadow = true;
  g.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 16, 12),
    new THREE.MeshPhongMaterial({ color: 0xffd9b3, shininess: 20 })
  );
  head.position.y = 1.18;
  head.castShadow = true;
  g.add(head);

  // eyes
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: 0x222222 }));
    eye.position.set(side * 0.1, 1.22, 0.22);
    g.add(eye);
  }

  // hat
  if (hat === 'cap') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhongMaterial({ color }));
    cap.position.y = 1.24;
    g.add(cap);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.04, 12, 1, false, 0, Math.PI), new THREE.MeshPhongMaterial({ color }));
    brim.position.set(0, 1.26, 0.24);
    g.add(brim);
  } else if (hat === 'cone') {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 12), new THREE.MeshPhongMaterial({ color: 0xffcf3f }));
    cone.position.y = 1.62;
    g.add(cone);
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshPhongMaterial({ color: 0xe64545 }));
    pom.position.y = 1.9;
    g.add(pom);
  } else if (hat === 'prop') {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhongMaterial({ color: 0xe64545 }));
    dome.position.y = 1.24;
    g.add(dome);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 6), new THREE.MeshPhongMaterial({ color: 0x888888 }));
    stick.position.y = 1.58;
    g.add(stick);
    const blades = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.02, 0.08), new THREE.MeshPhongMaterial({ color: 0xffcf3f }));
    blades.position.y = 1.66;
    blades.name = 'propBlades';
    g.add(blades);
  }

  // golf club
  const club = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 6), new THREE.MeshPhongMaterial({ color: 0xcccccc }));
  shaft.position.y = 0.4;
  club.add(shaft);
  const headClub = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.08), new THREE.MeshPhongMaterial({ color: 0x555555 }));
  headClub.position.y = 0.02;
  club.add(headClub);
  club.position.set(0.38, 0, 0.15);
  club.rotation.z = -0.25;
  g.add(club);

  g.position.y = GROUND_Y;
  return g;
}

export function animateAvatar(g, t) {
  g.position.y = GROUND_Y + Math.abs(Math.sin(t * 2.2)) * 0.04; // idle bob
  const blades = g.getObjectByName('propBlades');
  if (blades) blades.rotation.y = t * 12;
}
