/**
 * Tiny safe math-expression evaluator for the Simulator block.
 * Supports: numbers, variables, + - * / ^, parentheses, and a whitelist of
 * functions. No eval, no Function — a real recursive-descent parser.
 */

const FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp,
  log: (x) => Math.log(Math.max(1e-12, x)), sqrt: (x) => Math.sqrt(Math.max(0, x)),
  abs: Math.abs, tanh: Math.tanh, sigmoid: (x) => 1 / (1 + Math.exp(-x)),
  relu: (x) => Math.max(0, x), max: Math.max, min: Math.min, sign: Math.sign,
};

export const EXPR_RE = /^[\w\s+\-*/^(),.]+$/;

export function compileExpr(src) {
  if (typeof src !== 'string' || src.length > 300 || !EXPR_RE.test(src)) {
    throw new Error('invalid expression');
  }
  const tokens = src.match(/\d+\.?\d*|[A-Za-z_]\w*|[+\-*/^(),]/g) ?? [];
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpr() {
    let left = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = next();
      const right = parseTerm();
      const l = left, r = right;
      left = (v) => (op === '+' ? l(v) + r(v) : l(v) - r(v));
    }
    return left;
  }
  function parseTerm() {
    let left = parseFactor();
    while (peek() === '*' || peek() === '/') {
      const op = next();
      const right = parseFactor();
      const l = left, r = right;
      left = (v) => (op === '*' ? l(v) * r(v) : l(v) / (r(v) || 1e-12));
    }
    return left;
  }
  function parseFactor() {
    let base = parseUnary();
    if (peek() === '^') {
      next();
      const exp = parseFactor(); // right-assoc
      const b = base;
      return (v) => Math.pow(b(v), exp(v));
    }
    return base;
  }
  function parseUnary() {
    if (peek() === '-') { next(); const inner = parseUnary(); return (v) => -inner(v); }
    if (peek() === '+') { next(); return parseUnary(); }
    return parseAtom();
  }
  function parseAtom() {
    const t = next();
    if (t === undefined) throw new Error('unexpected end of expression');
    if (/^\d/.test(t)) { const n = Number(t); return () => n; }
    if (t === '(') {
      const inner = parseExpr();
      if (next() !== ')') throw new Error('missing )');
      return inner;
    }
    if (/^[A-Za-z_]/.test(t)) {
      if (peek() === '(') {
        const fn = FUNCS[t];
        if (!fn) throw new Error(`unknown function ${t}`);
        next(); // (
        const args = [parseExpr()];
        while (peek() === ',') { next(); args.push(parseExpr()); }
        if (next() !== ')') throw new Error('missing )');
        return (v) => fn(...args.map((a) => a(v)));
      }
      if (t === 'pi') return () => Math.PI;
      if (t === 'e') return () => Math.E;
      return (v) => {
        const val = v[t];
        return Number.isFinite(val) ? val : 0;
      };
    }
    throw new Error(`unexpected token ${t}`);
  }

  const fn = parseExpr();
  if (pos !== tokens.length) throw new Error('trailing tokens');
  fn({}); // smoke-run
  return fn;
}
