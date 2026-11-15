(function () {
  var canvases = document.querySelectorAll("canvas[data-scene]");
  if (!canvases.length) return;

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var stoneCanvas = makeStone();
  var waterCanvas = makeWater();
  var sandCanvas = makeSand();
  var gl = null;
  var programs = null;
  var maps = null;
  var shared = null;

  function createView(canvas) {
    var alpha = canvas.getAttribute("data-alpha") === "1";
    var frameEl = canvas.closest(".view");
    var view = {
      canvas: canvas,
      frame: frameEl,
      kind: canvas.getAttribute("data-scene"),
      alpha: alpha,
      colors: themeColors(),
      time: 0,
      userYaw: 0,
      paused: false,
      visible: true,
      batches: null,
      ctx: null
    };
    view.batches = buildScene(view.kind);
    upload(view);
    watch(view);
    var observer = new IntersectionObserver(function (entries) {
      view.visible = entries[0].isIntersecting;
    });
    observer.observe(canvas);
    return view;
  }

  function watch(view) {
    var canvas = view.canvas;
    var drag = false;
    var lastX = 0;
    canvas.addEventListener("pointerenter", function () {
      if (view.frame) view.frame.classList.add("is-hot");
    });
    canvas.addEventListener("pointerleave", function () {
      if (!drag && view.frame) view.frame.classList.remove("is-hot");
    });
    canvas.addEventListener("pointerdown", function (event) {
      if (event.pointerType === "touch") {
        view.touch = { x: event.clientX, y: event.clientY, id: event.pointerId, armed: false };
        return;
      }
      drag = true;
      lastX = event.clientX;
      view.paused = true;
    });
    window.addEventListener("pointerup", function () {
      view.touch = null;
      if (!drag) return;
      drag = false;
      if (!canvas.matches(":hover")) {
        view.paused = false;
        if (view.frame) view.frame.classList.remove("is-hot");
      }
    });
    canvas.addEventListener("pointercancel", function () {
      view.touch = null;
      drag = false;
    });
    canvas.addEventListener("pointermove", function (event) {
      if (event.pointerType === "touch") {
        if (!view.touch || view.touch.id !== event.pointerId) return;
        var dx = event.clientX - view.touch.x;
        var dy = event.clientY - view.touch.y;
        if (!view.touch.armed) {
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
          if (Math.abs(dy) >= Math.abs(dx)) {
            view.touch = null;
            return;
          }
          view.touch.armed = true;
          drag = true;
          view.paused = true;
          if (view.frame) view.frame.classList.add("is-hot");
          if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
        }
        view.userYaw = clamp(view.userYaw + dx * 0.01, -0.7, 0.7);
        view.touch.x = event.clientX;
        view.touch.y = event.clientY;
        return;
      }
      if (!drag) return;
      view.userYaw = clamp(view.userYaw + (event.clientX - lastX) * 0.008, -0.7, 0.7);
      lastX = event.clientX;
    });
  }

  function draw(view) {
    var mini = view.kind.indexOf("mini-") === 0;
    var angle = view.userYaw;
    if (!reduced && mini) angle = view.time * 0.9;
    else if (!reduced) angle = view.userYaw + Math.sin(view.time * 0.55) * 0.314;
    var yaw = yawMatrix(angle);
    var still = yawMatrix(0);
    var aspect = view.canvas.width / Math.max(1, view.canvas.height);
    var phone = window.matchMedia("(max-width: 860px)").matches;
    var projection = perspective(mini ? 0.7 : view.kind === "hero" ? (phone ? 0.78 : 0.64) : (phone ? 0.74 : 0.62), aspect, 0.1, 40);
    var eye = phone ? [0.15, 0.72, 3.9] : [0.2, 0.55, 3.35];
    var target = [0, 0, 0];
    if (mini) {
      eye = phone ? [1.05, 0.82, 2.35] : [1.15, 0.9, 2.2];
    } else if (view.kind === "hero") {
      eye = phone ? [0.18, 1.22, 4.35] : [0.3, 1.02, 3.45];
      target = [0.02, 0.34, 0.08];
    } else if (view.kind === "drem") {
      eye = phone ? [0.12, 1.15, 4.15] : [0.22, 0.95, 3.4];
      target = [0.02, 0.28, 0.08];
    }
    var camera = lookAt(eye, target, [0, 1, 0]);
    var viewProj = multiply(projection, camera);
    gl.viewport(0, 0, view.canvas.width, view.canvas.height);
    var clear = view.colors.clear;
    gl.clearColor(clear[0], clear[1], clear[2], view.alpha ? 0 : 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    view.batches.forEach(function (batch) {
      if (batch.opacity < 1) return;
      paint(view, batch, batch.spin ? yaw : still, viewProj, eye);
    });
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    view.batches.forEach(function (batch) {
      if (batch.opacity >= 1) return;
      paint(view, batch, batch.spin ? yaw : still, viewProj, eye);
    });
    gl.depthMask(true);
    present(view);
  }

  function paint(view, batch, model, viewProj, eye) {
    var mvp = multiply(viewProj, model);
    disableAttribs(gl);
    if (batch.mode === "line") {
      var line = programs.line;
      gl.useProgram(line.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, batch.buffer);
      bindAttrib(gl, line, "aPos", 3, 12, 0);
      gl.uniformMatrix4fv(line.uMvp, false, mvp);
      var color = batch.grid === "major" ? view.colors.major : batch.grid === "minor" ? view.colors.minor : batch.color;
      gl.uniform3fv(line.uColor, color);
      gl.drawArrays(gl.LINES, 0, batch.count);
      return;
    }
    var lit = programs.lit;
    gl.useProgram(lit.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, batch.buffer);
    var stride = 8 * 4;
    bindAttrib(gl, lit, "aPos", 3, stride, 0);
    bindAttrib(gl, lit, "aNormal", 3, stride, 12);
    bindAttrib(gl, lit, "aUv", 2, stride, 24);
    gl.uniformMatrix4fv(lit.uMvp, false, mvp);
    gl.uniformMatrix4fv(lit.uModel, false, model);
    gl.uniformMatrix3fv(lit.uNormal, false, normalOf(model));
    gl.uniform3fv(lit.uCam, eye);
    gl.uniform3fv(lit.uBase, batch.color);
    gl.uniform3fv(lit.uKeyDir, [0.45, 0.85, 0.35]);
    gl.uniform3fv(lit.uKeyColor, [1.0, 0.96, 0.9]);
    gl.uniform3fv(lit.uFillDir, [-0.7, 0.25, -0.4]);
    gl.uniform3fv(lit.uFillColor, [0.55, 0.68, 0.78]);
    gl.uniform1f(lit.uRough, batch.rough);
    gl.uniform1f(lit.uOpacity, batch.opacity);
    gl.uniform1f(lit.uUseMap, batch.map ? 1 : 0);
    if (batch.map) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, maps[batch.map]);
      gl.uniform1i(lit.uMap, 0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, batch.count);
  }

  function upload(view) {
    view.batches.forEach(function (batch) {
      batch.buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, batch.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, batch.data, gl.STATIC_DRAW);
    });
  }

  function resize(view) {
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var width = Math.max(1, Math.floor(view.canvas.clientWidth * dpr));
    var height = Math.max(1, Math.floor(view.canvas.clientHeight * dpr));
    if (shared.width !== width || shared.height !== height) {
      shared.width = width;
      shared.height = height;
    }
    if (view.canvas.width !== width || view.canvas.height !== height) {
      view.canvas.width = width;
      view.canvas.height = height;
    }
  }

  function present(view) {
    if (!view.ctx) view.ctx = view.canvas.getContext("2d", { alpha: true });
    view.ctx.clearRect(0, 0, view.canvas.width, view.canvas.height);
    view.ctx.drawImage(shared, 0, 0, view.canvas.width, view.canvas.height);
  }

  function buildScene(kind) {
    if (kind === "castle") return castleScene();
    if (kind === "downline") return downlineScene();
    if (kind === "drem") return dremScene();
    if (kind.indexOf("mini-") === 0) return miniScene(kind);
    return heroScene();
  }

  function heroScene() {
    var gridMinor = lines(gridPoints(0.5, 6), "minor");
    var gridMajor = lines(gridPoints(2, 6), "major");
    var sand = triMesh();
    sand.map = "sand";
    sand.color = [1, 0.96, 0.88];
    sand.rough = 0.94;
    sand.spin = false;
    addGround(sand, 6.4, 12);
    var drem = buildDrem([0, 0, 0], 1.08);
    pack(sand);
    return [gridMinor, gridMajor, sand].concat(drem);
  }

  function castleScene() {
    var castle = triMesh();
    castle.map = "stone";
    castle.color = [1, 0.97, 0.9];
    castle.rough = 0.76;
    addCastle(castle, 1, [0, -0.05, 0]);
    var slits = triMesh();
    slits.color = [0.14, 0.11, 0.1];
    slits.rough = 0.95;
    addSlits(slits, 1, [0, -0.05, 0]);
    var shell = triMesh();
    shell.map = "stone";
    shell.color = [0.9, 0.84, 0.74];
    shell.rough = 0.84;
    shell.opacity = 0.38;
    addIcosahedron(shell, 1.28, 0, [0, 0, 0], 1);
    var edge = lines(edgePoints(shell.rawFaces, 1.03), "edge");
    edge.color = [0.93, 0.86, 0.72];
    edge.spin = true;
    pack(castle);
    pack(slits);
    pack(shell);
    return [castle, slits, shell, edge];
  }

  function downlineScene() {
    var rocks = triMesh();
    rocks.map = "stone";
    rocks.color = [0.55, 0.62, 0.64];
    rocks.rough = 0.92;
    addIcosahedron(rocks, 0.34, 0, [-0.28, -0.28, 0.1], 0.7);
    addIcosahedron(rocks, 0.26, 0, [0.32, -0.34, -0.12], 1.4);
    addIcosahedron(rocks, 0.2, 0, [0.05, -0.12, 0.32], 2.1);
    var shark = triMesh();
    shark.color = [0.74, 0.84, 0.88];
    shark.rough = 0.38;
    addFishBody(shark, 0.85, [0.05, 0.05, 0], 1);
    var eyes = triMesh();
    eyes.color = [0.07, 0.08, 0.09];
    eyes.rough = 0.25;
    addFishEyes(eyes, 0.85, [0.05, 0.05, 0]);
    var shell = triMesh();
    shell.map = "water";
    shell.color = [0.7, 0.95, 1];
    shell.rough = 0.16;
    shell.opacity = 0.34;
    addIcosahedron(shell, 1.2, 1, [0, 0, 0], 0);
    var edge = lines(edgePoints(shell.rawFaces, 1.02), "edge");
    edge.color = [0.75, 0.9, 0.95];
    edge.spin = true;
    pack(rocks);
    pack(shark);
    pack(eyes);
    pack(shell);
    return [rocks, shark, eyes, shell, edge];
  }

  function dremScene() {
    var sand = triMesh();
    sand.map = "sand";
    sand.color = [1, 0.96, 0.88];
    sand.rough = 0.94;
    sand.spin = false;
    addGround(sand, 6.2, 12);
    var group = buildDrem([0, 0, 0], 1);
    pack(sand);
    return [sand].concat(group);
  }

  function miniScene(kind) {
    var parts = [];
    function solid(color, rough) {
      var mesh = triMesh();
      mesh.color = color;
      mesh.rough = rough == null ? 0.38 : rough;
      return mesh;
    }
    function keep(mesh) {
      pack(mesh);
      parts.push(mesh);
    }
    function note(mesh, x, y, z) {
      addCylinder(mesh, [x - 0.06, y - 0.28, z], [0, 0, 1], 0.15, 0.07, 10);
      addBox(mesh, x + 0.09, y + 0.02, z, 0.05, 0.56, 0.045);
      addBox(mesh, x - 0.02, y + 0.27, z, 0.24, 0.065, 0.04);
    }
    if (kind === "mini-itch") {
      var blob = solid([0.98, 0.36, 0.36], 0.42);
      addIcosahedron(blob, 0.52, 1, [0, 0.04, 0], 0.3);
      addIcosahedron(blob, 0.11, 0, [-0.22, -0.4, 0.04], 1);
      addIcosahedron(blob, 0.11, 0, [0.22, -0.4, 0.04], 1.4);
      var cheek = solid([1, 0.68, 0.64], 0.3);
      addIcosahedron(cheek, 0.2, 0, [0, -0.06, 0.36], 0);
      var pupil = solid([0.15, 0.08, 0.1], 0.25);
      addIcosahedron(pupil, 0.055, 0, [-0.13, 0.12, 0.4], 0);
      addIcosahedron(pupil, 0.055, 0, [0.13, 0.12, 0.4], 0);
      keep(blob);
      keep(cheek);
      keep(pupil);
    } else if (kind === "mini-art") {
      var blue = solid([0.075, 0.686, 0.941], 0.32);
      addCone(blue, [0, -0.48, 0], [0, 1, 0], 0.5, 0.98, 3);
      var cut = solid([0.02, 0.28, 0.48], 0.4);
      addBox(cut, 0.02, -0.02, 0.16, 0.2, 0.14, 0.16);
      keep(blue);
      keep(cut);
    } else if (kind === "mini-ig") {
      var body = solid([0.76, 0.21, 0.52], 0.4);
      addBox(body, 0, 0, 0, 0.74, 0.74, 0.14);
      var ring = solid([0.97, 0.47, 0.22], 0.22);
      addCylinder(ring, [0, 0, 0.07], [0, 0, 1], 0.22, 0.07, 14);
      var glass = solid([0.51, 0.23, 0.71], 0.12);
      addCylinder(glass, [0, 0, 0.12], [0, 0, 1], 0.12, 0.05, 12);
      var flash = solid([0.99, 0.69, 0.27], 0.28);
      addCylinder(flash, [0.22, 0.22, 0.08], [0, 0, 1], 0.045, 0.05, 8);
      var finder = solid([0.93, 0.28, 0.48], 0.35);
      addBox(finder, -0.22, 0.24, 0.04, 0.1, 0.055, 0.06);
      keep(body);
      keep(ring);
      keep(glass);
      keep(flash);
      keep(finder);
    } else if (kind === "mini-tt") {
      var cyan = solid([0.145, 0.957, 0.933], 0.28);
      var magenta = solid([0.996, 0.173, 0.333], 0.28);
      var front = solid([0.97, 0.97, 0.98], 0.22);
      note(cyan, -0.07, 0, -0.07);
      note(magenta, 0.08, 0, 0.01);
      note(front, 0, 0.02, 0.09);
      keep(cyan);
      keep(magenta);
      keep(front);
    } else if (kind === "mini-tg") {
      var disc = solid([0.165, 0.671, 0.933], 0.28);
      addCylinder(disc, [0, 0, -0.06], [0, 0, 1], 0.58, 0.08, 16);
      var plane = solid([0.97, 0.98, 1], 0.18);
      addCone(plane, [-0.16, 0.02, 0.08], [1, 0.12, 0], 0.09, 0.52, 4);
      addBox(plane, -0.02, 0.02, 0.08, 0.14, 0.018, 0.46);
      addBox(plane, -0.16, 0.1, 0.08, 0.12, 0.12, 0.018);
      keep(disc);
      keep(plane);
    } else {
      var mail = solid([0.918, 0.263, 0.208], 0.38);
      addBox(mail, 0, 0, 0, 0.86, 0.56, 0.1);
      var paper = solid([0.97, 0.97, 0.98], 0.3);
      addBox(paper, 0, -0.02, 0.04, 0.68, 0.34, 0.03);
      var flap = solid([0.82, 0.18, 0.16], 0.32);
      addCone(flap, [0, 0.06, 0.05], [0, -0.15, 1], 0.26, 0.2, 4);
      var gBlue = solid([0.26, 0.52, 0.96], 0.3);
      var gGreen = solid([0.2, 0.66, 0.33], 0.3);
      var gYellow = solid([0.98, 0.74, 0.02], 0.3);
      addBox(gBlue, -0.34, -0.2, 0.06, 0.1, 0.1, 0.03);
      addBox(gGreen, 0.34, -0.2, 0.06, 0.1, 0.1, 0.03);
      addBox(gYellow, 0.34, 0.18, 0.06, 0.1, 0.1, 0.03);
      keep(mail);
      keep(paper);
      keep(flap);
      keep(gBlue);
      keep(gGreen);
      keep(gYellow);
    }
    return parts;
  }

  function triMesh() {
    return {
      mode: "tri",
      positions: [],
      normals: [],
      uvs: [],
      rawFaces: [],
      color: [1, 1, 1],
      opacity: 1,
      rough: 0.7,
      map: null,
      spin: true,
      data: null,
      count: 0
    };
  }

  function lines(points, grid) {
    return {
      mode: "line",
      data: new Float32Array(points),
      count: points.length / 3,
      grid: grid,
      color: [1, 1, 1],
      opacity: 1,
      spin: false
    };
  }

  function pack(mesh) {
    var count = mesh.positions.length / 3;
    var data = new Float32Array(count * 8);
    for (var i = 0; i < count; i++) {
      data[i * 8] = mesh.positions[i * 3];
      data[i * 8 + 1] = mesh.positions[i * 3 + 1];
      data[i * 8 + 2] = mesh.positions[i * 3 + 2];
      data[i * 8 + 3] = mesh.normals[i * 3];
      data[i * 8 + 4] = mesh.normals[i * 3 + 1];
      data[i * 8 + 5] = mesh.normals[i * 3 + 2];
      data[i * 8 + 6] = mesh.uvs[i * 2];
      data[i * 8 + 7] = mesh.uvs[i * 2 + 1];
    }
    mesh.data = data;
    mesh.count = count;
  }

  function addTri(mesh, a, b, c) {
    var ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    var ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    var n = cross(ab, ac);
    var len = Math.hypot(n[0], n[1], n[2]) || 1;
    n[0] /= len;
    n[1] /= len;
    n[2] /= len;
    [a, b, c].forEach(function (p) {
      mesh.positions.push(p[0], p[1], p[2]);
      mesh.normals.push(n[0], n[1], n[2]);
      mesh.uvs.push(p[0] * 0.45 + 0.5, p[1] * 0.45 + 0.5);
    });
    mesh.rawFaces.push([a, b, c]);
  }

  function addBox(mesh, cx, cy, cz, sx, sy, sz) {
    var x = sx / 2;
    var y = sy / 2;
    var z = sz / 2;
    var p = [
      [cx - x, cy - y, cz - z],
      [cx + x, cy - y, cz - z],
      [cx + x, cy + y, cz - z],
      [cx - x, cy + y, cz - z],
      [cx - x, cy - y, cz + z],
      [cx + x, cy - y, cz + z],
      [cx + x, cy + y, cz + z],
      [cx - x, cy + y, cz + z]
    ];
    var quads = [[4, 5, 6, 7], [1, 0, 3, 2], [7, 6, 2, 3], [4, 7, 3, 0], [5, 4, 0, 1], [5, 1, 2, 6]];
    quads.forEach(function (q) {
      addTri(mesh, p[q[0]], p[q[1]], p[q[2]]);
      addTri(mesh, p[q[0]], p[q[2]], p[q[3]]);
    });
  }

  function addCone(mesh, origin, axis, radius, length, sides) {
    var nAxis = normalize(axis.slice());
    var apex = [origin[0] + nAxis[0] * length, origin[1] + nAxis[1] * length, origin[2] + nAxis[2] * length];
    var helper = Math.abs(nAxis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    var side = normalize(cross(helper, nAxis));
    var up = normalize(cross(nAxis, side));
    var ring = [];
    for (var i = 0; i < sides; i++) {
      var a = (i / sides) * Math.PI * 2;
      ring.push([
        origin[0] + (Math.cos(a) * side[0] + Math.sin(a) * up[0]) * radius,
        origin[1] + (Math.cos(a) * side[1] + Math.sin(a) * up[1]) * radius,
        origin[2] + (Math.cos(a) * side[2] + Math.sin(a) * up[2]) * radius
      ]);
    }
    for (var j = 0; j < sides; j++) {
      var p0 = ring[j];
      var p1 = ring[(j + 1) % sides];
      addTri(mesh, p0, p1, apex);
      addTri(mesh, p0, origin, p1);
    }
  }

  function addIcosahedron(mesh, radius, detail, center, seed) {
    var t = (1 + Math.sqrt(5)) / 2;
    var verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(normalize);
    var faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    if (detail > 0) {
      var next = [];
      var cache = {};
      function mid(i, j) {
        var key = i < j ? i + ":" + j : j + ":" + i;
        if (cache[key] !== undefined) return cache[key];
        var a = verts[i];
        var b = verts[j];
        verts.push(normalize([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]));
        cache[key] = verts.length - 1;
        return cache[key];
      }
      faces.forEach(function (f) {
        var a = mid(f[0], f[1]);
        var b = mid(f[1], f[2]);
        var c = mid(f[2], f[0]);
        next.push([f[0], a, c], [f[1], b, a], [f[2], c, b], [a, b, c]);
      });
      faces = next;
    }
    faces.forEach(function (f, index) {
      var wobble = 0.86 + Math.abs(Math.sin(seed * 12.3 + index * 2.1)) * 0.28;
      var tri = f.map(function (vi) {
        var p = verts[vi];
        var scale = radius * (detail > 0 ? 1 : wobble);
        return [center[0] + p[0] * scale, center[1] + p[1] * scale, center[2] + p[2] * scale];
      });
      addTri(mesh, tri[0], tri[1], tri[2]);
    });
  }

  function addCastle(mesh, scale, origin) {
    function box(x, y, z, sx, sy, sz) {
      addBox(mesh, origin[0] + x * scale, origin[1] + y * scale, origin[2] + z * scale, sx * scale, sy * scale, sz * scale);
    }
    function roof(x, y, z, r, h) {
      addCone(mesh, [origin[0] + x * scale, origin[1] + y * scale, origin[2] + z * scale], [0, 1, 0], r * scale, h * scale, 4);
    }
    box(0, 0, 0, 0.92, 0.14, 0.7);
    box(0, 0.28, 0, 0.4, 0.46, 0.34);
    box(-0.34, 0.32, 0, 0.24, 0.62, 0.24);
    box(0.34, 0.38, 0, 0.24, 0.74, 0.24);
    roof(0, 0.51, 0, 0.26, 0.22);
    roof(-0.34, 0.63, 0, 0.16, 0.2);
    roof(0.34, 0.75, 0, 0.16, 0.22);
  }

  function addSlits(mesh, scale, origin) {
    function box(x, y, z, sx, sy, sz) {
      addBox(mesh, origin[0] + x * scale, origin[1] + y * scale, origin[2] + z * scale, sx * scale, sy * scale, sz * scale);
    }
    box(-0.1, 0.22, 0.18, 0.05, 0.12, 0.03);
    box(0.1, 0.3, 0.18, 0.05, 0.14, 0.03);
    box(0.34, 0.42, 0.13, 0.04, 0.16, 0.03);
  }

  function fishPoint(origin, scale, x, y, z) {
    return [origin[0] + x * scale, origin[1] + y * scale, origin[2] + z * scale];
  }

  function addFishBody(mesh, scale, origin, girth) {
    var profile = [
      { x: -0.58, y: 0.01, r: 0.02 },
      { x: -0.42, y: 0.0, r: 0.07 },
      { x: -0.2, y: -0.01, r: 0.13 },
      { x: 0.02, y: -0.01, r: 0.16 },
      { x: 0.24, y: 0.01, r: 0.14 },
      { x: 0.4, y: 0.03, r: 0.09 },
      { x: 0.54, y: 0.045, r: 0.04 },
      { x: 0.64, y: 0.05, r: 0.012 }
    ];
    var sides = 12;
    var rings = profile.map(function (station) {
      var ring = [];
      for (var i = 0; i < sides; i++) {
        var a = (i / sides) * Math.PI * 2;
        var cy = Math.cos(a);
        var cz = Math.sin(a);
        var ry = station.r * girth * (cy < -0.2 ? 0.7 : 1);
        var rz = station.r * girth * 0.62;
        ring.push(fishPoint(origin, scale, station.x, station.y + cy * ry, cz * rz));
      }
      return ring;
    });
    for (var s = 0; s < rings.length - 1; s++) {
      for (var i = 0; i < sides; i++) {
        var j = (i + 1) % sides;
        addTri(mesh, rings[s][i], rings[s][j], rings[s + 1][j]);
        addTri(mesh, rings[s][i], rings[s + 1][j], rings[s + 1][i]);
      }
    }
    var nose = fishPoint(origin, scale, 0.7, 0.05, 0);
    var tail = fishPoint(origin, scale, -0.64, 0.01, 0);
    for (var n = 0; n < sides; n++) {
      addTri(mesh, rings[rings.length - 1][n], rings[rings.length - 1][(n + 1) % sides], nose);
      addTri(mesh, rings[0][(n + 1) % sides], rings[0][n], tail);
    }
    addDoubleTri(mesh, origin, scale, -0.02, 0.14, 0, 0.16, 0.12, 0, -0.08, 0.4, 0);
    addDoubleTri(mesh, origin, scale, -0.5, 0.04, 0, -0.78, 0.28, 0, -0.7, 0.02, 0);
    addDoubleTri(mesh, origin, scale, -0.5, -0.02, 0, -0.74, -0.2, 0, -0.66, 0.0, 0);
    addDoubleTri(mesh, origin, scale, 0.08, -0.04, 0.08, 0.22, -0.05, 0.1, -0.08, -0.1, 0.28);
    addDoubleTri(mesh, origin, scale, 0.08, -0.04, -0.08, -0.08, -0.1, -0.28, 0.22, -0.05, -0.1);
  }

  function addDoubleTri(mesh, origin, scale, ax, ay, az, bx, by, bz, cx, cy, cz) {
    var a = fishPoint(origin, scale, ax, ay, az);
    var b = fishPoint(origin, scale, bx, by, bz);
    var c = fishPoint(origin, scale, cx, cy, cz);
    addTri(mesh, a, b, c);
    addTri(mesh, a, c, b);
  }

  function addFishEyes(mesh, scale, origin) {
    addIcosahedron(mesh, 0.035 * scale, 0, fishPoint(origin, scale, 0.36, 0.06, 0.07), 0);
    addIcosahedron(mesh, 0.035 * scale, 0, fishPoint(origin, scale, 0.36, 0.06, -0.07), 0);
  }

  function addOrcaMarks(mesh, scale, origin) {
    addBox(mesh, origin[0], origin[1] - 0.07 * scale, origin[2], 0.46 * scale, 0.05 * scale, 0.1 * scale);
    addBox(mesh, origin[0] + 0.24 * scale, origin[1] + 0.03 * scale, origin[2] + 0.07 * scale, 0.12 * scale, 0.05 * scale, 0.02 * scale);
    addBox(mesh, origin[0] + 0.24 * scale, origin[1] + 0.03 * scale, origin[2] - 0.07 * scale, 0.12 * scale, 0.05 * scale, 0.02 * scale);
  }

  function addKayak(mesh, origin, scale) {
    addBox(mesh, origin[0], origin[1], origin[2], 0.85 * scale, 0.07 * scale, 0.16 * scale);
    addCone(mesh, [origin[0] + 0.38 * scale, origin[1], origin[2]], [1, 0.2, 0], 0.07 * scale, 0.24 * scale, 5);
    addBox(mesh, origin[0] - 0.02 * scale, origin[1] + 0.14 * scale, origin[2], 0.12 * scale, 0.16 * scale, 0.1 * scale);
    addIcosahedron(mesh, 0.055 * scale, 0, [origin[0] - 0.02 * scale, origin[1] + 0.26 * scale, origin[2]], 0);
    addBox(mesh, origin[0] + 0.05 * scale, origin[1] + 0.1 * scale, origin[2], 0.03 * scale, 0.015 * scale, 0.5 * scale);
  }

  function buildDrem(origin, scale) {
    var ox = origin[0];
    var oy = origin[1];
    var oz = origin[2];
    var plank = triMesh();
    plank.color = [0.58, 0.4, 0.24];
    plank.rough = 0.78;
    var deckX = ox;
    var deckZ = oz - 0.02 * scale;
    var deckTop = oy + 0.06 * scale;
    addBox(plank, deckX, oy + 0.032 * scale, deckZ, 0.5 * scale, 0.056 * scale, 0.42 * scale);
    var stone = triMesh();
    stone.color = [0.78, 0.13, 0.11];
    stone.rough = 0.48;
    var band = triMesh();
    band.color = [0.95, 0.95, 0.93];
    band.rough = 0.32;
    var lamp = triMesh();
    lamp.color = [0.93, 0.74, 0.27];
    lamp.rough = 0.2;
    var dark = triMesh();
    dark.color = [0.12, 0.13, 0.14];
    dark.rough = 0.8;
    addLighthouse(stone, band, lamp, dark, [deckX, deckTop, deckZ], scale);
    var hide = triMesh();
    hide.color = [0.5, 0.36, 0.24];
    hide.rough = 0.72;
    var belly = triMesh();
    belly.color = [0.84, 0.76, 0.64];
    belly.rough = 0.62;
    var tusk = triMesh();
    tusk.color = [0.95, 0.91, 0.8];
    tusk.rough = 0.3;
    var eye = triMesh();
    eye.color = [0.04, 0.04, 0.05];
    eye.rough = 0.2;
    var fold = triMesh();
    fold.color = [0.32, 0.22, 0.15];
    fold.rough = 0.8;
    addWalrus(hide, belly, tusk, eye, fold, [ox - 0.62 * scale, oy, oz + 0.16 * scale], scale * 0.9);
    var coat = triMesh();
    coat.color = [0.16, 0.21, 0.3];
    coat.rough = 0.78;
    var skin = triMesh();
    skin.color = [0.73, 0.56, 0.42];
    skin.rough = 0.55;
    addPerson(coat, fold, skin, band, dark, [ox + 0.56 * scale, oy, oz + 0.2 * scale], scale * 0.78);
    [plank, stone, band, lamp, dark, hide, belly, tusk, eye, fold, coat, skin].forEach(pack);
    return [plank, stone, band, lamp, dark, hide, belly, tusk, eye, fold, coat, skin];
  }

  function addLighthouse(red, white, lamp, dark, origin, scale) {
    var x = origin[0];
    var y = origin[1];
    var z = origin[2];
    var radius = 0.1 * scale;
    [[white, 0, 0.12], [red, 0.12, 0.12], [white, 0.24, 0.12], [red, 0.36, 0.12], [white, 0.48, 0.12]].forEach(function (stripe) {
      addCylinder(stripe[0], [x, y + stripe[1] * scale, z], [0, 1, 0], radius, stripe[2] * scale, 10);
    });
    addCylinder(white, [x, y + 0.6 * scale, z], [0, 1, 0], radius * 1.35, 0.05 * scale, 10);
    addCylinder(lamp, [x, y + 0.65 * scale, z], [0, 1, 0], radius * 0.7, 0.12 * scale, 8);
    addCone(red, [x, y + 0.77 * scale, z], [0, 1, 0], radius * 1.15, 0.16 * scale, 8);
    addBox(dark, x, y + 0.16 * scale, z + radius, 0.04 * scale, 0.08 * scale, 0.015 * scale);
  }

  function addWalrus(hide, belly, tusk, eye, fold, origin, scale) {
    function P(x, y, z) {
      return [origin[0] + x * scale, origin[1] + y * scale, origin[2] + z * scale];
    }
    var stations = [
      { z: -0.48, y: 0.16, rx: 0.05, ry: 0.04 },
      { z: -0.2, y: 0.2, rx: 0.22, ry: 0.15 },
      { z: 0.08, y: 0.22, rx: 0.26, ry: 0.17 },
      { z: 0.32, y: 0.28, rx: 0.14, ry: 0.11 },
      { z: 0.52, y: 0.3, rx: 0.08, ry: 0.06 }
    ];
    var sides = 8;
    var rings = stations.map(function (st) {
      var ring = [];
      for (var i = 0; i < sides; i++) {
        var a = (i / sides) * Math.PI * 2;
        ring.push(P(Math.sin(a) * st.rx, st.y + Math.cos(a) * st.ry, st.z));
      }
      return ring;
    });
    for (var s = 0; s < rings.length - 1; s++) {
      for (var i = 0; i < sides; i++) {
        var j = (i + 1) % sides;
        addTri(hide, rings[s][i], rings[s][j], rings[s + 1][j]);
        addTri(hide, rings[s][i], rings[s + 1][j], rings[s + 1][i]);
      }
    }
    var tail = P(0, 0.16, -0.56);
    var nose = P(0, 0.29, 0.6);
    for (var n = 0; n < sides; n++) {
      addTri(hide, rings[0][(n + 1) % sides], rings[0][n], tail);
      addTri(hide, rings[rings.length - 1][n], rings[rings.length - 1][(n + 1) % sides], nose);
    }
    addBox(belly, origin[0], origin[1] + 0.26 * scale, origin[2] + 0.5 * scale, 0.14 * scale, 0.07 * scale, 0.12 * scale);
    addBox(hide, origin[0] - 0.28 * scale, origin[1] + 0.08 * scale, origin[2] + 0.05 * scale, 0.16 * scale, 0.03 * scale, 0.1 * scale);
    addBox(hide, origin[0] + 0.28 * scale, origin[1] + 0.08 * scale, origin[2] + 0.05 * scale, 0.16 * scale, 0.03 * scale, 0.1 * scale);
    addCone(tusk, P(-0.035, 0.22, 0.56), [-0.04, -1, 0.12], 0.016 * scale, 0.24 * scale, 5);
    addCone(tusk, P(0.035, 0.22, 0.56), [0.04, -1, 0.12], 0.016 * scale, 0.24 * scale, 5);
    addIcosahedron(eye, 0.02 * scale, 0, P(-0.07, 0.34, 0.4), 0);
    addIcosahedron(eye, 0.02 * scale, 0, P(0.07, 0.34, 0.4), 0);
  }

  function addPerson(coat, pants, skin, trim, dark, origin, scale) {
    var x = origin[0];
    var y = origin[1];
    var z = origin[2];
    function put(mesh, px, py, pz, sx, sy, sz) {
      addBox(mesh, x + px * scale, y + py * scale, z + pz * scale, sx * scale, sy * scale, sz * scale);
    }
    put(pants, -0.07, 0.16, 0, 0.09, 0.32, 0.09);
    put(pants, 0.07, 0.16, 0, 0.09, 0.32, 0.09);
    put(coat, 0, 0.46, 0, 0.24, 0.3, 0.13);
    put(coat, -0.16, 0.44, 0.02, 0.07, 0.24, 0.07);
    put(coat, 0.16, 0.44, 0.02, 0.07, 0.24, 0.07);
    addIcosahedron(skin, 0.065 * scale, 0, [x, y + 0.7 * scale, z + 0.02 * scale], 0);
  }

  function addCylinder(mesh, origin, axis, radius, length, sides) {
    var nAxis = normalize(axis.slice());
    var helper = Math.abs(nAxis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    var side = normalize(cross(helper, nAxis));
    var up = normalize(cross(nAxis, side));
    var end = [origin[0] + nAxis[0] * length, origin[1] + nAxis[1] * length, origin[2] + nAxis[2] * length];
    var r0 = [];
    var r1 = [];
    for (var i = 0; i < sides; i++) {
      var ang = (i / sides) * Math.PI * 2;
      var ox = (Math.cos(ang) * side[0] + Math.sin(ang) * up[0]) * radius;
      var oy = (Math.cos(ang) * side[1] + Math.sin(ang) * up[1]) * radius;
      var oz = (Math.cos(ang) * side[2] + Math.sin(ang) * up[2]) * radius;
      r0.push([origin[0] + ox, origin[1] + oy, origin[2] + oz]);
      r1.push([end[0] + ox, end[1] + oy, end[2] + oz]);
    }
    for (var j = 0; j < sides; j++) {
      var k = (j + 1) % sides;
      addTri(mesh, r0[j], r0[k], r1[k]);
      addTri(mesh, r0[j], r1[k], r1[j]);
      addTri(mesh, r0[j], origin, r0[k]);
      addTri(mesh, r1[k], end, r1[j]);
    }
  }

  function addPaperPlane(mesh) {
    addCone(mesh, [-0.2, 0, 0], [1, 0.05, 0], 0.1, 0.75, 4);
    addBox(mesh, -0.05, 0, 0, 0.2, 0.02, 0.78);
    addBox(mesh, -0.22, 0.1, 0, 0.16, 0.18, 0.02);
  }

  function addEnvelope(mesh) {
    addBox(mesh, 0, 0, 0, 0.9, 0.08, 0.62);
    addCone(mesh, [0, 0.05, -0.05], [0, 0.35, 1], 0.22, 0.28, 4);
  }

  function addGround(mesh, size, seg) {
    var step = size / seg;
    function pushVert(p, n) {
      mesh.positions.push(p[0], p[1], p[2]);
      mesh.normals.push(n[0], n[1], n[2]);
      mesh.uvs.push(p[0] * 0.34 + 0.5, p[2] * 0.34 + 0.5);
    }
    function tri(a, b, c) {
      var ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      var ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      var n = cross(ab, ac);
      var len = Math.hypot(n[0], n[1], n[2]) || 1;
      n = [n[0] / len, n[1] / len, n[2] / len];
      pushVert(a, n);
      pushVert(b, n);
      pushVert(c, n);
      mesh.rawFaces.push([a, b, c]);
    }
    function yAt(x, z) {
      return -0.012 + Math.sin(x * 0.85) * 0.003 + Math.cos(z * 0.7) * 0.002;
    }
    for (var iz = 0; iz < seg; iz++) {
      for (var ix = 0; ix < seg; ix++) {
        var x0 = -size / 2 + ix * step;
        var z0 = -size / 2 + iz * step;
        var x1 = x0 + step;
        var z1 = z0 + step;
        var a = [x0, yAt(x0, z0), z0];
        var b = [x1, yAt(x1, z0), z0];
        var c = [x1, yAt(x1, z1), z1];
        var d = [x0, yAt(x0, z1), z1];
        tri(a, d, c);
        tri(a, c, b);
      }
    }
  }

  function addPlane(mesh, size, seg) {
    var step = size / seg;
    for (var iz = 0; iz < seg; iz++) {
      for (var ix = 0; ix < seg; ix++) {
        var x0 = -size / 2 + ix * step;
        var z0 = -size / 2 + iz * step;
        var x1 = x0 + step;
        var z1 = z0 + step;
        var a = [x0, wave(x0, z0), z0];
        var b = [x1, wave(x1, z0), z1 - step];
        var c = [x1, wave(x1, z1), z1];
        var d = [x0, wave(x0, z1), z1];
        addTri(mesh, a, b, c);
        addTri(mesh, a, c, d);
      }
    }
  }

  function wave(x, z) {
    return Math.sin(x * 1.25) * 0.045 + Math.cos(z * 1.05) * 0.035;
  }

  function gridPoints(step, extent) {
    var pts = [];
    for (var i = -extent; i <= extent + 0.001; i += step) {
      pts.push(-extent, -0.02, i, extent, -0.02, i, i, -0.02, -extent, i, -0.02, extent);
    }
    return pts;
  }

  function edgePoints(faces, scale) {
    var pts = [];
    faces.forEach(function (f) {
      for (var i = 0; i < 3; i++) {
        var a = f[i];
        var b = f[(i + 1) % 3];
        pts.push(a[0] * scale, a[1] * scale, a[2] * scale, b[0] * scale, b[1] * scale, b[2] * scale);
      }
    });
    return pts;
  }

  function themeColors() {
    var style = getComputedStyle(document.documentElement);
    return {
      clear: parseCssColor(style.getPropertyValue("--bg"), [0.114, 0.114, 0.114]),
      minor: parseCssColor(style.getPropertyValue("--grid-minor"), [0.2, 0.2, 0.2]),
      major: parseCssColor(style.getPropertyValue("--grid-major"), [0.3, 0.3, 0.3])
    };
  }

  function parseCssColor(value, fallback) {
    value = (value || "").trim();
    if (value.charAt(0) === "#") {
      var h = value.slice(1);
      if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
      var n = parseInt(h, 16);
      if (isNaN(n)) return fallback;
      return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    }
    var match = value.match(/rgba?\(([^)]+)\)/);
    if (!match) return fallback;
    var parts = match[1].split(",");
    return [Number(parts[0]) / 255, Number(parts[1]) / 255, Number(parts[2]) / 255];
  }

  function makeStone() {
    var canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#8a7560";
    ctx.fillRect(0, 0, 512, 512);
    var image = ctx.getImageData(0, 0, 512, 512);
    for (var i = 0; i < image.data.length; i += 4) {
      var n = (hash(i) - 0.5) * 46;
      image.data[i] = clampByte(image.data[i] + n);
      image.data[i + 1] = clampByte(image.data[i + 1] + n * 0.86);
      image.data[i + 2] = clampByte(image.data[i + 2] + n * 0.62);
    }
    ctx.putImageData(image, 0, 0);
    ctx.strokeStyle = "rgba(48, 34, 24, 0.35)";
    ctx.lineWidth = 2;
    for (var c = 0; c < 18; c++) {
      ctx.beginPath();
      var x = hash(c + 3) * 512;
      var y = hash(c + 9) * 512;
      ctx.moveTo(x, y);
      ctx.lineTo(x + (hash(c + 4) - 0.5) * 180, y + 40 + hash(c + 5) * 120);
      ctx.stroke();
    }
    return canvas;
  }

  function makeWater() {
    var canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    var ctx = canvas.getContext("2d");
    var gradient = ctx.createLinearGradient(0, 0, 0, 512);
    gradient.addColorStop(0, "#8fd4df");
    gradient.addColorStop(0.45, "#1f7590");
    gradient.addColorStop(1, "#0d3f52");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    for (var i = 0; i < 70; i++) {
      ctx.beginPath();
      ctx.ellipse(hash(i + 20) * 512, hash(i + 40) * 512, 8 + hash(i) * 28, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    return canvas;
  }

  function makeSand() {
    var canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#e6c48a";
    ctx.fillRect(0, 0, 512, 512);
    var image = ctx.getImageData(0, 0, 512, 512);
    for (var i = 0; i < image.data.length; i += 4) {
      var n = (hash(i + 17) - 0.5) * 34;
      image.data[i] = clampByte(image.data[i] + n);
      image.data[i + 1] = clampByte(image.data[i + 1] + n * 0.82);
      image.data[i + 2] = clampByte(image.data[i + 2] + n * 0.42);
    }
    ctx.putImageData(image, 0, 0);
    ctx.fillStyle = "rgba(140, 96, 48, 0.28)";
    for (var s = 0; s < 220; s++) {
      ctx.fillRect(hash(s + 3) * 512, hash(s + 9) * 512, 1 + (s % 2), 1 + (s % 2));
    }
    return canvas;
  }

  function texture(gl, source) {
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return tex;
  }

  function program(gl, vertSrc, fragSrc) {
    var vert = shader(gl, gl.VERTEX_SHADER, vertSrc);
    var frag = shader(gl, gl.FRAGMENT_SHADER, fragSrc);
    if (!vert || !frag) return null;
    var prog = gl.createProgram();
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.bindAttribLocation(prog, 0, "aPos");
    gl.bindAttribLocation(prog, 1, "aNormal");
    gl.bindAttribLocation(prog, 2, "aUv");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    var locations = { program: prog };
    ["uMvp", "uModel", "uNormal", "uCam", "uBase", "uKeyDir", "uKeyColor", "uFillDir", "uFillColor", "uRough", "uOpacity", "uUseMap", "uMap", "uColor"].forEach(function (name) {
      locations[name] = gl.getUniformLocation(prog, name);
    });
    ["aPos", "aNormal", "aUv"].forEach(function (name) {
      locations[name] = gl.getAttribLocation(prog, name);
    });
    return locations;
  }

  function shader(gl, type, source) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return null;
    return sh;
  }

  function bindAttrib(gl, shaderLoc, name, size, stride, offset) {
    var loc = shaderLoc[name];
    if (loc < 0) return;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
  }

  function disableAttribs(gl) {
    [programs.lit, programs.line].forEach(function (shaderLoc) {
      ["aPos", "aNormal", "aUv"].forEach(function (name) {
        if (shaderLoc[name] >= 0) gl.disableVertexAttribArray(shaderLoc[name]);
      });
    });
  }

  var litVert = [
    "attribute vec3 aPos;",
    "attribute vec3 aNormal;",
    "attribute vec2 aUv;",
    "uniform mat4 uMvp;",
    "uniform mat4 uModel;",
    "uniform mat3 uNormal;",
    "varying vec3 vNormal;",
    "varying vec3 vWorld;",
    "varying vec2 vUv;",
    "void main(){",
    "vNormal = uNormal * aNormal;",
    "vWorld = (uModel * vec4(aPos, 1.0)).xyz;",
    "vUv = aUv;",
    "gl_Position = uMvp * vec4(aPos, 1.0);",
    "}"
  ].join("\n");

  var litFrag = [
    "precision mediump float;",
    "varying vec3 vNormal;",
    "varying vec3 vWorld;",
    "varying vec2 vUv;",
    "uniform vec3 uBase;",
    "uniform vec3 uCam;",
    "uniform vec3 uKeyDir;",
    "uniform vec3 uKeyColor;",
    "uniform vec3 uFillDir;",
    "uniform vec3 uFillColor;",
    "uniform float uRough;",
    "uniform float uOpacity;",
    "uniform float uUseMap;",
    "uniform sampler2D uMap;",
    "void main(){",
    "vec3 n = normalize(vNormal);",
    "vec3 base = uBase;",
    "if (uUseMap > 0.5) base *= texture2D(uMap, vUv).rgb;",
    "float key = max(dot(n, normalize(uKeyDir)), 0.0);",
    "float fill = max(dot(n, normalize(uFillDir)), 0.0);",
    "vec3 viewDir = normalize(uCam - vWorld);",
    "vec3 halfVec = normalize(normalize(uKeyDir) + viewDir);",
    "float specPower = mix(64.0, 8.0, uRough);",
    "float spec = pow(max(dot(n, halfVec), 0.0), specPower) * (1.0 - uRough);",
    "vec3 color = base * (0.2 + key * uKeyColor + fill * uFillColor) + spec * 0.28;",
    "gl_FragColor = vec4(color, uOpacity);",
    "}"
  ].join("\n");

  var lineVert = "attribute vec3 aPos; uniform mat4 uMvp; void main(){ gl_Position = uMvp * vec4(aPos, 1.0); }";
  var lineFrag = "precision mediump float; uniform vec3 uColor; void main(){ gl_FragColor = vec4(uColor, 1.0); }";

  function perspective(fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2);
    var nf = 1 / (near - far);
    var out = new Float32Array(16);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) * nf;
    out[11] = -1;
    out[14] = 2 * far * near * nf;
    return out;
  }

  function lookAt(eye, center, up) {
    var z = normalize([eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]]);
    var x = normalize(cross(up, z));
    var y = cross(z, x);
    var out = new Float32Array(16);
    out[0] = x[0]; out[1] = y[0]; out[2] = z[0];
    out[4] = x[1]; out[5] = y[1]; out[6] = z[1];
    out[8] = x[2]; out[9] = y[2]; out[10] = z[2];
    out[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
    out[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
    out[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
    out[15] = 1;
    return out;
  }

  function yawMatrix(angle) {
    var c = Math.cos(angle);
    var s = Math.sin(angle);
    return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
  }

  function normalOf(model) {
    return new Float32Array([
      model[0], model[1], model[2],
      model[4], model[5], model[6],
      model[8], model[9], model[10]
    ]);
  }

  function multiply(a, b) {
    var out = new Float32Array(16);
    for (var c = 0; c < 4; c++) {
      for (var r = 0; r < 4; r++) {
        out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return out;
  }

  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }

  function normalize(v) {
    var len = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / len, v[1] / len, v[2] / len];
  }

  function hex(value) {
    return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
  }

  function hash(n) {
    var x = Math.sin(n * 127.1) * 43758.5453;
    return x - Math.floor(x);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function clampByte(value) {
    return Math.max(0, Math.min(255, value));
  }

  shared = document.createElement("canvas");
  shared.setAttribute("aria-hidden", "true");
  shared.style.cssText = "position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0.02;pointer-events:none;z-index:-1";
  document.body.appendChild(shared);
  gl = shared.getContext("webgl", {
    antialias: true,
    alpha: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true
  });
  if (!gl) return;
  programs = {
    lit: program(gl, litVert, litFrag),
    line: program(gl, lineVert, lineFrag)
  };
  if (!programs.lit || !programs.line) return;
  maps = {
    stone: texture(gl, stoneCanvas),
    water: texture(gl, waterCanvas),
    sand: texture(gl, sandCanvas)
  };

  var views = [];
  canvases.forEach(function (canvas) {
    var view = createView(canvas);
    if (view) views.push(view);
  });
  if (!views.length) return;

  new MutationObserver(function () {
    views.forEach(function (view) {
      view.colors = themeColors();
    });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    views.forEach(function (view) {
      if (!view.paused && !reduced) view.time += dt;
      if (!view.visible) return;
      resize(view);
      draw(view);
    });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
