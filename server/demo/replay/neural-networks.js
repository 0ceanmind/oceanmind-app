/**
 * Replay corpus for Neural Networks (pitch demo only). Pure and deterministic:
 * the learner's zone, goal and missed concepts shape the text; every number
 * quoted here is the real value the blocks compute (the 2-3-1 network in the
 * forward-pass and backprop blocks, the neuron's starting sliders, the chain
 * rule graph), so what the learner reads matches what the block shows.
 */
import agents from './ai-agents.js';
import chatbots from './chatbots.js';

/* ------------------------------------------------ small text helpers */

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const clip = (s, n) => {
  const t = clean(s);
  return t.length <= n ? t : `${t.slice(0, n - 1).replace(/[\s,;:.—-]+\S*$/, '')}…`;
};
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const list = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const stripEnd = (s) => clean(s).replace(/[.!?…\s]+$/, '');
const quoteGoal = (goal) => stripEnd(clip(goal, 150));

/* ------------------------------------------------ knowledge map + placement */

const CONCEPTS = {
  neuron: 'Neurons, weights & bias',
  activation: 'Activation functions',
  forward: 'Forward pass',
  loss: 'Loss functions',
  gd: 'Gradient descent',
  backprop: 'Backpropagation',
  lr: 'Learning rate',
  vanishing: 'Vanishing gradients',
};

const LABEL = {
  neuron: 'neurons, weights & bias',
  activation: 'activation functions',
  forward: 'the forward pass',
  loss: 'loss functions',
  gd: 'gradient descent',
  backprop: 'backpropagation',
  lr: 'the learning rate',
  vanishing: 'vanishing gradients',
};

const TEACH = {
  neuron: 'a neuron multiplies each input by a weight, adds a bias and passes the sum through an activation',
  activation: 'activations bend the signal; without them any stack of layers collapses into one straight-line model',
  forward: 'a forward pass is arithmetic from left to right: weighted sums, then activations, layer by layer',
  loss: 'the loss is one number for how wrong the predictions are, and training exists to push it down',
  gd: 'gradient descent nudges every weight a small step downhill on the loss',
  backprop: 'backprop uses the chain rule to work out how much each weight contributed to the error',
  lr: 'the learning rate is the step size: too small and training crawls, too large and it overshoots or diverges',
  vanishing: 'in deep sigmoid or tanh stacks, gradients shrink layer by layer, so the early layers barely learn',
};

/** A concrete one-liner for the step that teaches a missed concept (the intro holds the definition). */
const STEP_TEACH = {
  neuron: 'Every weight says how much one input matters; the bias sets how easily the neuron fires.',
  activation: 'Watch where each curve goes flat: flat means almost no learning signal.',
  forward: 'Nothing mysterious happens here: multiply, add, squash, layer after layer.',
  loss: 'The loss is the one number every part of training exists to push down.',
  gd: 'The ball only ever feels the slope under it, never the whole landscape.',
  backprop: 'Follow the blame backwards: each weight’s share is the error arriving at its neuron times the input it saw.',
  lr: 'Too small and the ball crawls; too big and it jumps right over the valley.',
  vanishing: 'Each layer multiplies the gradient by its slope, so small slopes compound fast.',
};

const knowledgeMap = {
  mustKnow: [
    { name: CONCEPTS.neuron, desc: 'A neuron multiplies each input by a weight, adds a bias, then passes the sum through an activation.' },
    { name: CONCEPTS.activation, desc: 'Non-linear squashes such as ReLU, tanh and sigmoid that let stacked layers bend decision boundaries.' },
    { name: CONCEPTS.forward, desc: 'Data flows layer by layer, each computing weighted sums and activations, to produce a prediction.' },
    { name: CONCEPTS.loss, desc: 'One number scoring how wrong the predictions are, such as mean squared error or cross-entropy.' },
  ],
  needToKnow: [
    { name: CONCEPTS.gd, desc: 'Repeatedly nudging every weight a small step downhill on the loss, scaled by the learning rate.' },
    { name: CONCEPTS.backprop, desc: 'The chain rule run backwards through the network to find how much each weight caused the error.' },
    { name: CONCEPTS.lr, desc: 'The size of each update step: too small and training crawls, too large and it overshoots or diverges.' },
    { name: CONCEPTS.vanishing, desc: 'In deep sigmoid or tanh stacks, gradients shrink layer by layer, so early layers barely learn.' },
  ],
};

// Easy → hard. The pitch plan answers 3 of 6 correctly (50% → Twilight).
const questions = [
  {
    text: 'What does a single artificial neuron compute before its activation?',
    concept: CONCEPTS.neuron,
    options: ['The average of all its inputs', 'A weighted sum of its inputs plus a bias', 'The largest of its inputs', 'A random guess refined later'],
    correctIndex: 1,
    explanation: 'Each input is multiplied by its weight, the products are summed and a bias is added: z = w·x + b. The activation is applied to z.',
  },
  {
    text: 'Why do neural networks need non-linear activation functions?',
    concept: CONCEPTS.activation,
    options: ['Without them, stacked layers collapse into one linear map', 'They make each layer run faster', 'They scale the inputs into the range 0–1', 'They store what the network has learned'],
    correctIndex: 0,
    explanation: 'A linear function of a linear function is still linear. Non-linear activations are what let depth model curves and complex boundaries.',
  },
  {
    text: 'In a forward pass, what does each hidden layer pass to the next layer?',
    concept: CONCEPTS.forward,
    options: ['Its weight matrix', 'The loss value so far', 'Its activations: weighted sums put through a non-linearity', 'The gradient of the loss'],
    correctIndex: 2,
    explanation: 'Each layer computes weighted sums of its inputs, applies the activation, and hands those activations forward as the next layer’s inputs.',
  },
  {
    text: 'For a yes/no classifier with a sigmoid output, which loss is the standard choice?',
    concept: CONCEPTS.loss,
    options: ['Mean absolute error', 'Accuracy', 'Number of misclassified points', 'Binary cross-entropy'],
    correctIndex: 3,
    explanation: 'Cross-entropy punishes confident wrong answers hard and, with a sigmoid, gives the clean gradient ŷ − y. Accuracy is not differentiable, so it can’t be trained on directly.',
  },
  {
    text: 'Training loss jumps up and down and keeps growing. What is the most likely cause?',
    concept: CONCEPTS.lr,
    options: ['Too few training epochs', 'The learning rate is too high', 'The dataset is too small', 'The biases start at zero'],
    correctIndex: 1,
    explanation: 'Steps that are too large overshoot the valley floor, so each update lands higher up the other side and the loss oscillates or diverges.',
  },
  {
    text: 'During backprop, what determines a hidden neuron’s error signal?',
    concept: CONCEPTS.backprop,
    options: ['Only the values of its inputs', 'Downstream errors × outgoing weights × its activation slope', 'The final accuracy of the whole network', 'An equal share of the total loss'],
    correctIndex: 1,
    explanation: 'By the chain rule, a hidden neuron’s δ is the error arriving from the next layer, weighted by its outgoing weights, times the slope of its own activation.',
  },
];

/* ------------------------------------------------ learner context */

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');

function conceptKey(name) {
  const n = norm(name);
  for (const [k, v] of Object.entries(CONCEPTS)) if (norm(v) === n) return k;
  if (/vanish|explod/.test(n)) return 'vanishing';
  if (/backprop|chainrule|credit/.test(n)) return 'backprop';
  if (/learningrate|stepsize/.test(n)) return 'lr';
  if (/gradient|descent|optimi/.test(n)) return 'gd';
  if (/loss|cost|objective|error/.test(n)) return 'loss';
  if (/activ|sigmoid|relu|tanh/.test(n)) return 'activation';
  if (/forward|layer|feed/.test(n)) return 'forward';
  if (/neuron|weight|bias|perceptron/.test(n)) return 'neuron';
  return null;
}

function feedbackChange(previousFeedback) {
  const f = String(previousFeedback ?? '');
  const fixes = [];
  if (/Too easy/.test(f)) fixes.push('it skips the basics and goes deeper');
  if (/Too hard/.test(f)) fixes.push('it slows down and builds intuition before maths');
  if (/Repetitive/.test(f)) fixes.push('it uses fresh hands-on blocks instead of repeating ideas');
  if (/Wrong topic/.test(f)) fixes.push('it sticks closely to what you asked for');
  if (/helpful/.test(f)) fixes.push('every step now ends in something you do, not just read');
  return fixes.length ? fixes.join(', and ') : 'it is rebuilt from scratch around what you told us';
}

/** 'Twilight Zone', 'twilight' or 'Intermediate' → 'twilight' (defaults to twilight). */
const zoneOf = (z) => {
  const s = String(z ?? '').toLowerCase();
  if (/sunlight|beginner/.test(s)) return 'sunlight';
  if (/midnight|advanced/.test(s)) return 'midnight';
  return 'twilight';
};

function makeCtx(ctx = {}) {
  const zone = zoneOf(ctx.zone);
  const goal = clean(ctx.goal) || null;
  const noIdea = new Set((ctx.noIdea ?? []).map(conceptKey).filter(Boolean));
  const missed = [...new Set([...noIdea, ...(ctx.missed ?? []).map(conceptKey).filter(Boolean)])];
  const g = String(goal ?? '').toLowerCase();
  const domain = /image|vision|photo|picture|camera|face|x-?ray|scan/.test(g) ? 'vision'
    : /text|language|llm|gpt|chat|translat|sentiment|word/.test(g) ? 'language'
      : /predict|forecast|price|sales|stock|demand/.test(g) ? 'prediction' : 'learning';
  return {
    zone, goal, domain, missed, noIdea,
    supportNote: clean(ctx.supportNote) || null,
    previousFeedback: clean(ctx.previousFeedback) || null,
    redesign: Boolean(ctx.redesign),
    taught: new Set(),
  };
}

/** The concept as a question topic: "the forward pass question", never "the the forward pass question". */
const qLabel = (k) => LABEL[k].replace(/^the /, '');

function gapNote(c, keys) {
  const todo = keys.filter((k) => c.missed.includes(k) && !c.taught.has(k));
  if (!todo.length) return '';
  todo.forEach((k) => c.taught.add(k));
  if (todo.length === 1) {
    const [k] = todo;
    return c.noIdea.has(k)
      ? `**Your gap:** you said “no idea” to the ${qLabel(k)} question on your depth check, so this step is built for you. ${STEP_TEACH[k]}\n\n`
      : `**Your gap:** you missed the ${qLabel(k)} question on your depth check. ${STEP_TEACH[k]}\n\n`;
  }
  const named = todo.map((k) => (c.noIdea.has(k) ? `${LABEL[k]} (you said “no idea”)` : LABEL[k]));
  return `**Your gaps:** this step covers ${list(named)} from your depth check. ${todo.slice(0, 2).map((k) => STEP_TEACH[k]).join(' ')}\n\n`;
}

const depth = (c, sun, twi, mid) => (c.zone === 'sunlight' ? sun : c.zone === 'midnight' ? mid : twi);
const MAX_BODY = 880; // validateSteps truncates longer bodies mid-sentence
/** Keep a body inside the limit: shorten the gap callout first (the intro teaches it too), then drop trailing lines. */
function fitBody(body) {
  let b = body;
  if (b.length > MAX_BODY) b = b.replace(/^(\*\*Your gaps?:\*\*.*?(?:depth check|built for you)\.) [^\n]*/, '$1');
  while (b.length > MAX_BODY && b.includes('\n')) b = b.slice(0, b.lastIndexOf('\n')).trimEnd();
  return b;
}
const step = (title, body, block) => (block ? { title, body: fitBody(body), block } : { title, body: fitBody(body) });

/** One sentence tying the live training step back to the learner's own goal. */
function goalTie(c) {
  if (!c.goal) return '';
  const tie = {
    vision: 'Image models add convolution layers that look at small patches, but they learn with exactly this loop.',
    language: 'Language models are vastly bigger and use attention, but they learn with exactly this loop.',
    prediction: 'A forecasting network swaps the two classes for a number to predict, but trains with exactly this loop.',
    learning: null,
  }[c.domain];
  if (!tie) return `\n\nSo that’s the answer to “${quoteGoal(c.goal)}”: thousands of tiny downhill steps, each one a forward pass, a loss, backprop and an update.`;
  return `\n\nYou asked: “${quoteGoal(c.goal)}.” ${tie}`;
}

/* ------------------------------------------------ lesson steps */

const STEPS = {
  bioNeuron(c) {
    return step('Where the idea came from',
      `${gapNote(c, ['neuron'])}Artificial neurons borrow one simple idea from biology. Click each part of the neuron and read its maths twin:
- **dendrites** collect incoming signals → the **inputs**
- **synapses** make some signals count more → the **weights**
- the **soma** adds it all up and fires past a threshold → **weighted sum + activation**
- the **axon** carries the result onward → the **output**

Notice the analogy is loose: real neurons are far richer. What carried over is weighted inputs, summed, then a decision.`, { type: 'bio-neuron' });
  },

  neuron(c) {
    const gap = gapNote(c, ['neuron']);
    if (c.zone === 'sunlight') {
      return step('One neuron, by hand',
        `${gap}A neuron is a tiny calculator. It multiplies each input by a **weight** (how much that input matters), adds a **bias**, and squashes the total into a score between 0 and 1.
- drag **w₁** below zero: that input now argues against firing, and the output drops
- drag the **bias**: it shifts the output even when the inputs stay put
- watch the equation under the diagram update as you go

Every network you'll meet is thousands of these, wired together.`, { type: 'neuron' });
    }
    return step('One neuron: weights and bias',
      `${gap}Start with a single neuron. It computes **z = x₁·w₁ + x₂·w₂ + b**, then squashes z with a **sigmoid** into a number between 0 and 1.
- drag **w₁** from positive to negative: the wire turns coral and the output falls
- drag **b**: the bias shifts the output without touching the inputs
- with the starting values, z = 0.8·1.2 + 0.3·(−0.6) + 0.1 = **0.88**, and sigmoid(0.88) ≈ **0.71**

**Learning** simply means finding good values for w₁, w₂ and b automatically.`, { type: 'neuron' });
  },

  activation(c) {
    return step('Why the squash matters',
      `${gapNote(c, ['activation', 'vanishing'])}Without an activation, stacking neurons just gives you one big straight-line formula. Drag the input marker and toggle the curves:
- **sigmoid** squashes anything into 0 to 1, handy for probabilities
- **tanh** squashes into −1 to 1, centred on zero
- **ReLU** passes positives and zeroes out negatives: cheap, and the default in deep networks

Notice where sigmoid goes flat at both ends. Flat means a tiny slope, and a tiny slope means a tiny learning signal.`, { type: 'activation' });
  },

  forwardpass(c) {
    const gap = gapNote(c, ['forward', 'activation']);
    if (c.zone === 'sunlight') {
      return step('Follow a signal through a network',
        `${gap}Now three neurons form a **hidden layer**, and one more makes the final call. Press **Step forward →** three times:
- first, each hidden neuron makes its own weighted sum of the two inputs
- then each sum is squashed by an activation
- finally the output neuron combines them into one prediction, about **0.67**

Then drag **x₂** and watch every number change at once. No magic: just arithmetic flowing left to right.`, { type: 'forwardpass' });
    }
    return step('A signal through a 2-3-1 network',
      `${gap}Now wire three neurons into a hidden layer and add one output. Press **Step forward →** three times and read the numbers at each phase:
- hidden neuron 1: 0.9·0.6 + (−0.4)·(−0.4) + 0.1 = **0.80**
- **tanh** bends each sum into (−1, 1): 0.80 becomes **0.66**
- the output neuron mixes all three, and a sigmoid returns **ŷ ≈ 0.67**

Then drag **x₂** and watch every number update at once. A forward pass is just arithmetic, left to right.`, { type: 'forwardpass' });
  },

  lossSurface(c) {
    return step('The landscape training walks down',
      `${gapNote(c, ['loss', 'gd', 'lr'])}Every combination of weights has a **loss**: one number for how wrong the network is. Plot it over two weights and you get this slowly turning surface; drag to orbit it. Press **▶ Descend the surface**:
- the ball steps **downhill**, against the gradient, and settles in the valley after 24 steps: a minimum
- push the **learning rate** above 0.9 and press **↻ Descend again**: every step overshoots and the ball ping-pongs across the valley

Real networks do the same across thousands of weights at once: measure the slope, step down.`, { type: 'loss-surface-3d' });
  },

  gradient(c) {
    return step('Rolling downhill',
      `${gapNote(c, ['gd', 'lr', 'loss'])}Training is like finding the bottom of a valley in fog: you only feel the slope under your feet. The ball starts on the cliff at the left. Press **▶ Descend**:
- at the starting learning rate, 0.08, it settles in the shallow dip: a **local minimum**, not the lowest point
- set the **learning rate** to 0.25 and press **▶ Descend** again: one stride clears the bump into the deep valley, the **global minimum**
- from about 0.45 every step overshoots and the ball never settles

**↺ Reset** puts the ball back. That's gradient descent: measure the slope, take a step, repeat.`, { type: 'gradient' });
  },

  backprop(c) {
    const gap = gapNote(c, ['backprop', 'gd']);
    if (c.zone === 'midnight') {
      return step('Backprop with real numbers',
        `${gap}Same 2-3-1 network, now backwards. Click **Step →** through the phases:
- loss −log(0.670) ≈ **0.400**, output δ = ŷ − y ≈ **−0.330**
- hidden δ ≈ **[−0.147, +0.147, −0.179]**: the third neuron gets the most blame even though its outgoing weight (0.6) is smaller than the first (0.8), because its tanh slope is steeper (0.90 vs 0.56)
- each update is −η · δ · input

Switch to **target 0**: the loss jumps to about 1.11 and every δ flips sign. Credit assignment is weights × slopes, not weights alone.`, { type: 'backprop' });
    }
    return step('Sending the error backwards',
      `${gap}Training needs to know **which weights to blame**. Click **Step →** through the phases and read the numbers:
- forward: ŷ ≈ 0.670 against a target of 1
- loss: −log(0.670) ≈ **0.400**
- output error: δ = ŷ − y ≈ **−0.330**
- hidden errors: δ × outgoing weight × tanh slope (1 − a²)
- update: every weight moves by −η · δ · its input (the gold Δw labels)

Then switch to **target 0**: the loss jumps to about 1.11 and δ flips to +0.670, so every update flips direction. That bookkeeping is the **chain rule**.`, { type: 'backprop' });
  },

  chainRule(c) {
    return step('The chain rule, hop by hop',
      `${gapNote(c, ['backprop'])}Backprop is the chain rule applied mechanically. The graph computes u = w·x, then v = u + b, then σ(v). Press **Start backward pass →**, then **Next hop →**: each hop writes its local derivative on the edge it crosses, and they multiply:
- ∂σ/∂v = σ(1 − σ) ≈ **0.212** at the starting values
- ∂v/∂u = 1, and ∂u/∂w = x = 1.4
- so ∂σ/∂w ≈ 0.212 × 1 × 1.4 ≈ **0.297**

Now drag **x** to 0: the gradient for w vanishes. A weight whose input is zero gets no blame, and no update.`, { type: 'chain-rule' });
  },

  lossExplorer(c) {
    return step('Choosing the loss: MSE vs cross-entropy',
      `${gapNote(c, ['loss'])}The target starts at **target 1**. Drag **your prediction** down toward 0 and watch the curves:
- **MSE (L2)** grows gently and never exceeds 1, however wrong you are
- **Cross-entropy** shoots up as a confident prediction goes wrong: −log(0.05) ≈ 3.0, and at 0.01 it is 4.61, off the top of the chart
- switch on **MAE (L1)**: it grows in a straight line

Then press **target 0** and the curves mirror. Notice why classifiers use cross-entropy: with a sigmoid output its gradient is simply ŷ − y, so confidently wrong answers get big corrections instead of the tiny ones MSE gives once the sigmoid saturates.`, { type: 'loss-explorer' });
  },

  learningRateSim(c) {
    return step('When the learning rate diverges',
      `${gapNote(c, ['lr', 'gd'])}Take the simplest loss there is, L(w) = w², starting at w = 1. Each gradient step multiplies w by (1 − 2η), so after k steps the loss is |1 − 2η|^(2k). Slide **eta** (η) and watch:
- η below 0.5: smooth, steady descent
- η between 0.5 and 1: it overshoots and zig-zags, but still converges
- η above 1: every step overshoots further and the loss **explodes**

That's the loss spike you see in real training when the learning rate is set too high.`,
      {
        type: 'simulator',
        title: 'Loss after k gradient steps on L(w) = w²',
        expr: 'abs(1 - 2*eta)^(2*k)',
        xVar: 'k',
        xRange: [0, 20],
        vars: [{ name: 'eta', min: 0.02, max: 1.2, init: 0.1, step: 0.01 }],
        yLabel: 'loss (starts at 1)',
      });
  },

  gdVariants(c) {
    return step('Batch, mini-batch or stochastic',
      `${gapNote(c, ['gd'])}Press **🏁 Race all three** and compare the paths across the contour map:
- **batch** uses every example for each step: smooth, but each step is expensive
- **stochastic** uses one example: cheap and noisy, so it zig-zags
- **mini-batch** averages a small batch: the practical middle ground, and what almost everyone trains with

Notice the noise isn't all bad: it can shake the weights out of shallow dips and saddle points.`, { type: 'gd-variants' });
  },

  optimizerRace(c) {
    return step('Momentum through the bumps',
      `Both balls start high on the right, at the dashed **start** ring on the same bumpy curve. Press **🏁 Race**:
- plain **SGD** follows the local slope and stops in the first dip it meets, the **local min**
- **momentum** keeps a running velocity, v ← β·v − η·gradient, so at the default β of 0.90 it rolls over the bump into the deeper **global min**
- lower **momentum β** to 0.80 and press **↻ Race again**: now both stall in the local dip

Then push β to its 0.98 maximum: the ball sloshes back and forth over the bump for a long time before it settles. Momentum trades stability for speed, which is why β ≈ 0.9 is the usual default.`, { type: 'optimizer-race' });
  },

  vanishing(c) {
    return step('Why deep sigmoid networks stall',
      `${gapNote(c, ['vanishing', 'activation'])}Backprop multiplies the gradient by each layer's activation slope on the way back. Each bar is the gradient reaching one layer, from the output on the right to the input on the left. It starts on **Sigmoid**, 8 layers deep:
- sigmoid's slope is at most 0.25, so each layer cuts the signal to a quarter or less
- the 4 layers nearest the input are already 💀: their weights barely move. Drag **depth** to 14 and 10 are
- switch to **ReLU**: its slope is 1 for positive inputs, so every bar stays full height

That's why ReLU-family activations replaced sigmoid in hidden layers.`, { type: 'vanishing-gradient' });
  },

  playground(c) {
    const gap = gapNote(c, ['gd', 'lr']);
    if (c.zone === 'sunlight') {
      return step('Train your first network',
        `${gap}Time to train one for real. Two clusters of points, coral and teal: the network has to learn the line between them.
- press **▶ Train** and watch **Loss** fall and **Accuracy** climb as the boundary settles
- it pauses by itself with a **✓ Converged** badge once 98% of the points are on the right side
- pick **● Coral** or **● Teal**, click a few points of the wrong colour into a cluster, then train again and watch the boundary bend to fit them

Every tick is the loop: guess, measure the error, adjust the weights.${goalTie(c)}`, { type: 'nn-playground' });
    }
    if (c.zone === 'midnight') {
      return step('The spiral: a genuinely hard case',
        `${gap}Two interleaved spiral arms: no simple boundary exists. With **8 × 8** hidden units the network has enough capacity, but it needs far more epochs than the ring.
- press **▶ Train** and watch the boundary wind into the arms; it pauses by itself once 98% of the points are right
- if accuracy stalls, lower the **learning rate** and train on: big steps bounce around the narrow valleys
- try **2** hidden neurons: too little capacity, and no amount of training fixes it

Notice the difference between an optimisation problem (tune η) and a capacity problem (change the architecture).${goalTie(c)}`, { type: 'nn-playground' });
    }
    return step('Train a real network, live',
      `${gap}Everything so far, running for real. This **ring** has coral points in the middle and teal around them: no straight line separates them, so the hidden layer must bend the boundary.
- **6** hidden neurons are picked; slide the learning rate down to about 0.01 so you can watch the boundary morph
- pick **● Teal** and click a few extra points onto the outer ring
- press **▶ Train**: the loss falls, the boundary curls into a circle, and it pauses with **✓ Converged** once 98% of points are right

Every epoch is the loop you just saw: forward pass, loss, backprop, update.${goalTie(c)}`, { type: 'nn-playground' });
  },

  check(c) {
    const q = (text, options, correctIndex, explanation) => ({ type: 'check', question: { text, options, correctIndex, explanation } });
    if (c.zone === 'sunlight') {
      return step('Check: what does training change?',
        'One quick question to lock in the big idea.',
        q('When a neural network trains, what is it actually changing?',
          ['The input data', 'Its weights and biases', 'The number of layers', 'The activation function'],
          1,
          'The architecture and the data stay fixed. Training nudges the weights and biases, step by step, until the loss is low.'));
    }
    if (c.zone === 'midnight') {
      return step('Check: a stalled deep network',
        'Last one. Think about what the vanishing-gradient bars showed.',
        q('A 10-layer sigmoid network barely improves, and its first layers hardly change. What is the most likely fix?',
          ['Raise the learning rate tenfold', 'Add more sigmoid layers', 'Switch the hidden activations to ReLU', 'Remove the bias terms'],
          2,
          'Each sigmoid layer multiplies the gradient by a slope of at most 0.25, so after ten layers the early ones get almost no signal. ReLU keeps a slope of 1 for positive inputs, so the gradient survives the trip back.'));
    }
    if (c.missed.includes('backprop') || c.missed.includes('gd')) {
      return step('Check: which way does a weight move?',
        'Last one. Picture the ball on the loss surface, and the δ values from backprop.',
        q('After backprop computes a weight’s gradient, how does training update that weight?',
          ['It steps along the gradient, to raise the loss', 'It resets to the value with the lowest loss so far', 'It steps against the gradient, scaled by the learning rate', 'It stays fixed; only the biases change'],
          2,
          'w ← w − η · ∂L/∂w. Moving against the gradient is moving downhill on the loss surface, and η sets how big that step is.'));
    }
    if (c.missed.includes('lr')) {
      return step('Check: a jumpy loss curve',
        'Last one. Think about step size.',
        q('Your training loss starts jumping around and climbing. What should you try first?',
          ['Lower the learning rate', 'Add more hidden layers', 'Train for more epochs', 'Remove the activation functions'],
          0,
          'An oversized step overshoots the valley floor on every update. A smaller learning rate lets the descent settle.'));
    }
    return step('Check: why the ring needs a hidden layer',
      'Last one. Think about the boundary you just watched form.',
      q('Why can’t a single neuron separate the ring dataset?',
        ['It only has two inputs', 'Its boundary, w·x + b = 0, is always a straight line', 'The ring has too many points', 'Single neurons can’t use a sigmoid'],
        1,
        'One neuron splits the plane with a straight line. Hidden layers with non-linear activations combine several of those into the curved, closed boundary a ring needs.'));
  },
};

const PLANS = {
  sunlight: ['bioNeuron', 'neuron', 'activation', 'forwardpass', 'gradient', 'playground', 'check'],
  twilight: ['neuron', 'forwardpass', 'lossSurface', 'backprop', 'playground', 'check'],
  midnight: ['chainRule', 'backprop', 'lossExplorer', 'learningRateSim', 'gdVariants', 'optimizerRace', 'vanishing', 'playground', 'check'],
};

function lessonTitle(c) {
  let t = depth(c, 'How a neural network learns, from one neuron up', 'How a neural network actually learns', 'Training neural networks: the maths and the failure modes');
  if (c.goal && c.domain !== 'learning') t = depth(c, 'Neural networks from scratch, for your goal', 'How the network behind your goal learns', 'Training deep networks for your goal');
  return c.supportNote || c.previousFeedback ? `Rebuilt for you: ${t}` : t;
}

function lessonIntro(c) {
  const parts = [];
  if (c.supportNote || c.previousFeedback) {
    parts.push(`We rebuilt this dive after your feedback, so ${feedbackChange(c.previousFeedback)}.${c.supportNote ? ` Our support team’s note: “${stripEnd(clip(c.supportNote, 160))}.”` : ''}`);
  }
  if (c.goal) parts.push(c.redesign ? `Lulu rebuilt this dive around your goal: “${quoteGoal(c.goal)}.”` : `You asked: “${quoteGoal(c.goal)}.”`);
  parts.push(depth(c,
    'Here is the whole idea in seven moves, starting from zero: the biological spark, one neuron, why activations matter, a signal flowing through a network, rolling downhill on the loss, and then a network you train yourself.',
    'Here is the whole story in six moves at Twilight depth: one neuron, a forward pass with real numbers, the loss landscape training walks down, backpropagation, then a real network you train live.',
    'This dive skips the basics and goes straight to the mechanics and failure modes: the chain rule, backprop with real numbers, choosing a loss, learning rates that diverge, optimisers, vanishing gradients and a hard dataset.'));
  if (c.missed.length) {
    const noIdea = c.missed.filter((k) => c.noIdea.has(k)).map((k) => LABEL[k]);
    const wrong = c.missed.filter((k) => !c.noIdea.has(k)).map((k) => LABEL[k]);
    const flagged = [noIdea.length ? `said “no idea” to ${list(noIdea)}` : '', wrong.length ? `missed ${list(wrong)}` : ''].filter(Boolean).join(' and ');
    parts.push(`On your depth check you ${flagged}, so ${c.missed.length > 1 ? 'those get' : 'that gets'} extra care along the way. The short version: ${cap(c.missed.slice(0, c.supportNote ? 2 : 3).map((k) => TEACH[k]).join('; '))}.`);
  } else {
    parts.push('You answered every depth-check question correctly, so the steps focus on why things work rather than what they are.');
  }
  return parts.join(' ');
}

function lesson(ctx) {
  const c = makeCtx(ctx);
  return { title: lessonTitle(c), intro: lessonIntro(c), steps: PLANS[c.zone].map((k) => STEPS[k](c)) };
}

/* ------------------------------------------------ Lulu: expansions */

function aboutTitle(about) {
  const a = clean(about).replace(/[?.!]+$/, '').replace(/\s+step by step$/i, ', step by step');
  return clip(cap(a), 70);
}

const BACKPROP_STAGES = [
  { label: 'Forward pass', detail: 'Input (0.6, −0.4) flows through the 2-3-1 network: hidden activations ≈ (0.66, −0.33, −0.31), output ŷ ≈ 0.670.' },
  { label: 'Measure loss', detail: 'Target y = 1. Cross-entropy loss = −log(0.670) ≈ 0.400. This single number is what training will push down.' },
  { label: 'Output error', detail: 'For sigmoid + cross-entropy the output error is simply δ = ŷ − y ≈ −0.330. Negative means “push the output up”.' },
  { label: 'Hidden errors', detail: 'Each hidden neuron gets δ × its outgoing weight × its tanh slope (1 − a²): ≈ (−0.147, +0.147, −0.179).' },
  { label: 'Gradients', detail: 'Each weight’s gradient is the δ of the neuron it feeds times the input that flowed through it: ∂L/∂w = δ · input.' },
  { label: 'Update', detail: 'Every weight steps against its gradient: w ← w − η · ∂L/∂w. Repeat for every example, thousands of times. That is training.' },
];

const EXPANSIONS = [
  {
    match: /backprop|backward|chain rule|blame|credit/i,
    steps: (x) => [
      step(aboutTitle(x.about),
        `Here is backprop on the same 2-3-1 network, one stage at a time, with the real numbers. Press **▶ Auto-play** or step with **Next →**.
- the error starts at the output as a single number, δ
- it travels back along the weights, scaled by each neuron's slope
- every weight's gradient is then just δ × the input it saw

Notice nothing is guessed: each stage is one multiplication you could do by hand.`,
        { type: 'sequence', stages: BACKPROP_STAGES }),
      step('Feel the gradient for one weight',
        `The curve is the squared error as you slide **one weight w**, with the input **x**, bias **b** and target **y** fixed. Backprop's job is the **slope** of this curve at your current w: dL/dw = −2x(y − (w·x + b)).
- the lowest point is where w·x + b = y
- raise **x** and the parabola gets steeper: big inputs mean big gradients
- set **x** to 0 and it goes flat: a weight on a zero input gets no blame`,
        {
          type: 'simulator',
          title: 'Squared error as one weight changes',
          expr: '(y - (w*x + b))^2',
          xVar: 'w',
          xRange: [-3, 3],
          vars: [
            { name: 'x', min: -2, max: 2, init: 1.5, step: 0.1 },
            { name: 'b', min: -2, max: 2, init: 0, step: 0.1 },
            { name: 'y', min: -2, max: 2, init: 1, step: 0.1 },
          ],
          yLabel: 'squared error',
        }),
    ],
  },
  {
    match: /learning rate|step size|diverg|overshoot|eta\b/i,
    steps: (x) => [
      step(aboutTitle(x.about),
        `On L(w) = w², starting at w = 1, every gradient step multiplies w by (1 − 2η). After k steps the loss is |1 − 2η|^(2k). Slide **eta**:
- below 0.5 the loss glides down
- between 0.5 and 1 it overshoots and zig-zags but still converges
- above 1 it explodes

Notice there's a sharp edge: a small change in η flips training from converging to diverging.`,
        {
          type: 'simulator',
          title: 'Loss after k steps for your learning rate',
          expr: 'abs(1 - 2*eta)^(2*k)',
          xVar: 'k',
          xRange: [0, 20],
          vars: [{ name: 'eta', min: 0.02, max: 1.2, init: 0.3, step: 0.01 }],
          yLabel: 'loss (starts at 1)',
        }),
    ],
  },
  {
    match: /gradient|descent|downhill|optimi|minimum|minima/i,
    steps: (x) => [
      step(aboutTitle(x.about),
        `One step of gradient descent, slowed right down. Step through with **Next →**:
- measure the loss where you stand
- find which way is downhill (the negative gradient)
- step that way by η, and repeat

Notice the loop never sees the whole landscape, only the slope under its feet.`,
        {
          type: 'sequence',
          stages: [
            { label: 'Start', detail: 'The weights start somewhere, usually at small random values. The loss there is high.' },
            { label: 'Measure', detail: 'Run a forward pass on a batch of examples and compute the loss.' },
            { label: 'Slope', detail: 'Backprop gives the gradient: for every weight, how much the loss rises if it grows a little.' },
            { label: 'Step', detail: 'Move every weight a little the other way: w ← w − η · gradient.' },
            { label: 'Repeat', detail: 'New weights, new loss, new gradient. Thousands of steps later the loss has settled in a valley.' },
          ],
        }),
      step('How step size shapes the descent',
        `The curve is the loss after **k** steps on L(w) = w², starting at 1. Slide **eta** (η):
- small η: slow and steady
- around 0.5: the fastest drop
- above 1: the steps overshoot and the loss grows`,
        {
          type: 'simulator',
          title: 'Loss after k gradient steps',
          expr: 'abs(1 - 2*eta)^(2*k)',
          xVar: 'k',
          xRange: [0, 20],
          vars: [{ name: 'eta', min: 0.02, max: 1.2, init: 0.1, step: 0.01 }],
          yLabel: 'loss (starts at 1)',
        }),
    ],
  },
  {
    match: /activation|sigmoid|relu|tanh|non-?linear|squash/i,
    steps: (x) => [
      step(aboutTitle(x.about),
        `The curve is **sigmoid(w·x + b)**, one neuron's output as its input x changes. Slide the sliders:
- **w** sets the steepness: large w makes a sharp, almost on/off switch
- **b** slides the switch point left or right, to x = −b/w
- a negative **w** flips the curve

Notice the flat tails: there the slope is nearly zero, which is where learning slows down.`,
        {
          type: 'simulator',
          title: 'One neuron’s output: sigmoid(w·x + b)',
          expr: 'sigmoid(w*x + b)',
          xVar: 'x',
          xRange: [-6, 6],
          vars: [
            { name: 'w', min: -4, max: 4, init: 1, step: 0.1 },
            { name: 'b', min: -4, max: 4, init: 0, step: 0.1 },
          ],
          yLabel: 'output',
        }),
      step('Why the flat tails slow learning',
        `This is sigmoid's **slope**, σ(1 − σ), at each input: the factor backprop multiplies by when the error passes back through this neuron. It peaks at just 0.25, right at the switch point, and fades to almost zero in the tails.
- raise **w** and the peak gets narrower: the neuron saturates sooner
- push **b** so the switch point leaves the window, and the slope nearly vanishes everywhere in it
- stack many sigmoid layers and these small factors multiply: the vanishing gradient`,
        {
          type: 'simulator',
          title: 'Slope of the sigmoid, σ(1 − σ)',
          expr: 'sigmoid(w*x + b)*(1 - sigmoid(w*x + b))',
          xVar: 'x',
          xRange: [-6, 6],
          vars: [
            { name: 'w', min: 0.2, max: 4, init: 1, step: 0.1 },
            { name: 'b', min: -4, max: 4, init: 0, step: 0.1 },
          ],
          yLabel: 'slope',
        }),
    ],
  },
  {
    match: /loss|cost|error|cross.?entropy|mse|objective/i,
    steps: (x) => [
      step(aboutTitle(x.about),
        `The curve is the **cross-entropy loss** for a yes/no prediction p, with true label **y**. Slide **y** between 0 and 1:
- with y = 1, the loss is −log(p): tiny near p = 1, huge near p = 0
- with y = 0, the curve mirrors: confident “yes” answers are punished
- the steep walls are the point: confident mistakes get the biggest corrections`,
        {
          type: 'simulator',
          title: 'Cross-entropy loss for a prediction p',
          expr: '-(y*log(p) + (1 - y)*log(1 - p))',
          xVar: 'p',
          xRange: [0.01, 0.99],
          vars: [{ name: 'y', min: 0, max: 1, init: 1, step: 1 }],
          yLabel: 'loss',
        }),
    ],
  },
  {
    match: /vanish|explod|deep|depth|layers? (die|dead)/i,
    steps: (x) => [
      step(aboutTitle(x.about),
        `On the way back, the gradient is multiplied by each layer's activation slope. If that slope is **s**, the signal reaching layer x from the top is about s^x. Slide **s**:
- sigmoid's best case is s = 0.25: by layer 5 less than 0.1% survives
- s = 1 (ReLU on positive inputs) keeps the signal intact
- s above 1 makes it explode instead`,
        {
          type: 'simulator',
          title: 'Gradient left after x layers',
          expr: 's^x',
          xVar: 'x',
          xRange: [0, 14],
          vars: [{ name: 's', min: 0.1, max: 1.2, init: 0.25, step: 0.01 }],
          yLabel: 'share of gradient left',
        }),
    ],
  },
  {
    match: /neuron|weight|bias|perceptron/i,
    steps: (x) => [
      step(aboutTitle(x.about),
        `One neuron, one input, as a curve. It computes **sigmoid(w·x + b)**:
- **w** is how much the input matters, and in which direction
- **b** shifts the point where the neuron switches on, to x = −b/w
- the output is a score between 0 and 1

Slide both and notice every shape a single neuron can make is the same S-curve, stretched, flipped and shifted.`,
        {
          type: 'simulator',
          title: 'What one neuron computes',
          expr: 'sigmoid(w*x + b)',
          xVar: 'x',
          xRange: [-6, 6],
          vars: [
            { name: 'w', min: -4, max: 4, init: 1.2, step: 0.1 },
            { name: 'b', min: -4, max: 4, init: 0.1, step: 0.1 },
          ],
          yLabel: 'output',
        }),
    ],
  },
  {
    match: /forward|flow|layer|predict/i,
    steps: (x) => [
      step(aboutTitle(x.about),
        `The forward pass through the 2-3-1 network, with the real numbers. Step through with **Next →**:
- every hidden neuron sees the same two inputs but weighs them differently
- tanh bends each sum, which is what lets the network learn curves
- the output neuron turns three numbers into one prediction`,
        {
          type: 'sequence',
          stages: [
            { label: 'Inputs', detail: 'Two numbers enter: x₁ = 0.6, x₂ = −0.4.' },
            { label: 'Weighted sums', detail: 'Each hidden neuron computes w·x + b. Neuron 1: 0.9·0.6 + (−0.4)·(−0.4) + 0.1 = 0.80.' },
            { label: 'Activation', detail: 'tanh squashes each sum into (−1, 1): (0.80, −0.34, −0.32) → (0.66, −0.33, −0.31).' },
            { label: 'Output sum', detail: 'The output neuron: 0.8·0.66 − 0.5·(−0.33) + 0.6·(−0.31) + 0.2 ≈ 0.71.' },
            { label: 'Prediction', detail: 'sigmoid(0.71) ≈ 0.670: a 67% “yes”. Training will adjust the weights so this lands nearer the target.' },
          ],
        }),
    ],
  },
  {
    match: /overfit|generali[sz]|memori[sz]|validation/i,
    steps: (x) => [
      step(aboutTitle(x.about),
        `Here is how overfitting creeps in, stage by stage. Step through with **Next →** and notice the moment training and validation loss part ways: from there on, the network is memorising, not learning.`,
        {
          type: 'sequence',
          stages: [
            { label: 'Split the data', detail: 'Hold back a validation set the network never trains on.' },
            { label: 'Early epochs', detail: 'Training and validation loss fall together: the network is learning the real pattern.' },
            { label: 'The gap opens', detail: 'Training loss keeps falling, validation loss flattens, then rises: it has started memorising noise.' },
            { label: 'Stop early', detail: 'Keep the weights from the epoch with the lowest validation loss.' },
            { label: 'Or regularise', detail: 'More data, a smaller network, dropout or weight decay all make memorising harder.' },
          ],
        }),
    ],
  },
];

const DEFAULT_EXPANSION = (x) => [
  step(aboutTitle(x.about),
    `One full training step, end to end. Step through with **Next →**: this is the loop that runs thousands of times while a network learns.`,
    { type: 'sequence', stages: BACKPROP_STAGES }),
  step('Feel the gradient for one weight',
    `The curve is the squared error as you slide **one weight w**, with input **x**, bias **b** and target **y** fixed. Training walks w toward the bottom of this curve.
- the minimum is where w·x + b = y
- a bigger **x** makes the curve steeper, so the gradient is bigger`,
    {
      type: 'simulator',
      title: 'Squared error as one weight changes',
      expr: '(y - (w*x + b))^2',
      xVar: 'w',
      xRange: [-3, 3],
      vars: [
        { name: 'x', min: -2, max: 2, init: 1.5, step: 0.1 },
        { name: 'b', min: -2, max: 2, init: 0, step: 0.1 },
        { name: 'y', min: -2, max: 2, init: 1, step: 0.1 },
      ],
      yLabel: 'squared error',
    }),
];

function expansion(ctx = {}) {
  const about = clean(ctx.about) || 'how a network learns, step by step';
  const x = { about, zone: zoneOf(ctx.zone) };
  const hit = EXPANSIONS.find((e) => e.match.test(about));
  const steps = (hit ? hit.steps(x) : DEFAULT_EXPANSION(x)).map((s) => ({ ...s }));
  const taken = new Set((ctx.existingTitles ?? []).map((t) => clean(t).toLowerCase()));
  for (const s of steps) {
    let title = s.title;
    for (let n = 2; taken.has(title.toLowerCase()); n++) title = `${s.title} (part ${n})`;
    s.title = title;
    taken.add(title.toLowerCase());
  }
  return { steps };
}

/* ------------------------------------------------ Lulu: decide */

const ANSWERS = [
  // "cost to run" is about compute, not the cost (loss) function, so it must be tested before the loss answer
  [/\bcosts? (to|of) (run|train|deploy|serve|use)|\bruns? cost|what (does|will|would) (it|this|that|training) cost|how much (does|will|would|do) .{0,30}\bcost|\bcompute\b|\bgpus?\b|\bhardware\b|\bexpensive\b|\bpricey?\b/i, 'Two different costs. Training is the expensive part: thousands of forward passes plus backprop over the whole dataset, which is why big models train on GPUs. Running a trained network is one forward pass per prediction. For a small network like the one in this dive, that is a few dozen multiplications, so it costs next to nothing; only at the scale of large language models, with billions of weights, does inference need serious hardware.'],
  [/hallucinat|\bmak(e|es|ing) (things |stuff |facts |it |answers )?up\b|\bmade (things |stuff |it )?up\b|\binvent|fabricat|confidently wrong/i, 'That’s hallucination, and it’s mostly a language-model problem, but the root is the one you can see here: a network always produces an output, even for inputs far from anything it trained on, and nothing in the maths flags that it’s guessing. The fixes live around the network: ground it in retrieved facts, set a confidence threshold, and test it on cases outside the training data.'],
  [/backprop|backward|chain rule/i, 'Backprop is bookkeeping with the chain rule. The output error δ = ŷ − y is passed back along each weight and multiplied by each neuron’s activation slope, so every weight learns its share of the blame. Its gradient is then δ × the input it saw, and the update steps against it.'],
  [/learning rate|step size|\beta\b|η/i, 'The learning rate is the size of each downhill step. Too small and training crawls; too large and it overshoots the valley, so the loss jumps around or blows up. A good habit: start around 0.01, and if the loss spikes, divide it by 3.'],
  [/overfit|memori|generali/i, 'Overfitting is when the network memorises the training points instead of the pattern. Watch a validation set it never trains on: when training loss keeps falling but validation loss rises, stop, or add more data, shrink the network, or use dropout.'],
  [/relu|sigmoid|tanh|activation|non-?linear/i, 'Activations bend the signal. Without them, any number of layers collapses into one straight-line model. ReLU is the default in hidden layers because its slope is 1 for positive inputs, so gradients survive deep stacks; sigmoid stays useful at the output, for probabilities.'],
  [/\bloss|\bcost\b|cross.?entropy|\bmse\b|\berror/i, 'The loss is one number for how wrong the network is on the data. Use mean squared error for predicting numbers and cross-entropy for classes: cross-entropy punishes confident mistakes hardest, and with a sigmoid output its gradient is simply ŷ − y.'],
  [/local min|stuck|plateau|saddle/i, 'In high dimensions true local minima are rarer than you’d think; plateaus and saddle points are the usual trouble. Momentum, mini-batch noise and a sensible learning rate carry training through most of them.'],
  [/epoch|batch|iteration/i, 'An epoch is one pass over the whole training set. Each pass is split into mini-batches, and every batch gives one gradient step. So 140 points in batches of 20 means 7 updates per epoch.'],
  [/hidden|layer|depth|how many neurons|architecture/i, 'Hidden layers let the network combine simple boundaries into curved ones. One hidden layer with enough neurons can fit a ring; spirals need more capacity. Too few neurons underfit however long you train; too many can memorise noise.'],
  [/weight|bias/i, 'Weights say how much each input matters and in which direction; the bias shifts the point where the neuron switches on. Training changes exactly these numbers and nothing else: the data and the architecture stay fixed.'],
  [/vanish|explod/i, 'Backprop multiplies by each layer’s activation slope on the way back. Sigmoid’s slope is at most 0.25, so ten layers can shrink the gradient by a factor of a million. ReLU, careful initialisation and residual connections are the standard fixes.'],
  [/gradient|descent|downhill/i, 'Gradient descent repeats one move: measure the slope of the loss for every weight, then step each weight a little downhill, w ← w − η·gradient. It never sees the whole landscape, only the slope where it stands.'],
  [/^((hmm+|um+|oh|ah|alright|right|yeah)[,.!\s]+)?(i think i (get|got) it|got it|makes sense|ok(ay)?[.! ]*$|i see|understood|that helps|perfect)/i, 'Great, that’s the idea. Keep going, and ask me whenever something needs unpacking: I can also add a hands-on step if you ask me to walk you through something step by step. 🐙'],
  [/^(thanks|thank you|cool|great|awesome|nice)/i, 'Anytime! Keep going, and ask me to walk you through anything step by step: I’ll add a hands-on step right here. 🐙'],
  [/^(hmm+|um+|uh+|huh)[.!?\s]*$/i, 'Take your time. If something in this step feels fuzzy, ask me about it, or ask me to walk you through it step by step and I’ll add a hands-on step. 🐙'],
];

/** Words that mark a question as being about this dive (anything else gets a polite redirect). */
const ON_TOPIC = /neur|network|layer|weight|bias|train|learn|loss|gradient|backprop|activation|sigmoid|relu|tanh|epoch|batch|overfit|model|data|predict|step|block|lesson|playground|boundary|accura|deep|ai|math/i;

const EXPAND_RE = /step[- ]by[- ]step|walk me through|break (it|this|that)? ?down|go deeper|more detail|in detail|clarify|show me how|explain .{0,60}(more|again|slowly|properly)/i;
const REDESIGN_RE = /\bi want to build\b|\bi'?m building\b|\bi am building\b|\bmy (company|business|startup)\b/i;

function extractAbout(message) {
  let a = clean(message).replace(/[?!.]+$/, '');
  a = a.replace(/^(hey|hi|ok|okay|so|lulu)[,!\s]+/i, '');
  a = a.replace(/^(can|could|would) you (please )?/i, '').replace(/^please /i, '');
  a = a.replace(/^(walk me through|explain|show me how|show me|clarify|break down|go deeper (on|into)|tell me more about|help me understand)\s+/i, '');
  return clip(a, 120) || 'this step, step by step';
}

function tutor(ctx = {}) {
  const msg = clean(ctx.lastUserMessage);
  const here = (ctx.stepTitles ?? [])[ctx.currentStepIndex ?? 0];
  if (REDESIGN_RE.test(msg)) {
    const goal = clip(cap(msg.replace(/[?!.]+$/, '').replace(/^.*?\bi (want|would like|need) to\s+/i, '')), 280);
    return { action: 'redesign', goal, reply: `Love that goal. I’m rebuilding your whole dive around it now, with every step aimed at “${clip(stripEnd(goal), 90)}”. 🌊` };
  }
  if (EXPAND_RE.test(msg)) {
    const about = extractAbout(msg);
    return {
      action: 'expand',
      about,
      reply: /backprop|backward|chain/i.test(about)
        ? 'Good call. I’m adding two steps right after this one: backprop on the same network, stage by stage with real numbers, and a live curve for one weight’s gradient. 🤿'
        : `On it. I’m adding interactive steps on ${clip(about, 70)} right after this one, so you can see it happen rather than read about it. 🤿`,
    };
  }
  for (const [re, reply] of ANSWERS) if (re.test(msg)) return { action: 'answer', reply };
  if (!ON_TOPIC.test(msg)) {
    return { action: 'answer', reply: 'That one’s outside this dive, so I’ll leave it to a search engine. 🐙 Ask me anything about how networks learn, from weights and loss to backprop and training, or ask me to walk you through a step and I’ll add a hands-on one.' };
  }
  return {
    action: 'answer',
    reply: `Good question. Almost everything in neural networks comes back to one loop: forward pass, measure the loss, backprop the error, nudge the weights.${here ? ` The block in “${clip(here, 60)}” shows one piece of that loop, so try it with your question in mind.` : ''} Ask me to walk you through anything step by step and I’ll add a hands-on step.`,
  };
}

/* ------------------------------------------------ dive-log summary */

const BUILT = {
  'nn-playground': (s) => (/ring/i.test(s.title) || /real network, live/i.test(s.title) ? 'You trained a real network live and watched its boundary curl around the ring.' : 'You trained a real network live and watched its decision boundary take shape.'),
  backprop: () => 'You stepped the error backwards through a 2-3-1 network and read every δ.',
  'loss-surface-3d': () => 'You orbited a 3-D loss surface and sent a ball down it by gradient descent.',
  forwardpass: () => 'You pushed a signal through a 2-3-1 network, phase by phase, with real numbers.',
  neuron: () => 'You tuned one neuron’s weights and bias by hand and watched its output respond.',
  'chain-rule': () => 'You multiplied local derivatives hop by hop through a computational graph.',
  'loss-explorer': () => 'You compared MSE, MAE and cross-entropy as a prediction went wrong.',
  'gd-variants': () => 'You raced batch, mini-batch and stochastic gradient descent across a contour map.',
  'optimizer-race': () => 'You raced plain SGD against momentum on a bumpy loss curve.',
  'vanishing-gradient': () => 'You watched gradients vanish layer by layer, then fixed it with ReLU.',
  gradient: () => 'You dropped a ball on a loss curve and tuned the learning rate as it rolled.',
  activation: () => 'You compared sigmoid, tanh and ReLU and found where each goes flat.',
  'bio-neuron': () => 'You mapped a biological neuron, part by part, onto its maths twin.',
  perceptron: () => 'You trained a perceptron one update at a time until it separated the points.',
  'logic-gate': () => 'You trained a perceptron on logic gates and watched XOR defeat it.',
  simulator: (s) => `You tuned the “${clip(s.title, 60)}” simulator and watched the curve respond.`,
  sequence: (s) => `You stepped through “${clip(s.title, 70)}” stage by stage.`,
  diagram: (s) => `You explored “${clip(s.title, 70)}” node by node.`,
  chart: (s) => `You read the “${clip(s.title, 70)}” chart.`,
};
const BUILT_ORDER = ['nn-playground', 'backprop', 'loss-surface-3d', 'forwardpass', 'chain-rule', 'optimizer-race', 'gd-variants', 'vanishing-gradient', 'loss-explorer', 'neuron', 'gradient', 'activation', 'bio-neuron', 'perceptron', 'logic-gate', 'simulator', 'sequence', 'diagram', 'chart'];

const LEARNED = {
  neuron: 'You know what one neuron computes: a weighted sum plus a bias, squashed by an activation.',
  forwardpass: 'You can follow a forward pass layer by layer, from inputs to a prediction.',
  'loss-surface-3d': 'You see training as walking downhill on a loss surface, one gradient step at a time.',
  backprop: 'You understand backprop as the chain rule assigning each weight its share of the blame.',
  'nn-playground': 'You know why hidden layers matter: they bend the boundary where one neuron can only draw a line.',
  'chain-rule': 'You can multiply local derivatives along a graph to get any weight’s gradient.',
  'loss-explorer': 'You know why classifiers use cross-entropy rather than squared error.',
  'vanishing-gradient': 'You know why deep sigmoid stacks stall and why ReLU fixed it.',
  'optimizer-race': 'You know how momentum carries training over bumps that stop plain SGD.',
  'gd-variants': 'You can weigh batch, mini-batch and stochastic gradient descent against each other.',
  activation: 'You know why non-linear activations are what make depth worth having.',
  gradient: 'You know what the learning rate does to each step of gradient descent.',
};
const GAP_LEARNED = {
  neuron: 'You closed your gap on neurons: weights scale the inputs, the bias shifts the switch point.',
  activation: 'You closed your activation gap: without non-linearity, layers collapse into one line.',
  forward: 'You closed your forward-pass gap: weighted sums, then activations, layer by layer.',
  loss: 'You closed your loss gap: one number for how wrong the network is, and training pushes it down.',
  gd: 'You closed your gradient-descent gap: step every weight against its gradient, again and again.',
  backprop: 'You closed your backprop gap: the error travels back, scaled by weights and activation slopes.',
  lr: 'You closed your learning-rate gap: too small crawls, too large overshoots and diverges.',
  vanishing: 'You closed your vanishing-gradient gap: small slopes multiply away the signal in deep stacks.',
};

function summary(ctx = {}) {
  const steps = (ctx.steps ?? []).map((s) => ({ title: clean(s?.title), type: s?.blockType ?? null }));
  const types = [...new Set(steps.map((s) => s.type).filter(Boolean))];
  const goal = clean(ctx.goal);
  const headline = goal && /learn|train/i.test(goal)
    ? 'You watched a neural network learn, from one neuron to a live training run.'
    : goal
      ? `You traced how the networks behind “${clip(stripEnd(goal), 50)}” learn, step by step.`
      : { sunlight: 'You built up a neural network from one neuron and trained it yourself.', midnight: 'You took apart training itself: gradients, losses, optimisers and failure modes.' }[zoneOf(ctx.zone)] ?? 'You followed a network from one neuron to a live training run.';

  const learned = [];
  for (const k of [...new Set((ctx.missed ?? []).map(conceptKey).filter(Boolean))]) if (learned.length < 2 && GAP_LEARNED[k]) learned.push(GAP_LEARNED[k]);
  for (const t of types) if (learned.length < 5 && LEARNED[t] && !learned.includes(LEARNED[t])) learned.push(LEARNED[t]);
  for (const fill of [LEARNED.neuron, LEARNED.backprop, LEARNED['loss-surface-3d']]) if (learned.length < 3 && !learned.includes(fill)) learned.push(fill);

  const built = [];
  for (const t of BUILT_ORDER) {
    if (built.length >= 4) break;
    const s = steps.find((st) => st.type === t);
    if (s) built.push(BUILT[t](s));
  }
  if (built.length < 2) built.push('You answered the check questions and saw why each answer holds.');
  if (built.length < 2) built.push('You read every step and tried each block in turn.');

  const nextSteps = [
    { sunlight: 'Dive again in the Twilight Zone to see backprop with real numbers.', twilight: 'Try the Midnight Zone for optimisers, vanishing gradients and the spiral dataset.', midnight: 'Implement a 2-layer network in NumPy and check your gradients numerically.' }[zoneOf(ctx.zone)] ?? 'Try the next depth zone to go deeper.',
    types.includes('nn-playground') ? 'Back in the playground, try the 2-neuron architecture on the ring and see why it can’t fit.' : 'Train a network yourself in the playground and watch the boundary form.',
    'Ask Lulu to walk you through backprop step by step and work one weight’s gradient by hand.',
  ];
  return {
    headline: clip(headline, 120),
    learned: learned.map((s) => clip(s, 140)),
    built: built.map((s) => clip(s, 140)),
    nextSteps: nextSteps.slice(0, 3).map((s) => clip(s, 140)),
  };
}

export default {
  topicId: 'neural-networks',
  knowledgeMap,
  questions,
  lesson,
  expansion,
  tutor,
  summary,
  // agent/flow tasks carry no topic, so the server normally sends them to the
  // ai-agents corpus; delegate lazily in case it routes here
  agentStep: (ctx) => agents.agentStep(ctx),
  flowNode: (ctx) => agents.flowNode(ctx),
  integrationGuide: (ctx) => agents.integrationGuide(ctx),
  chat: (ctx) => chatbots.chat(ctx),
};
