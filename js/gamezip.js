/*
 * gamezip.js —— 浏览器里直接读 RimWorld 的 Assets.zip，并解码里面的贴图
 *
 * 为什么需要它：
 *   新版 RimWorld 的贴图打包在 <游戏目录>/Assets.zip（各 DLC 还有自己的
 *   Data/<DLC>/Assets.zip），zip 里的贴图是 BC7/BC4 压缩的 DDS，
 *   而且整个包用 zstd 压缩（zip method 93）。
 *   浏览器既不认 DDS，DecompressionStream 也还不支持 zstd，所以：
 *     · zstd  → 内置的 fzstd（js/vendor/fzstd.js，MIT）
 *     · BC7   → WebGL2 的 EXT_texture_compression_bptc（把压缩数据当纹理上传再读回来）
 *     · BC4   → 纯 JS（每 4×4 块 8 字节，很简单）
 *     · RGBA8 → 直接拷贝
 *
 * 只读需要的那几个条目：先读 zip 尾部的中央目录，再按需 slice，
 * 所以 359 MB 的包实际只读几 MB。
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------- 基础

  var SIG_EOCD = 0x06054b50, SIG_CD = 0x02014b50, SIG_LOCAL = 0x04034b50;

  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

  /** 从文件尾部找中央目录结束记录（EOCD），支持 zip64 的定位符 */
  async function readEOCD(file) {
    var tailLen = Math.min(file.size, 66000);
    var start = file.size - tailLen;
    var buf = new Uint8Array(await file.slice(start).arrayBuffer());
    for (var i = buf.length - 22; i >= 0; i--) {
      if (u32(buf, i) === SIG_EOCD) {
        var count = u16(buf, i + 10);
        var cdSize = u32(buf, i + 12);
        var cdOff = u32(buf, i + 16);
        if (cdOff === 0xffffffff || count === 0xffff || cdSize === 0xffffffff) {
          throw new Error('这个 zip 用了 zip64，暂时不支持（请用 tools/extract_textures.py）');
        }
        return { count: count, size: cdSize, offset: cdOff };
      }
    }
    throw new Error('不是有效的 zip 文件（找不到中央目录）');
  }

  /** 解析中央目录，返回 Map(名字 -> 条目) */
  async function readCentralDirectory(file, eocd) {
    var buf = new Uint8Array(await file.slice(eocd.offset, eocd.offset + eocd.size).arrayBuffer());
    var entries = new Map();
    var p = 0;
    while (p + 46 <= buf.length && u32(buf, p) === SIG_CD) {
      var method = u16(buf, p + 10);
      var csize = u32(buf, p + 20);
      var usize = u32(buf, p + 24);
      var nlen = u16(buf, p + 28);
      var elen = u16(buf, p + 30);
      var clen = u16(buf, p + 32);
      var off = u32(buf, p + 42);
      var name = new TextDecoder('utf-8').decode(buf.subarray(p + 46, p + 46 + nlen));
      entries.set(name, { name: name, method: method, csize: csize, usize: usize, offset: off });
      p += 46 + nlen + elen + clen;
    }
    return entries;
  }

  /** 解压一个条目（需要时解 zstd / deflate） */
  async function readEntry(file, entry) {
    var head = new Uint8Array(await file.slice(entry.offset, entry.offset + 30).arrayBuffer());
    if (u32(head, 0) !== SIG_LOCAL) throw new Error('zip 条目头损坏：' + entry.name);
    var nlen = u16(head, 26), elen = u16(head, 28);
    var dataStart = entry.offset + 30 + nlen + elen;
    var comp = new Uint8Array(await file.slice(dataStart, dataStart + entry.csize).arrayBuffer());
    if (entry.method === 0) return comp;
    if (entry.method === 93) {                       // zstd
      var fz = global.fzstd;
      if (!fz) throw new Error('缺少 zstd 解码器（js/vendor/fzstd.js）');
      return fz.decompress(comp);
    }
    if (entry.method === 8) {                        // deflate
      if (typeof DecompressionStream !== 'function') throw new Error('浏览器不支持解压 deflate');
      var ds = new DecompressionStream('deflate-raw');
      var out = await new Response(new Blob([comp]).stream().pipeThrough(ds)).arrayBuffer();
      return new Uint8Array(out);
    }
    throw new Error('不支持的压缩方式 ' + entry.method + '：' + entry.name);
  }

  /** 打开一个 zip（File / Blob），返回带缓存的读取器 */
  async function openZip(file) {
    var eocd = await readEOCD(file);
    var entries = await readCentralDirectory(file, eocd);
    var names = Array.from(entries.keys());
    return {
      file: file,
      entries: entries,
      names: names,
      /** 前缀查找：Things/Building/... 会匹配到 .psd.dds / _north 等所有变体 */
      find: function (prefix) {
        var p = prefix.replace(/\\/g, '/').replace(/^\/+/, '');
        var out = [];
        for (var i = 0; i < names.length; i++) {
          var n = names[i];
          if (!n.startsWith(p)) continue;
          if (n.length > p.length && '._/'.indexOf(n[p.length]) < 0) continue;
          out.push(n);
        }
        return out;
      },
      has: function (name) { return entries.has(name); },
      read: function (name) {
        var e = entries.get(name);
        if (!e) return Promise.reject(new Error('zip 里没有 ' + name));
        return readEntry(file, e);
      }
    };
  }

  // ---------------------------------------------------------------- BC7（走 GPU）

  function createBptcDecoder() {
    if (typeof document === 'undefined') return null;
    var cv = document.createElement('canvas');
    var gl = cv.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: false, depth: false });
    if (!gl) return null;
    var ext = gl.getExtension('EXT_texture_compression_bptc');
    if (!ext) return null;

    function sh(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
      return s;
    }
    var prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER,
      'attribute vec2 p; varying vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }'));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER,
      'precision highp float; varying vec2 uv; uniform sampler2D t; void main(){ gl_FragColor = texture2D(t, uv); }'));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('program: ' + gl.getProgramInfoLog(prog));
    gl.useProgram(prog);

    var quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var uni = gl.getUniformLocation(prog, 't');
    gl.uniform1i(uni, 0);

    var src = gl.createTexture(), dst = gl.createTexture(), fbo = gl.createFramebuffer();
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    return function (data, w, h) {
      gl.bindTexture(gl.TEXTURE_2D, src);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.compressedTexImage2D(gl.TEXTURE_2D, 0, ext.COMPRESSED_RGBA_BPTC_UNORM_EXT, w, h, 0, data);

      gl.bindTexture(gl.TEXTURE_2D, dst);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('WebGL 帧缓冲不完整（贴图 ' + w + 'x' + h + '）');
      }
      gl.viewport(0, 0, w, h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, src);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      var err = gl.getError();
      if (err) throw new Error('WebGL 解码出错（' + w + 'x' + h + '，错误码 ' + err + '）');

      var px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      // 注意：纹理数据的第 0 行在 GL 里是 v=0（贴图底部），全屏四边形把它画到了
      // 帧缓冲底部，而 readPixels 又是自下而上读的 —— 两者正好抵消，
      // 拿到的就已经是「自上而下」的图像，不需要再翻。
      return new Uint8ClampedArray(px.buffer, px.byteOffset, px.byteLength);
    };
  }

  // ---------------------------------------------------------------- BC4（纯 JS）

  /** BC4/BC5 的单通道块解码：2 个端点 + 16 个 3 位索引 */
  function bc4Block(u8, p, out, outOff, stride, w, h, bx, by) {
    var e0 = u8[p], e1 = u8[p + 1];
    var c = new Uint8Array(8);
    c[0] = e0; c[1] = e1;
    if (e0 > e1) {
      for (var i = 1; i <= 6; i++) c[1 + i] = ((e0 * (7 - i) + e1 * i + 3) / 7) | 0;
    } else {
      for (var j = 1; j <= 4; j++) c[1 + j] = ((e0 * (5 - j) + e1 * j + 2) / 5) | 0;
      c[6] = 0; c[7] = 255;
    }
    // 6 字节的 3 位索引，拼成 48 位整数（用乘法而不是 <<，避免 << 24 溢出成负数）
    var bits = u8[p + 2] + u8[p + 3] * 0x100 + u8[p + 4] * 0x10000 +
               u8[p + 5] * 0x1000000 + u8[p + 6] * 0x100000000 + u8[p + 7] * 0x10000000000;
    for (var t = 0; t < 16; t++) {
      var idx = Math.floor(bits / Math.pow(2, t * 3)) % 8;
      var x = bx * 4 + (t % 4), y = by * 4 + ((t / 4) | 0);
      if (x >= w || y >= h) continue;
      out[outOff + (y * stride + x) * 4] = c[idx];
    }
  }

  function decodeBC4(u8, w, h, off, secondChannel) {
    var out = new Uint8ClampedArray(w * h * 4);
    // 先铺满 alpha=255
    for (var i = 3; i < out.length; i += 4) out[i] = 255;
    var bw = Math.ceil(w / 4), bh = Math.ceil(h / 4);
    var p = off;
    for (var by = 0; by < bh; by++) {
      for (var bx = 0; bx < bw; bx++) {
        if (secondChannel) {
          bc4Block(u8, p, out, 1, w, w, h, bx, by);       // G 通道（BC5）
          bc4Block(u8, p + 8, out, 0, w, w, h, bx, by);   // R 通道
          // 把 R 的 alpha 关掉：bc4Block 只写 RGB 的对应字节
        } else {
          bc4Block(u8, p, out, 0, w, w, h, bx, by);
          // 灰度：R=G=B
          for (var t = 0; t < 16; t++) {
            var x = bx * 4 + (t % 4), y = by * 4 + ((t / 4) | 0);
            if (x >= w || y >= h) continue;
            var o = (y * w + x) * 4;
            out[o + 1] = out[o + 2] = out[o];
          }
        }
        p += secondChannel ? 16 : 8;
      }
    }
    if (secondChannel) {
      for (var k = 0; k < w * h; k++) out[k * 4 + 2] = 255;   // B 通道给满
    }
    return out;
  }

  // ---------------------------------------------------------------- DDS

  var DXGI = {
    28: 'RGBA8', 10: 'RGBA16F', 71: 'BC1', 72: 'BC1', 74: 'BC2', 75: 'BC2',
    77: 'BC3', 78: 'BC3', 80: 'BC4', 83: 'BC5', 95: 'BC6H', 98: 'BC7', 99: 'BC7',
    87: 'BGRA8'
  };

  function parseDds(u8) {
    if (u8[0] !== 0x44 || u8[1] !== 0x44 || u8[2] !== 0x53 || u8[3] !== 0x20) {
      throw new Error('不是 DDS 文件');
    }
    var height = u32(u8, 12), width = u32(u8, 16);
    var fourcc = String.fromCharCode(u8[84], u8[85], u8[86], u8[87]);
    var fmt, dataOff = 128;
    if (fourcc === 'DX10') {
      fmt = DXGI[u32(u8, 128)] || ('DXGI' + u32(u8, 128));
      dataOff = 148;
    } else {
      fmt = fourcc;
    }
    return { width: width, height: height, fourcc: fourcc, format: fmt, dataOff: dataOff };
  }

  var bptc = null, bptcTried = false;

  /** 把一张 DDS 解成 {width, height, rgba} */
  function decodeDds(u8) {
    var hd = parseDds(u8);
    var w = hd.width, h = hd.height, off = hd.dataOff;
    if (hd.format === 'BC7') {
      if (!bptcTried) { bptcTried = true; bptc = createBptcDecoder(); }
      if (!bptc) throw new Error('这个浏览器/显卡不支持 BC7 解码（WebGL2 的 EXT_texture_compression_bptc）');
      // 注意：必须只传第 0 级的字节。带 mipmap 的贴图后面还跟着其它级，
      // 多传字节会让 compressedTexImage2D 直接失败（纹理变成垃圾数据）。
      var b7 = Math.ceil(w / 4) * Math.ceil(h / 4) * 16;
      return { width: w, height: h, rgba: bptc(u8.subarray(off, off + b7), w, h) };
    }
    if (hd.format === 'BC4') return { width: w, height: h, rgba: decodeBC4(u8, w, h, off, false) };
    if (hd.format === 'BC5') return { width: w, height: h, rgba: decodeBC4(u8, w, h, off, true) };
    if (hd.format === 'RGBA8') {
      var out = new Uint8ClampedArray(w * h * 4);
      out.set(u8.subarray(off, off + w * h * 4));
      return { width: w, height: h, rgba: out };
    }
    if (hd.format === 'BGRA8') {
      var o2 = new Uint8ClampedArray(w * h * 4);
      o2.set(u8.subarray(off, off + w * h * 4));
      for (var i = 0; i < o2.length; i += 4) { var t = o2[i]; o2[i] = o2[i + 2]; o2[i + 2] = t; }
      return { width: w, height: h, rgba: o2 };
    }
    throw new Error('暂不支持的贴图格式：' + hd.format);
  }

  /** 能力探测：给界面提示用 */
  function capabilities() {
    if (!bptcTried) { bptcTried = true; bptc = createBptcDecoder(); }
    return {
      bptc: !!bptc,
      zstd: !!global.fzstd,
      fileApi: typeof File !== 'undefined' && !!File.prototype.slice,
      indexedDB: (function () { try { return !!global.indexedDB; } catch (e) { return false; } })()
    };
  }

  global.RWZip = {
    openZip: openZip,
    readEntry: readEntry,
    parseDds: parseDds,
    decodeDds: decodeDds,
    capabilities: capabilities
  };
})(typeof window !== 'undefined' ? window : globalThis);
