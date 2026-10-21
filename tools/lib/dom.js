'use strict';
/*
 * tools/lib/dom.js —— 极简 XML DOM
 *
 * js/io.js 读 .rws 时用的是浏览器自带 DOMParser。命令行里没有，所以这里实现
 * 「io.js 实际用到的那一小撮 API」：
 *   tagName / nodeType / children / textContent / getAttribute
 *   getElementsByTagName / querySelector / querySelectorAll
 *
 * 支持的 CSS 选择器只有存档解析里出现的那几种：
 *   'tag'      'a > b'      'a b'
 * 不支持类 / id / 属性 / 伪类 —— 用到了再补，不要假装通用。
 *
 * 设计取舍：
 *   - 解析是迭代式（显式栈），不递归，16 MB 存档不会爆栈。
 *   - 只保留元素节点；文本累积在 _text 里，textContent 拼起来和 DOM 一致。
 *   - 实体解码只对含 '&' 的片段执行，base64 网格不受影响。
 */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, function (m, e) {
    if (e.charAt(0) === '#') {
      const hex = e.charAt(1) === 'x' || e.charAt(1) === 'X';
      const cp = parseInt(hex ? e.slice(2) : e.slice(1), hex ? 16 : 10);
      if (Number.isFinite(cp) && cp >= 0 && cp <= 0x10FFFF) {
        try { return String.fromCodePoint(cp); } catch (_) { return m; }
      }
      return m;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, e) ? ENTITIES[e] : m;
  });
}

class XmlNode {
  constructor(tagName, attributes, parent) {
    this.tagName = tagName;
    this.nodeName = tagName;
    this.nodeType = 1;
    this.attributes = attributes || {};
    this.children = [];
    this.parentNode = parent || null;
    this._text = '';
  }

  get textContent() {
    let out = this._text;
    for (let i = 0; i < this.children.length; i++) out += this.children[i].textContent;
    return out;
  }

  set textContent(v) {
    this._text = v == null ? '' : String(v);
    this.children.length = 0;
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }

  /** 后代（不含自身），文档顺序 */
  getElementsByTagName(tag) {
    const out = [];
    const all = tag === '*';
    const walk = (n) => {
      for (let i = 0; i < n.children.length; i++) {
        const c = n.children[i];
        if (all || c.tagName === tag) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }

  querySelector(sel) {
    const r = this.querySelectorAll(sel);
    return r.length ? r[0] : null;
  }

  /**
   * 只支持 'tag'、'a > b'、'a b'（后代）。
   * 返回文档顺序的结果。
   */
  querySelectorAll(sel) {
    const steps = String(sel).trim().split(/\s+/);
    // 把 'a>b' 拆成 ['a','>','b']
    const tokens = [];
    for (const s of steps) {
      const parts = s.split('>');
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) tokens.push('>');
        if (parts[i]) tokens.push(parts[i]);
      }
    }
    if (!tokens.length) return [];

    let current = [this];
    let direct = false;
    for (const tok of tokens) {
      if (tok === '>') { direct = true; continue; }
      const next = [];
      for (const node of current) {
        if (direct) {
          for (let i = 0; i < node.children.length; i++) {
            if (node.children[i].tagName === tok) next.push(node.children[i]);
          }
        } else {
          const found = node.getElementsByTagName(tok);
          for (const f of found) next.push(f);
        }
      }
      current = next;
      direct = false;
    }
    return current;
  }
}

/** 解析 XML 文本，返回一个 #document 根节点（documentElement 指向第一个元素）。 */
function parseXml(text) {
  const doc = new XmlNode('#document', {}, null);
  doc.nodeType = 9;
  const stack = [doc];
  let i = 0;
  const len = text.length;

  const pushText = (s) => {
    if (!s) return;
    stack[stack.length - 1]._text += decodeEntities(s);
  };

  while (i < len) {
    const lt = text.indexOf('<', i);
    if (lt < 0) { pushText(text.slice(i)); break; }
    if (lt > i) pushText(text.slice(i, lt));

    // 注释 / CDATA / 声明 / DOCTYPE
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      i = end < 0 ? len : end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      pushText(text.slice(lt + 9, end < 0 ? len : end));
      i = end < 0 ? len : end + 3;
      continue;
    }
    if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt + 2);
      i = end < 0 ? len : end + 2;
      continue;
    }
    if (text.startsWith('<!', lt)) {
      const end = text.indexOf('>', lt + 2);
      i = end < 0 ? len : end + 1;
      continue;
    }

    const gt = text.indexOf('>', lt);
    if (gt < 0) { pushText(text.slice(lt)); break; }
    let inner = text.slice(lt + 1, gt);
    let close = false;
    if (inner.charAt(0) === '/') { close = true; inner = inner.slice(1); }
    let selfClose = false;
    if (!close && inner.charAt(inner.length - 1) === '/') { selfClose = true; inner = inner.slice(0, -1); }

    const m = /^([^\s/>]+)/.exec(inner);
    const tag = m ? m[1] : '';

    if (close) {
      // 容错：一直弹到同名节点
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].tagName === tag) { stack.length = k; break; }
      }
      i = gt + 1;
      continue;
    }

    const attrs = {};
    const rest = inner.slice(tag.length);
    const re = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let am;
    while ((am = re.exec(rest))) {
      attrs[am[1]] = decodeEntities(am[2] !== undefined ? am[2] : am[3]);
    }

    const node = new XmlNode(tag, attrs, stack[stack.length - 1]);
    stack[stack.length - 1].children.push(node);
    if (doc.documentElement == null) doc.documentElement = node;
    if (!selfClose) stack.push(node);
    i = gt + 1;
  }

  if (!doc.documentElement) throw new Error('XML 里没有根元素');
  return doc;
}

function DOMParser() {}
DOMParser.prototype.parseFromString = function (text) {
  try {
    return parseXml(text);
  } catch (e) {
    const bad = new XmlNode('parsererror', {}, null);
    bad._text = String(e && e.message || e);
    return bad;
  }
};

module.exports = { parseXml, DOMParser, XmlNode, decodeEntities };
