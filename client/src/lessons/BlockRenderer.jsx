import NeuralNetLesson from './NeuralNetLesson.jsx';
import AgentsLesson from './AgentsLesson.jsx';
import ChatbotLesson from './ChatbotLesson.jsx';
import NeuronBlock from './blocks/NeuronBlock.jsx';
import ActivationBlock from './blocks/ActivationBlock.jsx';
import GradientBlock from './blocks/GradientBlock.jsx';
import ForwardPassBlock from './blocks/ForwardPassBlock.jsx';
import FlowBuilder from './blocks/FlowBuilder.jsx';
import { AgentLoopBlock, DiagramBlock, ChartBlock } from './blocks/DiagramBlocks.jsx';
import { PerceptronBlock, BackpropBlock, OptimizerRaceBlock } from './blocks/NNAdvancedBlocks.jsx';
import LogicGateBlock from './blocks/LogicGateBlock.jsx';
import LossSurface3D from './blocks/LossSurface3D.jsx';
import { BioNeuronBlock, LossExplorerBlock, VanishingGradientBlock, GDVariantsBlock, ChainRuleBlock } from './blocks/NNSourceBlocks.jsx';
import { MemoryBlock, GuardrailsBlock, MultiAgentBlock, WorkflowVsAgentBlock } from './blocks/AgentSourceBlocks.jsx';
import { SimulatorBlock, SequenceBlock } from './blocks/GenerativeBlocks.jsx';
import PatternExplorerBlock from './blocks/PatternExplorerBlock.jsx';

const NN_DEFAULT = { dataset: 'blobs', hidden: [4], lr: 0.03, showLayers: true, showLR: true };
const CB_DEFAULT = { starterIntents: 'basic', showMatching: true, liveCompare: true };

/** Renders one interactive block from a lesson's JSON (or a catalog sample). */
export default function BlockRenderer({ block, session }) {
  if (!block) return null;
  const topicId = session?.topicId;
  switch (block.type) {
    case 'neuron': return <NeuronBlock />;
    case 'bio-neuron': return <BioNeuronBlock />;
    case 'perceptron': return <PerceptronBlock />;
    case 'logic-gate': return <LogicGateBlock />;
    case 'activation': return <ActivationBlock />;
    case 'vanishing-gradient': return <VanishingGradientBlock />;
    case 'forwardpass': return <ForwardPassBlock />;
    case 'chain-rule': return <ChainRuleBlock />;
    case 'backprop': return <BackpropBlock />;
    case 'loss-explorer': return <LossExplorerBlock />;
    case 'gradient': return <GradientBlock />;
    case 'loss-surface-3d': return <LossSurface3D />;
    case 'gd-variants': return <GDVariantsBlock />;
    case 'optimizer-race': return <OptimizerRaceBlock />;
    case 'agent-loop': return <AgentLoopBlock />;
    case 'pattern-explorer': return <PatternExplorerBlock initial={block.initial} />;
    case 'multi-agent': return <MultiAgentBlock />;
    case 'memory': return <MemoryBlock />;
    case 'guardrails': return <GuardrailsBlock />;
    case 'workflow-vs-agent': return <WorkflowVsAgentBlock />;
    case 'simulator':
      return <SimulatorBlock title={block.title} expr={block.expr} xVar={block.xVar} xRange={block.xRange} vars={block.vars} yLabel={block.yLabel} />;
    case 'sequence': return <SequenceBlock stages={block.stages} />;
    case 'diagram': return <DiagramBlock nodes={block.nodes} edges={block.edges} />;
    case 'chart': return <ChartBlock kind={block.kind} title={block.title} xLabel={block.xLabel} yLabel={block.yLabel} series={block.series} />;
    case 'nn-playground':
      return <NeuralNetLesson config={topicId === 'neural-networks' && session?.widgetConfig ? session.widgetConfig : NN_DEFAULT} />;
    case 'live-agent':
      return <AgentsLesson config={topicId === 'ai-agents' && session?.widgetConfig ? session.widgetConfig : { maxSteps: 10 }} topicId={topicId ?? 'ai-agents'} />;
    case 'chatbot-builder':
      return <ChatbotLesson config={topicId === 'chatbots' && session?.widgetConfig ? session.widgetConfig : CB_DEFAULT} />;
    case 'flow-builder':
      return <FlowBuilder template={block.template ?? 'starter'} goalHint={block.goalHint} topicId={topicId} sessionId={session?.id} />;
    default: return null;
  }
}
