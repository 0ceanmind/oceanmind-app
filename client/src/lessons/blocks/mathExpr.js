/**
 * Tiny safe math-expression evaluator for the Simulator block.
 * Supports: numbers (incl. .5 and 1e-3), variables, + - * / ^, parentheses,
 * and a whitelist of functions. No eval, no Function — a real
 * recursive-descent parser over a strict tokenizer (any character it doesn't
 * recognise is an error, never silently skipped).
 */

const FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp,
  log: (x) => Math.log(Math.max(1e-12, x)), sqrt: (x) => Math.sqrt(Math.max(0, x)),
  abs: Math.abs, tanh: Math.tanh, sigmoid: (x) => 1 / (1 + Math.exp(-x)),
  relu: (x) => Math.max(0, x), max: Math.max, min: Math.min, sign: Math.sign,
};
const CONSTS = { pi: Math.PI, e: Math.E };

export const EXPR_RE = /^[\w\s+\-*/^(),.]+$/;

// number: 12 | 12. | 12.5 | .5, each with an optional exponent (1e-3, 2.5E+4)
const TOKEN_RE = /\s*(?:((?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)|([A-Za-z_]\w*)|([+\-*/^(),]))/y;

function tokenize(src) {
  const tokens = [];
  TOKEN_RE.lastIndex = 0;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    TOKEN_RE.lastIndex = pos;
    const m = TOKEN_RE.exec(src);
    if (!m) throw new Error(`unexpected character "${src.slice(pos).trim()[0]}"`);
    tokens.push(m[1] ?? m[2] ?? m[3]);
    pos = TOKEN_RE.lastIndex;
  }
  return tokens;
}

export function compileExpr(src) {
  if (typeof src !== 'string' || src.length > 300 || !EXPR_RE.test(src)) {
    throw new Error('invalid expression');
  }
  const tokens = tokenize(src);
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
    let left = parseUnary();
    while (peek() === '*' || peek() === '/') {
      const op = next();
      const right = parseUnary();
      const l = left, r = right;
      left = (v) => (op === '*' ? l(v) * r(v) : l(v) / (r(v) || 1e-12));
    }
    return left;
  }
  // Unary minus binds looser than ^, as in maths: -x^2 = -(x^2), so a
  // Gaussian exp(-x^2) is a bump, not exp(x^2). 2^-x still works.
  function parseUnary() {
    if (peek() === '-') { next(); const inner = parseUnary(); return (v) => -inner(v); }
    if (peek() === '+') { next(); return parseUnary(); }
    return parsePower();
  }
  function parsePower() {
    const base = parseAtom();
    if (peek() === '^') {
      next();
      const exp = parseUnary(); // right-assoc: 2^3^2 = 2^9
      return (v) => Math.pow(base(v), exp(v));
    }
    return base;
  }
  function parseAtom() {
    const t = next();
    if (t === undefined) throw new Error('unexpected end of expression');
    if (/^[\d.]/.test(t)) {
      const n = Number(t);
      if (!Number.isFinite(n)) throw new Error(`bad number ${t}`);
      return () => n;
    }
    if (t === '(') {
      const inner = parseExpr();
      if (next() !== ')') throw new Error('missing )');
      return inner;
    }
    if (/^[A-Za-z_]/.test(t)) {
      if (peek() === '(') {
        const fn = Object.prototype.hasOwnProperty.call(FUNCS, t) ? FUNCS[t] : null;
        if (!fn) throw new Error(`unknown function ${t}`);
        next(); // (
        const args = [parseExpr()];
        while (peek() === ',') { next(); args.push(parseExpr()); }
        if (next() !== ')') throw new Error('missing )');
        return (v) => fn(...args.map((a) => a(v)));
      }
      // A slider variable the author named 'e' or 'pi' wins over the constant.
      const constant = Object.prototype.hasOwnProperty.call(CONSTS, t) ? CONSTS[t] : undefined;
      return (v) => {
        const val = Object.prototype.hasOwnProperty.call(v, t) ? v[t] : undefined;
        if (Number.isFinite(val)) return val;
        return constant ?? 0;
      };
    }
    throw new Error(`unexpected token ${t}`);
  }

  const fn = parseExpr();
  if (pos !== tokens.length) throw new Error('trailing tokens');
  fn({}); // smoke-run
  return fn;
}
