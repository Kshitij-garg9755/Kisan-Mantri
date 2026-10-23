import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';

(function () {
  'use strict';

  var modal = document.getElementById('land-model-modal');
  var stage = document.getElementById('land-model-canvas');
  var loading = document.getElementById('land-model-loading');
  var errorPanel = document.getElementById('land-model-error');
  var renderer;
  var labelRenderer;
  var scene;
  var camera;
  var controls;
  var landGroup;
  var labelGroup;
  var boundaryGroup;
  var pointGroup;
  var currentMeasurement;
  var boundaryVisible = true;
  var labelsVisible = true;
  var visualHeight = 2;

  function showError(message) {
    loading.hidden = true;
    errorPanel.textContent = message;
    errorPanel.hidden = false;
  }

  function localCoordinates(coordinates) {
    var origin = coordinates[0];
    var radius = 6371008.8;
    var latitude = origin.lat * Math.PI / 180;
    return coordinates.map(function (point) {
      return {
        x: radius * (point.lng - origin.lng) * Math.PI / 180 * Math.cos(latitude),
        z: -radius * (point.lat - origin.lat) * Math.PI / 180
      };
    });
  }

  function centerPoints(points) {
    var center = points.reduce(function (sum, point) { return { x: sum.x + point.x, z: sum.z + point.z }; }, { x: 0, z: 0 });
    center.x /= points.length;
    center.z /= points.length;
    return points.map(function (point) { return { x: point.x - center.x, z: point.z - center.z }; });
  }

  function formatDate(value) {
    return new Date(value || Date.now()).toLocaleString();
  }

  function createLabel(text, className, position) {
    var element = document.createElement('div');
    element.className = 'land-3d-label ' + className;
    element.textContent = text;
    var label = new CSS2DObject(element);
    label.position.set(position.x, position.y, position.z);
    labelGroup.add(label);
    return label;
  }

  function distanceMeters(first, second) {
    var radius = 6371008.8;
    var lat1 = first.lat * Math.PI / 180;
    var lat2 = second.lat * Math.PI / 180;
    var deltaLat = (second.lat - first.lat) * Math.PI / 180;
    var deltaLng = (second.lng - first.lng) * Math.PI / 180;
    var a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
    return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function updateInfo() {
    document.getElementById('land-model-name').textContent = currentMeasurement.name;
    document.getElementById('model-area-acres').textContent = currentMeasurement.acres.toFixed(4) + ' ac';
    document.getElementById('model-area-m2').textContent = currentMeasurement.areaM2.toFixed(2) + ' m²';
    document.getElementById('model-area-ft2').textContent = currentMeasurement.areaFt2.toFixed(2) + ' ft²';
    document.getElementById('model-area-ha').textContent = currentMeasurement.hectares.toFixed(4) + ' ha';
    document.getElementById('model-perimeter').textContent = currentMeasurement.perimeterM.toFixed(2) + ' m';
    document.getElementById('model-point-count').textContent = String(currentMeasurement.coordinates.length);
    document.getElementById('model-created-at').textContent = formatDate(currentMeasurement.createdAt);
    var coordinateList = document.getElementById('model-coordinate-list');
    coordinateList.innerHTML = '';
    currentMeasurement.coordinates.forEach(function (point, index) {
      var item = document.createElement('li');
      item.textContent = '#' + (index + 1) + ' ' + point.lat.toFixed(6) + ', ' + point.lng.toFixed(6);
      coordinateList.appendChild(item);
    });
  }

  function disposeGroup(group) {
    if (!group) return;
    group.traverse(function (object) {
      if (object.geometry) object.geometry.dispose();
      if (object.material) {
        if (Array.isArray(object.material)) object.material.forEach(function (material) { material.dispose(); });
        else object.material.dispose();
      }
    });
    scene.remove(group);
  }

  function buildModel() {
    if (!currentMeasurement || currentMeasurement.coordinates.length < 3) throw new Error('At least three coordinates are required.');
    if (landGroup) disposeGroup(landGroup);
    if (labelGroup) scene.remove(labelGroup);
    landGroup = new THREE.Group();
    boundaryGroup = new THREE.Group();
    pointGroup = new THREE.Group();
    labelGroup = new THREE.Group();
    var points = centerPoints(localCoordinates(currentMeasurement.coordinates));
    var shape = new THREE.Shape();
    points.forEach(function (point, index) { if (index === 0) shape.moveTo(point.x, -point.z); else shape.lineTo(point.x, -point.z); });
    shape.closePath();
    var terrainGeometry = new THREE.ExtrudeGeometry(shape, { depth: visualHeight, bevelEnabled: false });
    terrainGeometry.rotateX(-Math.PI / 2);
    var terrain = new THREE.Mesh(terrainGeometry, new THREE.MeshStandardMaterial({ color: 0x9bcf62, transparent: true, opacity: .72, side: THREE.DoubleSide, roughness: .86 }));
    terrain.position.y = 0;
    landGroup.add(terrain);

    var boundaryPoints = points.map(function (point) { return new THREE.Vector3(point.x, visualHeight + .08, point.z); });
    boundaryPoints.push(boundaryPoints[0].clone());
    var boundary = new THREE.Line(new THREE.BufferGeometry().setFromPoints(boundaryPoints), new THREE.LineBasicMaterial({ color: 0xe88f67, linewidth: 3 }));
    boundaryGroup.add(boundary);
    points.forEach(function (point, index) {
      var marker = new THREE.Mesh(new THREE.SphereGeometry(Math.max(.7, visualHeight * .38), 16, 12), new THREE.MeshStandardMaterial({ color: 0xe88f67, emissive: 0x3b1c12, emissiveIntensity: .25 }));
      marker.position.set(point.x, visualHeight + .1, point.z);
      pointGroup.add(marker);
      var next = points[(index + 1) % points.length];
      var midpoint = { x: (point.x + next.x) / 2, y: visualHeight + .32, z: (point.z + next.z) / 2 };
      var meters = distanceMeters(currentMeasurement.coordinates[index], currentMeasurement.coordinates[(index + 1) % points.length]);
      createLabel((meters / 1000).toFixed(2) + ' km / ' + (meters * 3.28084).toFixed(1) + ' ft', 'side-label', midpoint);
    });
    var center = points.reduce(function (sum, point) { return { x: sum.x + point.x, z: sum.z + point.z }; }, { x: 0, z: 0 });
    center.x /= points.length; center.z /= points.length;
    createLabel('Area ' + currentMeasurement.areaM2.toFixed(2) + ' m² / ' + currentMeasurement.acres.toFixed(4) + ' ac', 'area-label', { x: center.x, y: visualHeight + 1.2, z: center.z });
    createLabel('Perimeter ' + currentMeasurement.perimeterM.toFixed(2) + ' m', 'perimeter-label', { x: center.x, y: visualHeight + .55, z: center.z + 2 });
    landGroup.add(boundaryGroup, pointGroup);
    scene.add(landGroup, labelGroup);
    updateInfo();
    boundaryGroup.visible = boundaryVisible;
    labelGroup.visible = labelsVisible;
    fitCamera(points);
  }

  function fitCamera(points) {
    var box = new THREE.Box3().setFromObject(landGroup);
    var size = box.getSize(new THREE.Vector3());
    var radius = Math.max(size.x, size.y, size.z, 10);
    camera.position.set(radius * 1.1, radius * .95, radius * 1.1);
    camera.far = radius * 30;
    camera.near = Math.max(.01, radius * .00001);
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.maxDistance = radius * 12;
    controls.minDistance = Math.max(2, radius * .08);
    controls.update();
  }

  function resetCamera() { fitCamera([]); }
  function topView() {
    var box = new THREE.Box3().setFromObject(landGroup);
    var size = box.getSize(new THREE.Vector3());
    var distance = Math.max(size.x, size.z, 10) * 1.25;
    camera.position.set(0, distance, 0.01);
    controls.target.set(0, 0, 0);
    controls.update();
  }
  function threeView() { resetCamera(); }

  function init() {
    if (renderer) return;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe8f0e1);
    camera = new THREE.PerspectiveCamera(45, 1, .1, 100000);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    stage.appendChild(renderer.domElement);
    labelRenderer = new CSS2DRenderer();
    labelRenderer.domElement.className = 'land-label-layer';
    stage.appendChild(labelRenderer.domElement);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.screenSpacePanning = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x49614a, 1.8));
    var light = new THREE.DirectionalLight(0xffffff, 2.1);
    light.position.set(80, 120, 60);
    scene.add(light);
    var grid = new THREE.GridHelper(100, 20, 0x7c9a78, 0xcbd9c1);
    grid.position.y = -.05;
    scene.add(grid);
    resize();
    window.addEventListener('resize', resize);
    animate();
  }

  function resize() {
    if (!renderer) return;
    var width = Math.max(1, stage.clientWidth);
    var height = Math.max(1, stage.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    labelRenderer.setSize(width, height);
  }

  function animate() {
    window.requestAnimationFrame(animate);
    if (!renderer) return;
    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }

  function show(measurement) {
    try {
      init();
      currentMeasurement = measurement;
      modal.hidden = false;
      document.body.classList.add('land-model-open');
      loading.hidden = false;
      errorPanel.hidden = true;
      buildModel();
      loading.hidden = true;
      resize();
    } catch (error) {
      showError('3D model could not be generated from this boundary. Please edit the measurement and try again.');
      console.error('3D land model generation failed', error);
    }
  }

  function close() {
    modal.hidden = true;
    document.body.classList.remove('land-model-open');
  }

  function downloadReport() {
    var report = { type: 'Smart Farm land measurement', visualHeightMeters: visualHeight, elevationAvailable: false, measurement: currentMeasurement };
    var blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a'); link.href = url; link.download = (currentMeasurement.name || 'land-measurement') + '.json'; link.click(); URL.revokeObjectURL(url);
  }

  function downloadModel() {
    if (!landGroup) return;
    var text = new OBJExporter().parse(landGroup);
    var blob = new Blob([text], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a'); link.href = url; link.download = (currentMeasurement.name || 'land-model') + '.obj'; link.click(); URL.revokeObjectURL(url);
  }

  window.addEventListener('smartfarm:open-land-model', function (event) { show(event.detail); });
  window.addEventListener('smartfarm:close-land-model', close);
  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('close-land-model').addEventListener('click', close);
    document.getElementById('model-reset-camera').addEventListener('click', resetCamera);
    document.getElementById('model-top-view').addEventListener('click', topView);
    document.getElementById('model-3d-view').addEventListener('click', threeView);
    document.getElementById('model-fullscreen').addEventListener('click', function () { var target = document.querySelector('.land-model-shell'); if (target.requestFullscreen) target.requestFullscreen(); });
    document.getElementById('model-toggle-boundary').addEventListener('click', function (event) { boundaryVisible = !boundaryVisible; boundaryGroup.visible = boundaryVisible; event.currentTarget.textContent = boundaryVisible ? 'Hide Boundary' : 'Show Boundary'; });
    document.getElementById('model-toggle-labels').addEventListener('click', function (event) { labelsVisible = !labelsVisible; labelGroup.visible = labelsVisible; event.currentTarget.textContent = labelsVisible ? 'Hide Labels' : 'Show Labels'; });
    document.getElementById('model-download-report').addEventListener('click', downloadReport);
    document.getElementById('model-download-obj').addEventListener('click', downloadModel);
    document.getElementById('model-delete-measurement').addEventListener('click', function () { window.dispatchEvent(new CustomEvent('smartfarm:delete-land-measurement')); });
  });
}());
